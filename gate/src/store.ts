// Orgs, their API keys and policies, and the receipt log, in SQLite. Every purchase attempt
// is recorded, including refusals, so the audit trail shows what was stopped as well as what
// was paid. Spend is summed from receipts, so the receipts are the single source of truth.
//
// Budget reservations live in memory: the gate is meant to run as a single process.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { OrgPolicy } from "./config.ts";

// rejected: paid, but the result failed its checks, so it was withheld and the seller owes a refund.
// no_result: the seller had no data and nothing was charged.
// pending_approval / denied: the purchase needed a person's approval; denied covers expired requests.
export type ReceiptStatus =
  | "paid"
  | "blocked"
  | "refused"
  | "failed"
  | "rejected"
  | "no_result"
  | "pending_approval"
  | "denied";

export type ApprovalStatus = "pending" | "approved" | "denied";

export type Approval = {
  id: string;
  orgId: string;
  status: ApprovalStatus;
  sellerId: string;
  params: Record<string, string>;
  requestedBy: string;
  recordId: string;
  costCenter: string;
  priceMicros: number;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  // The decider's own words for why, so whoever reviews spend later can judge the approval.
  decisionNote: string | null;
};

// A decided approval and what came of it, for the decision log.
export type DecisionLogEntry = Approval & {
  outcomeStatus: ReceiptStatus | null;
  outcomeAmountMicros: number;
  outcomeTransaction: string | null;
};

// Pending approvals older than this can no longer be approved.
export const APPROVAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type Receipt = {
  id: string;
  orgId: string;
  at: string;
  status: ReceiptStatus;
  reason: string;
  sellerId: string;
  requestedBy: string;
  recordId: string;
  costCenter: string;
  amountMicros: number;
  refundDueMicros: number;
  network: string | null;
  transaction: string | null;
  approvalId: string | null;
};

export type Org = { id: string; name: string; policy: OrgPolicy; createdAt: string };

const MIN_KEY_LENGTH = 24;

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function newApiKey(): string {
  return "asg_" + randomBytes(32).toString("base64url");
}

export function monthStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export class Store {
  private db: DatabaseSync;
  private reserved = new Map<string, number>();
  private now: () => Date;

  constructor(path: string, now: () => Date = () => new Date()) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.now = now;
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS orgs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        api_key_hash TEXT NOT NULL UNIQUE,
        policy_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS receipts (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES orgs(id),
        at TEXT NOT NULL,
        status TEXT NOT NULL,
        reason TEXT NOT NULL,
        seller_id TEXT NOT NULL,
        requested_by TEXT NOT NULL,
        record_id TEXT NOT NULL,
        amount_micros INTEGER NOT NULL,
        refund_due_micros INTEGER NOT NULL DEFAULT 0,
        network TEXT,
        transaction_ref TEXT
      );
      CREATE INDEX IF NOT EXISTS receipts_org_at ON receipts (org_id, at);
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES orgs(id),
        status TEXT NOT NULL,
        seller_id TEXT NOT NULL,
        params_json TEXT NOT NULL,
        requested_by TEXT NOT NULL,
        record_id TEXT NOT NULL,
        cost_center TEXT NOT NULL,
        price_micros INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        decided_at TEXT,
        decided_by TEXT
      );
      CREATE INDEX IF NOT EXISTS approvals_org_status ON approvals (org_id, status);
    `);
    // Columns added after the first release; older databases get them here.
    const columns = new Set(this.db.prepare("PRAGMA table_info(receipts)").all().map((c: any) => c.name));
    if (!columns.has("cost_center")) this.db.exec("ALTER TABLE receipts ADD COLUMN cost_center TEXT NOT NULL DEFAULT ''");
    if (!columns.has("approval_id")) this.db.exec("ALTER TABLE receipts ADD COLUMN approval_id TEXT");
    const approvalColumns = new Set(this.db.prepare("PRAGMA table_info(approvals)").all().map((c: any) => c.name));
    if (!approvalColumns.has("decision_note")) this.db.exec("ALTER TABLE approvals ADD COLUMN decision_note TEXT");
  }

  createOrg(name: string, policy: OrgPolicy, apiKey = newApiKey()): { org: Org; apiKey: string } {
    if (apiKey.length < MIN_KEY_LENGTH) throw new Error(`API keys must be at least ${MIN_KEY_LENGTH} characters`);
    const org: Org = { id: randomUUID(), name, policy, createdAt: this.now().toISOString() };
    this.db
      .prepare("INSERT INTO orgs (id, name, api_key_hash, policy_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(org.id, name, hashKey(apiKey), JSON.stringify(policy), org.createdAt);
    return { org, apiKey };
  }

  // Keys are long and random, so a plain hash lookup is safe; the raw key is never stored.
  orgForKey(apiKey: string): Org | null {
    const row = this.db.prepare("SELECT * FROM orgs WHERE api_key_hash = ?").get(hashKey(apiKey));
    return row ? toOrg(row) : null;
  }

  getOrg(id: string): Org | null {
    const row = this.db.prepare("SELECT * FROM orgs WHERE id = ?").get(id);
    return row ? toOrg(row) : null;
  }

  listOrgs(): Org[] {
    return this.db.prepare("SELECT * FROM orgs ORDER BY created_at").all().map(toOrg);
  }

  setPolicy(orgId: string, policy: OrgPolicy): void {
    const { changes } = this.db.prepare("UPDATE orgs SET policy_json = ? WHERE id = ?").run(JSON.stringify(policy), orgId);
    if (!changes) throw new Error(`no org ${orgId}`);
  }

  rotateKey(orgId: string, apiKey = newApiKey()): string {
    if (apiKey.length < MIN_KEY_LENGTH) throw new Error(`API keys must be at least ${MIN_KEY_LENGTH} characters`);
    const { changes } = this.db.prepare("UPDATE orgs SET api_key_hash = ? WHERE id = ?").run(hashKey(apiKey), orgId);
    if (!changes) throw new Error(`no org ${orgId}`);
    return apiKey;
  }

  spentThisMonthMicros(orgId: string): number {
    const row = this.db
      .prepare("SELECT COALESCE(SUM(amount_micros), 0) AS spent FROM receipts WHERE org_id = ? AND at >= ?")
      .get(orgId, monthStart(this.now())) as { spent: number };
    return Number(row.spent);
  }

  refundsDueMicros(orgId: string): number {
    const row = this.db
      .prepare("SELECT COALESCE(SUM(refund_due_micros), 0) AS due FROM receipts WHERE org_id = ?")
      .get(orgId) as { due: number };
    return Number(row.due);
  }

  pendingMicros(orgId: string): number {
    return this.reserved.get(orgId) ?? 0;
  }

  // Holds the worst-case cost of a purchase against the month's budget before anything is
  // signed. Synchronous, so two requests can't interleave between the check and the hold.
  reserve(orgId: string, capMicros: number, budgetMicros: number): boolean {
    const pending = this.pendingMicros(orgId);
    if (this.spentThisMonthMicros(orgId) + pending + capMicros > budgetMicros) return false;
    this.reserved.set(orgId, pending + capMicros);
    return true;
  }

  release(orgId: string, capMicros: number): void {
    this.reserved.set(orgId, this.pendingMicros(orgId) - capMicros);
  }

  record(fields: Omit<Receipt, "id" | "at" | "refundDueMicros" | "network" | "transaction" | "costCenter" | "approvalId"> &
    Partial<Pick<Receipt, "refundDueMicros" | "network" | "transaction" | "costCenter" | "approvalId">>): Receipt {
    const receipt: Receipt = {
      id: randomUUID(),
      at: this.now().toISOString(),
      costCenter: "",
      refundDueMicros: 0,
      network: null,
      transaction: null,
      approvalId: null,
      ...fields,
    };
    this.db
      .prepare(
        `INSERT INTO receipts (id, org_id, at, status, reason, seller_id, requested_by, record_id, cost_center,
          amount_micros, refund_due_micros, network, transaction_ref, approval_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        receipt.id, receipt.orgId, receipt.at, receipt.status, receipt.reason, receipt.sellerId,
        receipt.requestedBy, receipt.recordId, receipt.costCenter, receipt.amountMicros,
        receipt.refundDueMicros, receipt.network, receipt.transaction, receipt.approvalId,
      );
    return receipt;
  }

  receiptsBetween(orgId: string, from: string, to: string): Receipt[] {
    return this.db
      .prepare("SELECT * FROM receipts WHERE org_id = ? AND at >= ? AND at < ? ORDER BY at, rowid")
      .all(orgId, from, to)
      .map(toReceipt);
  }

  createApproval(fields: Pick<Approval, "orgId" | "sellerId" | "params" | "requestedBy" | "recordId" | "costCenter" | "priceMicros">): Approval {
    const approval: Approval = {
      id: randomUUID(),
      status: "pending",
      createdAt: this.now().toISOString(),
      decidedAt: null,
      decidedBy: null,
      decisionNote: null,
      ...fields,
    };
    this.db
      .prepare(
        `INSERT INTO approvals (id, org_id, status, seller_id, params_json, requested_by, record_id,
          cost_center, price_micros, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        approval.id, approval.orgId, approval.status, approval.sellerId, JSON.stringify(approval.params),
        approval.requestedBy, approval.recordId, approval.costCenter, approval.priceMicros, approval.createdAt,
      );
    return approval;
  }

  getApproval(orgId: string, id: string): Approval | null {
    const row = this.db.prepare("SELECT * FROM approvals WHERE org_id = ? AND id = ?").get(orgId, id);
    return row ? toApproval(row) : null;
  }

  pendingApprovals(orgId: string): Approval[] {
    return this.db
      .prepare("SELECT * FROM approvals WHERE org_id = ? AND status = 'pending' ORDER BY created_at")
      .all(orgId)
      .map(toApproval);
  }

  // Moves a pending approval to its decision exactly once; returns false if it was already decided.
  decideApproval(orgId: string, id: string, status: "approved" | "denied", decidedBy: string, note: string): boolean {
    const { changes } = this.db
      .prepare("UPDATE approvals SET status = ?, decided_at = ?, decided_by = ?, decision_note = ? WHERE org_id = ? AND id = ? AND status = 'pending'")
      .run(status, this.now().toISOString(), decidedBy, note, orgId, id);
    return changes === 1;
  }

  // Approvals decided in [from, to), each with the latest receipt it produced.
  decisionLog(orgId: string, from: string, to: string): DecisionLogEntry[] {
    return this.db
      .prepare(
        `SELECT a.*, r.status AS outcome_status, r.amount_micros AS outcome_amount_micros, r.transaction_ref AS outcome_transaction
         FROM approvals a
         LEFT JOIN receipts r ON r.rowid = (
           SELECT rowid FROM receipts WHERE org_id = a.org_id AND approval_id = a.id AND status != 'pending_approval'
           ORDER BY at DESC, rowid DESC LIMIT 1)
         WHERE a.org_id = ? AND a.decided_at >= ? AND a.decided_at < ?
         ORDER BY a.decided_at, a.rowid`,
      )
      .all(orgId, from, to)
      .map((row: any) => ({
        ...toApproval(row),
        outcomeStatus: row.outcome_status ?? null,
        outcomeAmountMicros: Number(row.outcome_amount_micros ?? 0),
        outcomeTransaction: row.outcome_transaction ?? null,
      }));
  }

  isExpired(approval: Approval): boolean {
    return this.now().getTime() - Date.parse(approval.createdAt) > APPROVAL_TTL_MS;
  }

  recent(orgId: string, limit = 50): Receipt[] {
    return this.db
      .prepare("SELECT * FROM receipts WHERE org_id = ? ORDER BY at DESC, rowid DESC LIMIT ?")
      .all(orgId, limit)
      .map(toReceipt);
  }

  close(): void {
    this.db.close();
  }
}

function toOrg(row: any): Org {
  return { id: row.id, name: row.name, policy: JSON.parse(row.policy_json), createdAt: row.created_at };
}

function toReceipt(row: any): Receipt {
  return {
    id: row.id,
    orgId: row.org_id,
    at: row.at,
    status: row.status,
    reason: row.reason,
    sellerId: row.seller_id,
    requestedBy: row.requested_by,
    recordId: row.record_id,
    costCenter: row.cost_center,
    amountMicros: Number(row.amount_micros),
    refundDueMicros: Number(row.refund_due_micros),
    network: row.network,
    transaction: row.transaction_ref,
    approvalId: row.approval_id,
  };
}

function toApproval(row: any): Approval {
  return {
    id: row.id,
    orgId: row.org_id,
    status: row.status,
    sellerId: row.seller_id,
    params: JSON.parse(row.params_json),
    requestedBy: row.requested_by,
    recordId: row.record_id,
    costCenter: row.cost_center,
    priceMicros: Number(row.price_micros),
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
    decisionNote: row.decision_note ?? null,
  };
}
