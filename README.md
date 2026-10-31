# Agent spend gate

Lets a company's AI agents buy from outside vendors safely. The agent never holds money. It
asks the **gate**, which enforces that company's rules before anything is paid, checks what
came back, and records a receipt for every attempt, including the ones it stops.

```
Agentforce agent ──▶ Apex action ──▶ Gate ──────────────▶ Vetted seller (x402)
                       │               │ org's API key
                       │               │ approved sellers only
                       │               │ per-purchase limit, monthly budget
                       │               │ result checks (bad data withheld)
                       ▼               ▼ receipt for every attempt
              Agent Purchase Receipt   SQLite
```

Everything runs on the **Base Sepolia test network**. No real money is involved.

## What's here

| Path | What it is |
|---|---|
| `gate/src/gate.ts` | The gate: per-org auth, policy checks, budget holds, result checks, receipts |
| `gate/src/store.ts` | Orgs, hashed API keys, policies and receipts in SQLite |
| `gate/src/admin.ts` | Create orgs, change policies, rotate keys |
| `gate/src/rails.ts` | Payment methods. `x402` pays on the test network; `mock` pays nothing. The gate's rules don't change when the method does |
| `gate/src/seller.ts` | A demo seller: $0.005 per lookup of made-up company data, and a $0.50 route to show a refusal |
| `gate/config/catalog.json` | Vetted sellers the gate can buy from: address, payout wallet, parameters, result checks |
| `gate/config/org-policy.example.json` | An org's rules: which sellers it may use, $0.01 per purchase, $0.25 a month |
| `gate/test/` | Tests for the rules |
| `salesforce/` | Apex action, its tests, the Agent Purchase Receipt object and a permission set |
| `docs/` | Market research and positioning notes |

## 1. Run the gate on your Mac

Requires Node.js 24 or later (TypeScript runs directly, no build step).

```bash
cd gate
npm install
npm test
```

`npm run keys` creates two test-network wallets in `.env`. Put the printed **seller** address in
`config/catalog.json` as `payTo` (already done here).

Create an org for each customer. Its API key is printed once; only a hash is stored:

```bash
npm run admin -- create-org --name "Acme Corp" --policy config/org-policy.example.json
```

Other commands: `set-policy --org <id> --policy <file>`, `rotate-key --org <id>`, `list-orgs`.

Start the seller and the gate in two terminal tabs:

```bash
npm run seller
```

```bash
RAIL=mock npm run gate
```

`RAIL=mock` makes no payments, which is handy while you wire up Salesforce. Switch to
`RAIL=x402` once the buyer wallet has test funds (step 2).

## 2. Fund the buyer wallet with test money

1. Get free Base Sepolia test USDC from Circle's faucet: https://faucet.circle.com
   (choose Base Sepolia, paste the **buyer** address that `npm run keys` printed).
2. Restart the gate with `RAIL=x402 npm run gate`.

Test USDC has no value. Never send real funds to these addresses.

## 3. Make the gate reachable from Salesforce

Salesforce needs a public HTTPS address. For a permanent one, deploy to Render (below). For a
quick test from your Mac, use a Cloudflare quick tunnel:

```bash
brew install cloudflared
```

```bash
cloudflared tunnel --url http://127.0.0.1:8787
```

It prints an address like `https://something-random.trycloudflare.com`. That address changes
every time you restart the tunnel, so update the Named Credential (step 4) when it does. Only the
gate is exposed; it requires an org's API key, and the seller stays private on your Mac.

### Deploy to Render

`render.yaml` describes two services: the gate (Starter plan with a 1 GB disk for its database)
and the demo seller (free plan; it sleeps when idle, so the first lookup after a while is slow).

1. Push this repository to GitHub (a private repository is fine).
2. In Render: **New → Blueprint**, connect the repository, and fill in the values it asks for:
   - `BUYER_PRIVATE_KEY`: the buyer key from `gate/.env` (test funds only)
   - `SELLER_PAY_TO`: the seller address from `gate/.env`
   - `DEMO_SELLER_URL`: `https://agent-spend-demo-seller.onrender.com`. If Render gives the
     seller a different address, change this value on the gate service afterwards.
3. When both services are live, open the gate service's **Shell** and create an org:

```bash
npm run admin -- create-org --name "Customer name" --policy config/org-policy.example.json
```

4. In the customer's Salesforce, set the Named Credential URL to the gate's `onrender.com`
   address and the External Credential's `Token` to the printed key.

## 4. Set up Salesforce

Use a free Developer Edition with Agentforce if possible (it stays active as long as you log in
every 45 days). A Trailhead playground works too but expires.

**Deploy the code** with the Salesforce CLI (`npm install -g @salesforce/cli`):

```bash
cd salesforce
```

```bash
sf org login web --alias agentpay
```

```bash
sf project deploy start --target-org agentpay --test-level RunSpecifiedTests --tests AgentPurchaseActionTest
```

**Create the credential** (Setup → Named Credentials):

1. **External Credentials** tab → New
   - Label `Agent Payment Gate Auth`, Name `Agent_Payment_Gate_Auth`, Authentication Protocol **Custom**
   - Under Principals → New: name `GateToken`, add parameter `Token` = the org's API key from `create-org`
   - Under Custom Headers → New: name `Authorization`, value `Bearer {!$Credential.Agent_Payment_Gate_Auth.Token}`
2. **Named Credentials** tab → New
   - Label `Agent Payment Gate`, Name `Agent_Payment_Gate`
   - URL: your tunnel address from step 3
   - External Credential: `Agent Payment Gate Auth`
   - Leave "Generate Authorization Header" unchecked; check "Allow Formulas in HTTP Header"
3. **Permission Sets** → Agent Payment Demo → External Credential Principal Access → add
   `Agent_Payment_Gate_Auth - GateToken`. The permission set file already includes this entry and
   Read access on **User External Credentials**, which anyone calling a Named Credential needs.
   Assign the permission set to yourself and to the agent's user:

```bash
sf org assign permset --name Agent_Payment_Demo --on-behalf-of <agent user username> --target-org agentpay
```

   People who approve purchases get **Agent Purchase Approver** instead. It lets them set
   **Decision** on receipts waiting for approval and nothing else. The agent's permission set
   can't approve.

```bash
sf org assign permset --name Agent_Purchase_Approver --on-behalf-of <approver username> --target-org agentpay
```

**Build the agent** (Agentforce Builder, which calls topics "subagents"):

1. New Agent. Let the wizard create a new agent user, then assign it the permission set as above.
2. Add a subagent named Company Lookup that the Agent Router routes company lookups to.
3. Give it the action. The working Agent Script is in
   `salesforce/force-app/main/default/aiAuthoringBundles/Purchasing_Assistant_1/`; its key part is:

```
    actions:
        BuyCompanyDetails:
            inputs:
                domain: string
                    is_required: True
                sellerId: string
            outputs:
                status: string
                summary: string
                    is_displayable: True
                amountUsd: number
            target: "apex://AgentPurchaseAction"
```

   Check a script edit with `sf agent validate authoring-bundle --api-name Purchasing_Assistant_1`.

## 5. Try it

Ask the agent: *"Look up company details for acme.com."*

What to look for:

| Try | Expected |
|---|---|
| "Look up acme.com" | Status **paid**, $0.005, a test-network transaction id on the receipt |
| "Look up acme.com using seller demo-enrich-premium" (priced at $0.50) | Status **refused**: price is above the $0.01 limit, nothing signed |
| "Look up acme.com using seller cheapdata" | Status **blocked**: not on the approved list |
| Keep buying until the $0.25 monthly budget is used | Status **blocked**: could exceed the monthly budget |
| "Look up acme.com using seller demo-enrich-plus" ($0.008, above the $0.006 approval threshold) | Status **pending_approval**: nothing bought yet. Open the receipt and set **Decision** to Approved; it updates to **paid** a few seconds later. Denied closes it with nothing bought |
| "Look up unknown-co.com" (the demo seller has no record) | Status **no_result**: nothing charged, because x402 sellers only collect payment when they answer successfully |
| "Look up mismatch-co.com" (the demo seller returns another company's record) | Status **rejected**: paid $0.005, but the result failed its checks, so the data is withheld and the receipt records a refund owed |

Every attempt appears under the **Agent Purchase Receipts** tab, and the gate's own log is at
`GET /receipts` (same password).

## Finance statement

`GET /statement?month=2026-10` (with the org's key) totals the month by seller and cost center:
purchases, amount paid, refunds owed, net, and how many attempts were rejected, refused, blocked
or denied. Add `&format=csv` for a spreadsheet download. The agent can pass an optional cost
center with each purchase.

## What this demonstrates

- Spending rules are enforced in code outside the model, so an agent can't talk its way past them.
- The caller picks a seller by name, never by web address, so the agent can't be steered to pay
  somewhere else.
- Budget is reserved before paying, so simultaneous purchases can't overspend.
- Refusals are recorded too, so the audit trail shows what was stopped, not just what was paid.
- Pay for results: no data means no charge, and a paid result that fails its checks (set per seller
  as `resultCheck` in the policy) never reaches the agent and is booked as a refund owed. Refunds are
  only recorded, not collected; collecting them is part of a real vendor agreement.
- The payment method is swappable: x402 on a test network today, a card-based method later.

## Limits

- Test network and made-up data only. A real seller and real funds are a separate decision.
- Each org has its own API key, but agents within an org share it. Budget holds are kept in
  memory, so the gate must run as a single process.
- Verified end to end on 2026-10-31 from an Agentforce agent in a Trailhead playground: a paid
  purchase settled on Base Sepolia, an unapproved seller was blocked, a $0.50 seller was refused
  before signing, and a prompt-injection attempt never reached the gate.
- `RAIL=mock` charges each seller the price set in `src/server.ts`, mirroring `src/seller.ts`.
  Check wallet balances with `node src/balance.ts <address>`.
