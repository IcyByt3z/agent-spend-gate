// Starts the payment gate. RAIL=mock runs without a wallet; RAIL=x402 pays on the test network.
// Orgs and their keys are managed with src/admin.ts.

import { serve } from "@hono/node-server";
import { loadCatalog } from "./config.ts";
import { Store } from "./store.ts";
import { MockRail, X402Rail, type Rail } from "./rails.ts";
import { createGateApp } from "./gate.ts";

const catalog = loadCatalog(process.env.CATALOG_FILE ?? "config/catalog.json");
const store = new Store(process.env.DATABASE_PATH ?? "data/gate.db");
const port = Number(process.env.PORT ?? process.env.GATE_PORT ?? 8787);
// Local runs stay private behind a tunnel; hosts like Render set HOST=0.0.0.0.
const hostname = process.env.HOST ?? "127.0.0.1";

let rail: Rail;
if ((process.env.RAIL ?? "mock") === "x402") {
  const key = process.env.BUYER_PRIVATE_KEY;
  if (!key) throw new Error("RAIL=x402 needs BUYER_PRIVATE_KEY (see npm run keys).");
  const x402 = new X402Rail(key);
  console.log(`Paying from test wallet ${x402.address}`);
  rail = x402;
} else {
  // Same prices as src/seller.ts: $0.005 by default, $0.50 for the premium route.
  rail = new MockRail(5_000, "ok", { "demo-enrich-premium": 500_000 });
  console.log("Using the mock rail: no payments are made.");
}

if (store.listOrgs().length === 0) console.log("No orgs yet. Create one with: npm run admin -- create-org --name <name>");

const app = createGateApp({ catalog, rail, store });
serve({ fetch: app.fetch, port, hostname });
console.log(`Payment gate listening on http://${hostname}:${port}`);
