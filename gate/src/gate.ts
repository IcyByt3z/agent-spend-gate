// The payment gate: the only component that can spend. Each caller (a customer's Salesforce
// agent) authenticates with its org's API key, names an approved seller and parameters, and
// the gate enforces that org's policy, pays through its rail, and records a receipt for every
// attempt, paid or not.

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { toMicros, fromMicros, type Catalog, type Seller } from "./config.ts";
import type { Org, Receipt, Store } from "./store.ts";
import type { Rail } from "./rails.ts";

type PurchaseBody = {
  sellerId?: unknown;
  params?: unknown;
  requestedBy?: unknown;
  recordId?: unknown;
};

const ID_PATTERN = /^[A-Za-z0-9_.@-]{1,80}$/;

export function createGateApp(opts: { catalog: Catalog; rail: Rail; store: Store }) {
  const { catalog, rail, store } = opts;
  const app = new Hono<{ Variables: { org: Org } }>();

  app.get("/health", (c) => c.json({ ok: true }));

  app.use("/purchase", bodyLimit({ maxSize: 16 * 1024 }));
  app.use("*", async (c, next) => {
    if (c.req.path === "/health") return next();
    const header = c.req.header("Authorization") ?? "";
    const org = header.startsWith("Bearer ") ? store.orgForKey(header.slice(7)) : null;
    if (!org) return c.json({ error: "unauthorized" }, 401);
    c.set("org", org);
    return next();
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
      sellers: Object.keys(policy.sellers).map((sid) => ({
        id: sid,
        name: catalog.sellers.find((s) => s.id === sid)?.name ?? sid,
        maxPerCallUsd: Math.min(policy.sellers[sid].maxPerCallUsd ?? Infinity, policy.maxPerCallUsd),
      })),
    });
  });

  app.get("/receipts", (c) => c.json({ receipts: store.recent(c.get("org").id, 50).map(publicReceipt) }));

  app.post("/purchase", async (c) => {
    const org = c.get("org");
    let body: PurchaseBody;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "body must be JSON" }, 400);
    }

    const requestedBy = typeof body.requestedBy === "string" && ID_PATTERN.test(body.requestedBy) ? body.requestedBy : null;
    const recordId = typeof body.recordId === "string" && ID_PATTERN.test(body.recordId) ? body.recordId : "";
    const sellerId = typeof body.sellerId === "string" ? body.sellerId.slice(0, 80) : "";
    if (!requestedBy) return c.json({ error: "requestedBy is required" }, 400);

    const base = { orgId: org.id, sellerId, requestedBy, recordId };
    const block = (reason: string) => {
      const receipt = store.record({ ...base, status: "blocked", reason, amountMicros: 0 });
      return c.json({ status: "blocked", reason, receipt: publicReceipt(receipt) }, 200);
    };

    const sellerPolicy = Object.hasOwn(org.policy.sellers, sellerId) ? org.policy.sellers[sellerId] : undefined;
    const seller = sellerPolicy ? catalog.sellers.find((s) => s.id === sellerId) : undefined;
    if (!seller || !sellerPolicy) return block("seller is not on the approved list");

    const params = body.params && typeof body.params === "object" ? (body.params as Record<string, unknown>) : {};
    const url = new URL(seller.url);
    for (const [key, value] of Object.entries(params)) {
      const pattern = Object.hasOwn(seller.allowedParams, key) ? seller.allowedParams[key] : undefined;
      if (!pattern) return block(`parameter "${key}" isn't allowed for this seller`);
      if (typeof value !== "string" || !new RegExp(`^(?:${pattern})$`).test(value)) {
        return block(`parameter "${key}" has an invalid value`);
      }
      url.searchParams.set(key, value);
    }

    const capMicros = Math.min(toMicros(sellerPolicy.maxPerCallUsd ?? Infinity), toMicros(org.policy.maxPerCallUsd));
    if (!store.reserve(org.id, capMicros, toMicros(org.policy.monthlyBudgetUsd))) {
      return block("this purchase could exceed the monthly budget");
    }

    try {
      const result = await rail.buy({ seller, url: url.toString(), capMicros });
      if (!result.ok) {
        const status = result.refused ? "refused" : result.noResult ? "no_result" : "failed";
        const receipt = store.record({ ...base, status, reason: result.reason, amountMicros: 0 });
        return c.json({ status, reason: result.reason, receipt: publicReceipt(receipt) }, 200);
      }
      const paidMicros = Math.min(result.paidMicros, capMicros);
      const paid = { ...base, amountMicros: paidMicros, network: result.network ?? null, transaction: result.transaction ?? null };

      // The money has moved, so a bad result is withheld from the caller and booked as owed back.
      const problem = checkResult(seller, params, result.data);
      if (problem) {
        const reason = `result failed checks (${problem}); data withheld, seller owes a refund`;
        const receipt = store.record({ ...paid, status: "rejected", reason, refundDueMicros: paidMicros });
        return c.json({ status: "rejected", reason, receipt: publicReceipt(receipt) }, 200);
      }

      const receipt = store.record({ ...paid, status: "paid", reason: "within policy" });
      return c.json({ status: "paid", data: result.data, receipt: publicReceipt(receipt) }, 200);
    } finally {
      // Recorded receipts now count toward spend, so the hold can go.
      store.release(org.id, capMicros);
    }
  });

  return app;
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
    amountUsd: fromMicros(r.amountMicros),
    network: r.network,
    transaction: r.transaction,
    refundDueUsd: fromMicros(r.refundDueMicros),
  };
}

// Returns what is wrong with a seller's result, or null when it passes the seller's checks.
function checkResult(seller: Seller, params: Record<string, unknown>, data: unknown): string | null {
  const check = seller.resultCheck;
  if (!check) return null;
  if (!data || typeof data !== "object") return "response was not a record";
  const record = data as Record<string, unknown>;
  if (check.matchParam) {
    const asked = String(params[check.matchParam] ?? "").toLowerCase();
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
