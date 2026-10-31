import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createGateApp } from "../src/gate.ts";
import { Store } from "../src/store.ts";
import { MockRail } from "../src/rails.ts";
import { validateCatalog, validateOrgPolicy, type Catalog, type OrgPolicy, type Seller } from "../src/config.ts";

const KEY = "test-key-that-is-long-enough-123";
const OTHER_KEY = "other-key-that-is-long-enough-456";

const enrich: Seller = {
  id: "demo-enrich",
  name: "Demo",
  url: "http://127.0.0.1:4021/enrich",
  allowedParams: { domain: "[a-z0-9-]+(\\.[a-z0-9-]+)+" },
  network: "eip155:84532",
  priceUsd: 0.01,
};
const checked: Seller = {
  ...enrich,
  id: "checked-enrich",
  resultCheck: { matchParam: "domain", requiredFields: ["companyName", "industry"] },
};
const premium: Seller = { ...enrich, id: "demo-enrich-premium", url: "http://127.0.0.1:4021/enrich-premium", priceUsd: 0.5 };
const unused: Seller = { ...enrich, id: "not-enabled" };

const catalog: Catalog = validateCatalog({ sellers: [enrich, checked, premium, unused] });

const policy: OrgPolicy = validateOrgPolicy(
  {
    maxPerCallUsd: 0.01,
    monthlyBudgetUsd: 0.02,
    sellers: { "demo-enrich": {}, "checked-enrich": {}, "demo-enrich-premium": {} },
  },
  catalog,
);

function setup(rail = new MockRail(), opts: { path?: string; clock?: { now: Date } } = {}) {
  const clock = opts.clock ?? { now: new Date("2026-10-15T12:00:00Z") };
  const store = new Store(opts.path ?? ":memory:", () => clock.now);
  if (store.listOrgs().length === 0) store.createOrg("Acme", policy, KEY);
  const org = store.orgForKey(KEY)!;
  const app = createGateApp({ catalog, rail, store });
  const buy = (body: unknown, key = KEY) =>
    app.request("/purchase", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
  const get = async (path: string, key = KEY) =>
    (await app.request(path, { headers: { Authorization: `Bearer ${key}` } })).json();
  return { app, store, org, rail, buy, get, clock };
}

const ok = { sellerId: "demo-enrich", params: { domain: "acme.com" }, requestedBy: "005xx0000012345", recordId: "001xx0000067890" };

test("an approved purchase within limits is paid and receipted", async () => {
  const { buy, store, org } = setup();
  const json = await (await buy(ok)).json();
  assert.equal(json.status, "paid");
  assert.equal(json.receipt.amountUsd, 0.005);
  assert.equal(json.receipt.recordId, "001xx0000067890");
  assert.equal(store.spentThisMonthMicros(org.id), 5_000);
  assert.equal(store.pendingMicros(org.id), 0);
});

test("requests without a valid key are rejected and nothing is bought", async () => {
  const { buy, rail } = setup();
  const res = await buy(ok, "wrong-key-wrong-key-wrong-key-wrong");
  assert.equal(res.status, 401);
  assert.equal(rail.calls.length, 0);
});

test("a seller that isn't on the approved list is blocked before any payment", async () => {
  const { buy, rail } = setup();
  const json = await (await buy({ ...ok, sellerId: "unknown-seller" })).json();
  assert.equal(json.status, "blocked");
  assert.match(json.reason, /approved list/);
  assert.equal(rail.calls.length, 0);
});

test("a catalog seller the org hasn't enabled is blocked", async () => {
  const { buy, rail } = setup();
  const json = await (await buy({ ...ok, sellerId: "not-enabled" })).json();
  assert.equal(json.status, "blocked");
  assert.equal(rail.calls.length, 0);
});

test("the caller cannot steer the gate to another URL or parameter", async () => {
  const { buy, rail } = setup();
  const extra = await (await buy({ ...ok, params: { domain: "acme.com", url: "https://evil.example" } })).json();
  assert.equal(extra.status, "blocked");
  const bad = await (await buy({ ...ok, params: { domain: "acme.com/../../admin" } })).json();
  assert.equal(bad.status, "blocked");
  const proto = await (await buy({ ...ok, sellerId: "__proto__" })).json();
  assert.equal(proto.status, "blocked");
  assert.equal(rail.calls.length, 0);
});

test("a seller quoting above its listed price is refused and costs nothing", async () => {
  const { buy, store, org, rail } = setup(new MockRail(500_000));
  const json = await (await buy(ok)).json();
  assert.equal(json.status, "refused");
  assert.match(json.reason, /above the \$0\.01 limit/);
  assert.equal(rail.calls.length, 1);
  assert.equal(store.spentThisMonthMicros(org.id), 0);
  assert.equal(store.pendingMicros(org.id), 0);
});

test("a seller's own limit in the org policy is tighter than the org limit", async () => {
  const { buy, store, org } = setup(new MockRail(5_000));
  store.setPolicy(org.id, { ...policy, sellers: { ...policy.sellers, "demo-enrich": { maxPerCallUsd: 0.001 } } });
  const json = await (await buy(ok)).json();
  assert.equal(json.status, "refused");
});

test("the mock rail charges each seller its own price", async () => {
  const { buy, store, org } = setup(new MockRail(5_000, "ok", { "demo-enrich-premium": 500_000 }));
  assert.equal((await (await buy({ ...ok, sellerId: "demo-enrich-premium" })).json()).status, "refused");
  assert.equal((await (await buy(ok)).json()).status, "paid");
  assert.equal(store.spentThisMonthMicros(org.id), 5_000);
});

test("a result that passes its checks is paid and handed back", async () => {
  const { buy } = setup();
  const json = await (await buy({ ...ok, sellerId: "checked-enrich" })).json();
  assert.equal(json.status, "paid");
  assert.equal(json.data.domain, "acme.com");
  assert.equal(json.receipt.refundDueUsd, 0);
});

test("a result for the wrong company is withheld and booked as a refund owed", async () => {
  const { buy, get, store, org } = setup();
  const json = await (await buy({ ...ok, sellerId: "checked-enrich", params: { domain: "mismatch-co.com" } })).json();
  assert.equal(json.status, "rejected");
  assert.equal(json.data, undefined);
  assert.match(json.reason, /asked for domain mismatch-co\.com/);
  assert.equal(json.receipt.amountUsd, 0.005);
  assert.equal(json.receipt.refundDueUsd, 0.005);
  assert.equal(store.refundsDueMicros(org.id), 5_000);
  assert.equal((await get("/budget")).refundsDueUsd, 0.005);
});

test("when the seller has no data, nothing is charged", async () => {
  const { buy, store, org } = setup();
  const json = await (await buy({ ...ok, sellerId: "checked-enrich", params: { domain: "unknown-co.com" } })).json();
  assert.equal(json.status, "no_result");
  assert.equal(json.receipt.amountUsd, 0);
  assert.equal(store.spentThisMonthMicros(org.id), 0);
  assert.equal(store.pendingMicros(org.id), 0);
});

test("the monthly budget holds across sequential purchases", async () => {
  const { buy, store, org } = setup(new MockRail(10_000));
  assert.equal((await (await buy(ok)).json()).status, "paid");
  assert.equal((await (await buy(ok)).json()).status, "paid");
  const third = await (await buy(ok)).json();
  assert.equal(third.status, "blocked");
  assert.match(third.reason, /monthly budget/);
  assert.equal(store.spentThisMonthMicros(org.id), 20_000);
});

test("the budget starts fresh in a new month", async () => {
  const clock = { now: new Date("2026-10-31T23:00:00Z") };
  const { buy } = setup(new MockRail(10_000), { clock });
  await buy(ok);
  await buy(ok);
  assert.equal((await (await buy(ok)).json()).status, "blocked");
  clock.now = new Date("2026-11-01T00:00:01Z");
  assert.equal((await (await buy(ok)).json()).status, "paid");
});

test("concurrent purchases cannot overspend the monthly budget", async () => {
  const rail = new MockRail(10_000, "slow");
  const { buy, store, org } = setup(rail);
  const results = await Promise.all(Array.from({ length: 6 }, () => buy(ok).then((r) => r.json())));
  assert.equal(results.filter((r) => r.status === "paid").length, 2);
  assert.equal(rail.calls.length, 2);
  assert.equal(store.spentThisMonthMicros(org.id), 20_000);
  assert.equal(store.pendingMicros(org.id), 0);
});

test("a failed purchase releases its reservation", async () => {
  const { buy, store, org } = setup(new MockRail(5_000, "fail"));
  const json = await (await buy(ok)).json();
  assert.equal(json.status, "failed");
  assert.equal(store.spentThisMonthMicros(org.id), 0);
  assert.equal(store.pendingMicros(org.id), 0);
});

test("orgs can't see each other's receipts or spend each other's budget", async () => {
  const { buy, get, store } = setup(new MockRail(10_000));
  store.createOrg("Globex", policy, OTHER_KEY);
  await buy(ok);
  await buy(ok);
  assert.equal((await (await buy(ok)).json()).status, "blocked");

  // Acme's budget is used up; Globex's is untouched, and neither sees the other's receipts.
  assert.equal((await (await buy(ok, OTHER_KEY)).json()).status, "paid");
  assert.equal((await get("/receipts", OTHER_KEY)).receipts.length, 1);
  assert.equal((await get("/receipts")).receipts.length, 3);
  assert.equal((await get("/budget", OTHER_KEY)).org, "Globex");
});

test("a rotated key stops working and the new one works", async () => {
  const { buy, store, org } = setup();
  const fresh = store.rotateKey(org.id);
  assert.equal((await buy(ok)).status, 401);
  assert.equal((await (await buy(ok, fresh)).json()).status, "paid");
});

test("keys are stored only as hashes", () => {
  const { store } = setup();
  const { apiKey } = store.createOrg("Initech", policy);
  assert.match(apiKey, /^asg_/);
  assert.ok(store.orgForKey(apiKey));
  assert.equal(store.orgForKey(apiKey.slice(0, -1)), null);
  assert.throws(() => store.createOrg("Short", policy, "too-short"), /at least 24/);
});

test("every attempt, including blocked ones, is in the receipt log and survives a restart", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "gate-")), "gate.db");
  const first = setup(new MockRail(), { path });
  await first.buy(ok);
  await first.buy({ ...ok, sellerId: "unknown-seller" });
  first.store.close();

  const second = setup(new MockRail(), { path });
  assert.equal(second.store.spentThisMonthMicros(second.org.id), 5_000);
  const { receipts } = await second.get("/receipts");
  assert.deepEqual(receipts.map((r: { status: string }) => r.status), ["blocked", "paid"]);
});

test("a catalog seller without https is rejected", () => {
  assert.throws(() => validateCatalog({ sellers: [{ ...enrich, url: "http://data.example.com/enrich" }] }), /https/);
});

test("a result check naming a parameter the seller doesn't accept is rejected", () => {
  assert.throws(() => validateCatalog({ sellers: [{ ...enrich, resultCheck: { matchParam: "email" } }] }), /matchParam/);
});

test("a policy naming a seller outside the catalog is rejected", () => {
  assert.throws(() => validateOrgPolicy({ ...policy, sellers: { "made-up": {} } }, catalog), /isn't in the catalog/);
});

// Approvals: purchases listed above the org's threshold wait for a person.

function approvalSetup(rail = new MockRail()) {
  const s = setup(rail);
  s.store.setPolicy(s.org.id, { ...policy, approvalOverUsd: 0.005 });
  const decide = async (id: string, decision: string, key = KEY) =>
    s.app.request(`/approvals/${id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ decision, decidedBy: "005xx00000APPROVER" }),
    });
  return { ...s, decide };
}

test("a purchase above the approval threshold waits and buys nothing", async () => {
  const { buy, get, rail } = approvalSetup();
  const json = await (await buy({ ...ok, costCenter: "Sales EMEA" })).json();
  assert.equal(json.status, "pending_approval");
  assert.match(json.reason, /approval threshold/);
  assert.ok(json.approvalId);
  assert.equal(json.receipt.approvalId, json.approvalId);
  assert.equal(rail.calls.length, 0);
  const { approvals } = await get("/approvals");
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].costCenter, "Sales EMEA");
  assert.equal(approvals[0].priceUsd, 0.01);
});

test("an approved purchase is bought once, and can't be approved again", async () => {
  const { buy, decide, get, rail } = approvalSetup();
  const { approvalId } = await (await buy(ok)).json();
  const approved = await (await decide(approvalId, "approve")).json();
  assert.equal(approved.status, "paid");
  assert.equal(approved.reason, "approved, within policy");
  assert.equal(approved.receipt.approvalId, approvalId);
  assert.equal((await decide(approvalId, "approve")).status, 409);
  assert.equal(rail.calls.length, 1);
  assert.equal((await get("/approvals")).approvals.length, 0);
});

test("simultaneous approvals of one request buy only once", async () => {
  const { buy, decide, rail } = approvalSetup(new MockRail(5_000, "slow"));
  const { approvalId } = await (await buy(ok)).json();
  const results = await Promise.all([decide(approvalId, "approve"), decide(approvalId, "approve")]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(rail.calls.length, 1);
});

test("a denied purchase is receipted and nothing is bought", async () => {
  const { buy, decide, rail } = approvalSetup();
  const { approvalId } = await (await buy(ok)).json();
  const denied = await (await decide(approvalId, "deny")).json();
  assert.equal(denied.status, "denied");
  assert.match(denied.reason, /denied by 005xx00000APPROVER/);
  assert.equal(rail.calls.length, 0);
});

test("an approval request expires after 7 days", async () => {
  const { buy, decide, clock, rail } = approvalSetup();
  const { approvalId } = await (await buy(ok)).json();
  clock.now = new Date(clock.now.getTime() + 8 * 24 * 60 * 60 * 1000);
  const json = await (await decide(approvalId, "approve")).json();
  assert.equal(json.status, "denied");
  assert.match(json.reason, /expired/);
  assert.equal(rail.calls.length, 0);
});

test("approval re-checks the rules as they stand when it is approved", async () => {
  const { buy, decide, store, org, rail } = approvalSetup();
  const { approvalId } = await (await buy(ok)).json();
  store.setPolicy(org.id, { ...policy, approvalOverUsd: 0.005, sellers: { "checked-enrich": {} } });
  const json = await (await decide(approvalId, "approve")).json();
  assert.equal(json.status, "blocked");
  assert.match(json.reason, /approved list/);
  assert.equal(rail.calls.length, 0);
});

test("one org can't decide another org's approval", async () => {
  const { buy, decide, store } = approvalSetup();
  store.createOrg("Globex", policy, OTHER_KEY);
  const { approvalId } = await (await buy(ok)).json();
  assert.equal((await decide(approvalId, "approve", OTHER_KEY)).status, 404);
});

// Finance statement.

test("the monthly statement totals spend and refunds by seller and cost center", async () => {
  const { buy, get } = setup();
  await buy({ ...ok, costCenter: "Sales" });
  await buy({ ...ok, costCenter: "Sales" });
  await buy({ ...ok, sellerId: "checked-enrich", params: { domain: "mismatch-co.com" }, costCenter: "Marketing" });
  await buy({ ...ok, sellerId: "unknown-seller" });

  const s = await get("/statement?month=2026-10");
  assert.equal(s.month, "2026-10");
  const sales = s.lines.find((l: any) => l.sellerId === "demo-enrich" && l.costCenter === "Sales");
  assert.equal(sales.purchases, 2);
  assert.equal(sales.paidUsd, 0.01);
  const marketing = s.lines.find((l: any) => l.costCenter === "Marketing");
  assert.equal(marketing.counts.rejected, 1);
  assert.equal(marketing.refundsDueUsd, 0.005);
  assert.equal(marketing.netUsd, 0);
  assert.deepEqual(s.totals, { paidUsd: 0.015, refundsDueUsd: 0.005, netUsd: 0.01 });
  assert.equal((await get("/statement?month=2026-09")).lines.length, 0);
});

test("the statement downloads as CSV with spreadsheet formulas neutralized", async () => {
  const { buy, app } = setup();
  await buy({ ...ok, costCenter: "-Ops" });
  const res = await app.request("/statement?month=2026-10&format=csv", { headers: { Authorization: `Bearer ${KEY}` } });
  assert.equal(res.headers.get("Content-Type"), "text/csv");
  const [header, row] = (await res.text()).trim().split("\n");
  assert.match(header, /^"month","seller_id"/);
  assert.match(row, /"'-Ops"/);
});

test("an unreadable month is refused", async () => {
  const { app } = setup();
  const res = await app.request("/statement?month=October", { headers: { Authorization: `Bearer ${KEY}` } });
  assert.equal(res.status, 400);
});

test("a database from the first release gains the new columns", () => {
  const path = join(mkdtempSync(join(tmpdir(), "gate-")), "old.db");
  const old = new DatabaseSync(path);
  old.exec(`CREATE TABLE receipts (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, at TEXT NOT NULL, status TEXT NOT NULL,
    reason TEXT NOT NULL, seller_id TEXT NOT NULL, requested_by TEXT NOT NULL, record_id TEXT NOT NULL,
    amount_micros INTEGER NOT NULL, refund_due_micros INTEGER NOT NULL DEFAULT 0, network TEXT, transaction_ref TEXT)`);
  old.close();
  const store = new Store(path);
  const { org } = store.createOrg("Acme", policy, KEY);
  assert.equal(store.record({ orgId: org.id, status: "paid", reason: "x", sellerId: "s", requestedBy: "u", recordId: "", amountMicros: 1 }).costCenter, "");
  assert.equal(store.recent(org.id)[0].costCenter, "");
});
