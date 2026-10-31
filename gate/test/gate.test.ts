import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
};
const checked: Seller = {
  ...enrich,
  id: "checked-enrich",
  resultCheck: { matchParam: "domain", requiredFields: ["companyName", "industry"] },
};
const premium: Seller = { ...enrich, id: "demo-enrich-premium", url: "http://127.0.0.1:4021/enrich-premium" };
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

test("a price above the per-call limit is refused and costs nothing", async () => {
  const { buy, store, org } = setup(new MockRail(500_000));
  const json = await (await buy(ok)).json();
  assert.equal(json.status, "refused");
  assert.match(json.reason, /above the \$0\.01 limit/);
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
