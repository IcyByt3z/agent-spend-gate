// The payment gate: the only component that can spend. Each caller (a customer's Salesforce
// agent) authenticates with its org's API key, names an approved seller and parameters, and
// the gate enforces that org's policy, pays through its rail, checks the result, and records
// a receipt for every attempt, paid or not. Purchases above the org's approval threshold wait
// for a person to approve them.

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { toMicros, fromMicros, type Catalog, type Seller } from "./config.ts";
import type { Approval, DecisionLogEntry, Org, Receipt, ReceiptStatus, Store } from "./store.ts";
import type { Rail } from "./rails.ts";

const ID_PATTERN = /^[A-Za-z0-9_.@-]{1,80}$/;
const COST_CENTER_PATTERN = /^[A-Za-z0-9 _.-]{1,40}$/;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const NOTE_MIN = 5;
const NOTE_MAX = 500;

// A purchase that has passed the org's seller and parameter rules.
type Purchase = {
  seller: Seller;
  params: Record<string, string>;
  url: string;
  capMicros: number;
  priceMicros: number;
  requestedBy: string;
  recordId: string;
  costCenter: string;
};

type Outcome = { status: ReceiptStatus; reason: string; data?: unknown; approvalId?: string; receipt: Receipt };

export function createGateApp(opts: { catalog: Catalog; rail: Rail; store: Store; retryDelayMs?: number }) {
  const { catalog, rail, store } = opts;
  const retryDelayMs = opts.retryDelayMs ?? 2_000;
  const app = new Hono<{ Variables: { org: Org } }>();

  app.get("/health", (c) => c.json({ ok: true }));

  app.use("*", bodyLimit({ maxSize: 16 * 1024 }));
  app.use("*", async (c, next) => {
    if (c.req.path === "/health") return next();
    const header = c.req.header("Authorization") ?? "";
    const org = header.startsWith("Bearer ") ? store.orgForKey(header.slice(7)) : null;
    if (!org) return c.json({ error: "unauthorized" }, 401);
    c.set("org", org);
    return next();
  });

  // Checks a request against the org's approved sellers and their allowed parameters.
  // Returns the purchase, or the reason it is blocked.
  function vet(org: Org, sellerId: string, rawParams: unknown, who: { requestedBy: string; recordId: string; costCenter: string }): Purchase | string {
    const sellerPolicy = Object.hasOwn(org.policy.sellers, sellerId) ? org.policy.sellers[sellerId] : undefined;
    const seller = sellerPolicy ? catalog.sellers.find((s) => s.id === sellerId) : undefined;
    if (!seller || !sellerPolicy) return "seller is not on the approved list";

    const params: Record<string, string> = {};
    const url = new URL(seller.url);
    const given = rawParams && typeof rawParams === "object" ? (rawParams as Record<string, unknown>) : {};
    for (const [key, value] of Object.entries(given)) {
      const pattern = Object.hasOwn(seller.allowedParams, key) ? seller.allowedParams[key] : undefined;
      if (!pattern) return `parameter "${key}" isn't allowed for this seller`;
      if (typeof value !== "string" || !new RegExp(`^(?:${pattern})$`).test(value)) return `parameter "${key}" has an invalid value`;
      params[key] = value;
      url.searchParams.set(key, value);
    }

    const limitMicros = Math.min(toMicros(sellerPolicy.maxPerCallUsd ?? Infinity), toMicros(org.policy.maxPerCallUsd));
    const priceMicros = toMicros(seller.priceUsd);
    // Never pay more than the listed price, even when the limits would allow it.
    return { seller, params, url: url.toString(), capMicros: Math.min(limitMicros, priceMicros), priceMicros, ...who };
  }

  function receiptBase(org: Org, p: Pick<Purchase, "requestedBy" | "recordId" | "costCenter">, sellerId: string, approvalId?: string) {
    return { orgId: org.id, sellerId, requestedBy: p.requestedBy, recordId: p.recordId, costCenter: p.costCenter, approvalId: approvalId ?? null };
  }

  // Reserves budget, pays, checks the result and records the receipt.
  async function execute(org: Org, p: Purchase, approvalId?: string): Promise<Outcome> {
    const base = receiptBase(org, p, p.seller.id, approvalId);
    if (p.priceMicros > p.capMicros) {
      const reason = `listed price $${fromMicros(p.priceMicros)} is above the $${fromMicros(p.capMicros)} limit`;
      return { status: "refused", reason, receipt: store.record({ ...base, status: "refused", reason, amountMicros: 0 }) };
    }
    if (!store.reserve(org.id, p.capMicros, toMicros(org.policy.monthlyBudgetUsd))) {
      const reason = "this purchase could exceed the monthly budget";
      return { status: "blocked", reason, receipt: store.record({ ...base, status: "blocked", reason, amountMicros: 0 }) };
    }

    try {
      let result = await rail.buy({ seller: p.seller, url: p.url, capMicros: p.capMicros });
      // One more try when the seller certainly wasn't paid, such as a host waking from sleep.
      if (!result.ok && result.retryable) {
        await new Promise((r) => setTimeout(r, retryDelayMs));
        result = await rail.buy({ seller: p.seller, url: p.url, capMicros: p.capMicros });
      }
      if (!result.ok) {
        const status = result.refused ? "refused" : result.noResult ? "no_result" : "failed";
        return { status, reason: result.reason, receipt: store.record({ ...base, status, reason: result.reason, amountMicros: 0 }) };
      }
      const paidMicros = Math.min(result.paidMicros, p.capMicros);
      const paid = { ...base, amountMicros: paidMicros, network: result.network ?? null, transaction: result.transaction ?? null };

      // The money has moved, so a bad result is withheld from the caller and booked as owed back.
      const problem = checkResult(p.seller, p.params, result.data);
      if (problem) {
        const reason = `result failed checks (${problem}); data withheld, seller owes a refund`;
        return { status: "rejected", reason, receipt: store.record({ ...paid, status: "rejected", reason, refundDueMicros: paidMicros }) };
      }
      const reason = approvalId ? "approved, within policy" : "within policy";
      return { status: "paid", reason, data: result.data, receipt: store.record({ ...paid, status: "paid", reason }) };
    } finally {
      // Recorded receipts now count toward spend, so the hold can go.
      store.release(org.id, p.capMicros);
    }
  }

  const reply = (o: Outcome) => ({
    status: o.status,
    reason: o.reason,
    ...(o.data !== undefined ? { data: o.data } : {}),
    ...(o.approvalId ? { approvalId: o.approvalId } : {}),
    receipt: publicReceipt(o.receipt),
  });

  app.get("/budget", (c) => {
    const { id, name, policy } = c.get("org");
    const budgetMicros = toMicros(policy.monthlyBudgetUsd);
    const spent = store.spentThisMonthMicros(id);
    const pending = store.pendingMicros(id);
    return c.json({
      org: name,
      monthlyBudgetUsd: policy.monthlyBudgetUsd,
      spentThisMonthUsd: fromMicros(spent),
      pendingUsd: fromMicros(pending),
      remainingUsd: fromMicros(budgetMicros - spent - pending),
      refundsDueUsd: fromMicros(store.refundsDueMicros(id)),
      maxPerCallUsd: policy.maxPerCallUsd,
      approvalOverUsd: policy.approvalOverUsd ?? null,
      sellers: Object.keys(policy.sellers).map((sid) => {
        const s = catalog.sellers.find((x) => x.id === sid);
        return {
          id: sid,
          name: s?.name ?? sid,
          priceUsd: s?.priceUsd ?? null,
          maxPerCallUsd: Math.min(policy.sellers[sid].maxPerCallUsd ?? Infinity, policy.maxPerCallUsd),
        };
      }),
    });
  });

  app.get("/receipts", (c) => c.json({ receipts: store.recent(c.get("org").id, 50).map(publicReceipt) }));

  app.post("/purchase", async (c) => {
    const org = c.get("org");
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "body must be JSON" }, 400);
    }

    const requestedBy = typeof body.requestedBy === "string" && ID_PATTERN.test(body.requestedBy) ? body.requestedBy : null;
    if (!requestedBy) return c.json({ error: "requestedBy is required" }, 400);
    const recordId = typeof body.recordId === "string" && ID_PATTERN.test(body.recordId) ? body.recordId : "";
    const costCenter = typeof body.costCenter === "string" && COST_CENTER_PATTERN.test(body.costCenter) ? body.costCenter : "";
    const sellerId = typeof body.sellerId === "string" ? body.sellerId.slice(0, 80) : "";
    const who = { requestedBy, recordId, costCenter };

    const vetted = vet(org, sellerId, body.params, who);
    if (typeof vetted === "string") {
      return c.json(reply({ status: "blocked", reason: vetted, receipt: store.record({ ...receiptBase(org, who, sellerId), status: "blocked", reason: vetted, amountMicros: 0 }) }));
    }

    const threshold = org.policy.approvalOverUsd;
    if (threshold !== undefined && vetted.priceMicros > toMicros(threshold) && vetted.priceMicros <= vetted.capMicros) {
      const approval = store.createApproval({
        orgId: org.id,
        sellerId,
        params: vetted.params,
        requestedBy,
        recordId,
        costCenter,
        priceMicros: vetted.priceMicros,
      });
      const reason = `needs approval: listed price $${fromMicros(vetted.priceMicros)} is above the $${threshold} approval threshold`;
      const receipt = store.record({ ...receiptBase(org, who, sellerId, approval.id), status: "pending_approval", reason, amountMicros: 0 });
      return c.json(reply({ status: "pending_approval", reason, approvalId: approval.id, receipt }));
    }

    return c.json(reply(await execute(org, vetted)));
  });

  app.get("/approvals", (c) => c.json({ approvals: store.pendingApprovals(c.get("org").id).map(publicApproval) }));

  app.post("/approvals/:id/decision", async (c) => {
    const org = c.get("org");
    const approval = store.getApproval(org.id, c.req.param("id"));
    if (!approval) return c.json({ error: "no such approval" }, 404);

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "body must be JSON" }, 400);
    }
    const decision = body.decision;
    const decidedBy = typeof body.decidedBy === "string" && ID_PATTERN.test(body.decidedBy) ? body.decidedBy : null;
    if ((decision !== "approve" && decision !== "deny") || !decidedBy) {
      return c.json({ error: 'decision ("approve" or "deny") and decidedBy are required' }, 400);
    }
    // A decision without a reason leaves later reviewers nothing to check it against.
    const note = cleanNote(body.note);
    if (!note) return c.json({ error: `note explaining the decision is required (${NOTE_MIN}-${NOTE_MAX} characters)` }, 400);
    if (approval.status !== "pending") return c.json({ error: `already ${approval.status}`, approval: publicApproval(approval) }, 409);

    const base = receiptBase(org, approval, approval.sellerId, approval.id);
    const expired = store.isExpired(approval);
    if (decision === "deny" || expired) {
      if (!store.decideApproval(org.id, approval.id, "denied", expired ? "expired" : decidedBy, note)) {
        return c.json({ error: "already decided" }, 409);
      }
      const reason = expired ? "approval request expired before it was approved" : `denied by ${decidedBy}: ${note}`;
      return c.json(reply({ status: "denied", reason, approvalId: approval.id, receipt: store.record({ ...base, status: "denied", reason, amountMicros: 0 }) }));
    }

    // Decide first, so a second approval of the same request can't buy twice.
    if (!store.decideApproval(org.id, approval.id, "approved", decidedBy, note)) return c.json({ error: "already decided" }, 409);

    // The rules are checked again as they stand now; approval only lifts the threshold.
    const vetted = vet(org, approval.sellerId, approval.params, approval);
    if (typeof vetted === "string") {
      return c.json(reply({ status: "blocked", reason: vetted, approvalId: approval.id, receipt: store.record({ ...base, status: "blocked", reason: vetted, amountMicros: 0 }) }));
    }
    return c.json(reply({ ...(await execute(org, vetted, approval.id)), approvalId: approval.id }));
  });

  // Every approval decided in a month: who decided, why, and what happened, as JSON or CSV.
  app.get("/approvals/log", (c) => {
    const org = c.get("org");
    const range = monthRange(c.req.query("month"));
    if (!range) return c.json({ error: "month must look like 2026-10" }, 400);
    const decisions = store.decisionLog(org.id, range.from, range.to).map(publicDecision);

    if (c.req.query("format") === "csv") {
      const header = ["approval_id", "requested_at", "seller_id", "cost_center", "price_usd", "requested_by", "record_id",
        "decision", "decided_by", "decided_at", "note", "outcome", "paid_usd", "transaction"];
      const rows = decisions.map((d) => [
        d.id, d.createdAt, d.sellerId, d.costCenter, d.priceUsd, d.requestedBy, d.recordId,
        d.status, d.decidedBy, d.decidedAt, d.note, d.outcome, d.paidUsd, d.transaction,
      ]);
      c.header("Content-Disposition", `attachment; filename="agent-approvals-${range.month}.csv"`);
      return c.body([header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n", 200, { "Content-Type": "text/csv" });
    }
    return c.json({ org: org.name, month: range.month, decisions });
  });

  // Monthly statement for finance: totals by seller and cost center, as JSON or CSV.
  app.get("/statement", (c) => {
    const org = c.get("org");
    const range = monthRange(c.req.query("month"));
    if (!range) return c.json({ error: "month must look like 2026-10" }, 400);
    const { month, from, to } = range;
    const statement = buildStatement(store.receiptsBetween(org.id, from, to), catalog);

    if (c.req.query("format") === "csv") {
      const header = ["month", "seller_id", "seller_name", "cost_center", "purchases", "paid_usd", "refunds_due_usd", "net_usd", "rejected", "no_result", "refused", "blocked", "denied", "pending_approval"];
      const rows = statement.lines.map((l) => [
        month, l.sellerId, l.sellerName, l.costCenter, l.purchases, l.paidUsd, l.refundsDueUsd, l.netUsd,
        l.counts.rejected, l.counts.no_result, l.counts.refused, l.counts.blocked, l.counts.denied, l.counts.pending_approval,
      ]);
      c.header("Content-Disposition", `attachment; filename="agent-spend-${month}.csv"`);
      return c.body([header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n", 200, { "Content-Type": "text/csv" });
    }
    const decisions = store.decisionLog(org.id, from, to).map(publicDecision);
    return c.json({ org: org.name, month, ...statement, decisions });
  });

  return app;
}

type StatementLine = {
  sellerId: string;
  sellerName: string;
  costCenter: string;
  purchases: number;
  paidUsd: number;
  refundsDueUsd: number;
  netUsd: number;
  counts: Record<"rejected" | "no_result" | "refused" | "blocked" | "denied" | "pending_approval" | "failed", number>;
};

function buildStatement(receipts: Receipt[], catalog: Catalog) {
  const lines = new Map<string, StatementLine & { paidMicros: number; refundMicros: number }>();
  for (const r of receipts) {
    const key = `${r.sellerId}\u0000${r.costCenter}`;
    let line = lines.get(key);
    if (!line) {
      line = {
        sellerId: r.sellerId,
        sellerName: catalog.sellers.find((s) => s.id === r.sellerId)?.name ?? "(not in catalog)",
        costCenter: r.costCenter,
        purchases: 0,
        paidUsd: 0,
        refundsDueUsd: 0,
        netUsd: 0,
        counts: { rejected: 0, no_result: 0, refused: 0, blocked: 0, denied: 0, pending_approval: 0, failed: 0 },
        paidMicros: 0,
        refundMicros: 0,
      };
      lines.set(key, line);
    }
    if (r.status === "paid" || r.status === "rejected") line.purchases++;
    if (r.status !== "paid") line.counts[r.status]++;
    line.paidMicros += r.amountMicros;
    line.refundMicros += r.refundDueMicros;
  }
  const out = [...lines.values()].map(({ paidMicros, refundMicros, ...l }) => ({
    ...l,
    paidUsd: fromMicros(paidMicros),
    refundsDueUsd: fromMicros(refundMicros),
    netUsd: fromMicros(paidMicros - refundMicros),
  }));
  const sum = (f: (l: (typeof out)[number]) => number) => out.reduce((t, l) => t + toMicros(f(l)), 0);
  return {
    totals: { paidUsd: fromMicros(sum((l) => l.paidUsd)), refundsDueUsd: fromMicros(sum((l) => l.refundsDueUsd)), netUsd: fromMicros(sum((l) => l.netUsd)) },
    lines: out,
  };
}

function monthRange(raw: string | undefined): { month: string; from: string; to: string } | null {
  const month = raw ?? new Date().toISOString().slice(0, 7);
  if (!MONTH_PATTERN.test(month)) return null;
  const [y, m] = month.split("-").map(Number);
  return { month, from: new Date(Date.UTC(y, m - 1, 1)).toISOString(), to: new Date(Date.UTC(y, m, 1)).toISOString() };
}

// Collapses whitespace and drops control characters; returns null unless the note is a usable length.
function cleanNote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const note = raw.replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim();
  return note.length >= NOTE_MIN && note.length <= NOTE_MAX ? note : null;
}

// Quotes every cell and neutralizes leading characters spreadsheets treat as formulas.
function csvCell(value: unknown): string {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

function publicReceipt(r: Receipt) {
  return {
    id: r.id,
    at: r.at,
    status: r.status,
    reason: r.reason,
    sellerId: r.sellerId,
    requestedBy: r.requestedBy,
    recordId: r.recordId,
    costCenter: r.costCenter,
    amountUsd: fromMicros(r.amountMicros),
    network: r.network,
    transaction: r.transaction,
    refundDueUsd: fromMicros(r.refundDueMicros),
    approvalId: r.approvalId,
  };
}

function publicApproval(a: Approval) {
  return {
    id: a.id,
    status: a.status,
    sellerId: a.sellerId,
    params: a.params,
    requestedBy: a.requestedBy,
    recordId: a.recordId,
    costCenter: a.costCenter,
    priceUsd: fromMicros(a.priceMicros),
    createdAt: a.createdAt,
    decidedAt: a.decidedAt,
    decidedBy: a.decidedBy,
    note: a.decisionNote,
  };
}

function publicDecision(d: DecisionLogEntry) {
  return {
    ...publicApproval(d),
    outcome: d.outcomeStatus,
    paidUsd: fromMicros(d.outcomeAmountMicros),
    transaction: d.outcomeTransaction,
  };
}

// Returns what is wrong with a seller's result, or null when it passes the seller's checks.
function checkResult(seller: Seller, params: Record<string, string>, data: unknown): string | null {
  const check = seller.resultCheck;
  if (!check) return null;
  if (!data || typeof data !== "object") return "response was not a record";
  const record = data as Record<string, unknown>;
  if (check.matchParam) {
    const asked = (params[check.matchParam] ?? "").toLowerCase();
    const got = typeof record[check.matchParam] === "string" ? (record[check.matchParam] as string).toLowerCase() : "";
    if (got !== asked) return `asked for ${check.matchParam} ${asked}, got ${got || "nothing"}`;
  }
  const missing = (check.requiredFields ?? []).filter((f) => {
    const v = record[f];
    return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
  });
  if (missing.length) return `missing ${missing.join(", ")}`;
  return null;
}
