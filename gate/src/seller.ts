// A demo x402 seller on the Base Sepolia test network. It returns made-up company
// data so the whole flow can run without real money or a real data vendor.

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { demoLookup } from "./demo-data.ts";

const NETWORK = "eip155:84532";
const payTo = process.env.SELLER_PAY_TO;
if (!payTo) throw new Error("Set SELLER_PAY_TO to the address that should receive test payments (see npm run keys).");
const port = Number(process.env.SELLER_PORT ?? 4021);

const facilitator = new HTTPFacilitatorClient({ url: process.env.FACILITATOR_URL ?? "https://x402.org/facilitator" });
const resourceServer = new x402ResourceServer(facilitator).register(NETWORK, new ExactEvmScheme());

const app = new Hono();

app.use(
  paymentMiddleware(
    {
      "GET /enrich": {
        accepts: [{ scheme: "exact", price: "$0.005", network: NETWORK, payTo }],
        description: "Demo company enrichment (fictional data)",
      },
      // Priced above the demo org's approval threshold, so each purchase waits for a person.
      "GET /enrich-plus": {
        accepts: [{ scheme: "exact", price: "$0.008", network: NETWORK, payTo }],
        description: "Demo enrichment plus (fictional data)",
      },
      // Priced above the gate's limit on purpose, to show a refusal before anything is signed.
      "GET /enrich-premium": {
        accepts: [{ scheme: "exact", price: "$0.50", network: NETWORK, payTo }],
        description: "Demo premium enrichment (fictional data)",
      },
    },
    resourceServer,
  ),
);

const DOMAIN = /^[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/i;

// An error status here means the x402 middleware cancels settlement: no record, no charge.
for (const [path, premium] of [["/enrich", false], ["/enrich-plus", true], ["/enrich-premium", true]] as const) {
  app.get(path, (c) => {
    const domain = c.req.query("domain") ?? "";
    if (!DOMAIN.test(domain)) return c.json({ error: "domain is required" }, 400);
    const record = demoLookup(domain, premium);
    return record ? c.json(record) : c.json({ error: "no record for this domain" }, 404);
  });
}

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
console.log(`Demo seller listening on http://127.0.0.1:${port} (paid on ${NETWORK} to ${payTo})`);
