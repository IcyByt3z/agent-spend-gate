# Is there room for a neutral agent-spend control layer?

Research pass, 2026-10-31. Most sources are secondary (blogs, vendor comparison pages, trade press);
several are written by competitors. Product status claims should be checked against each vendor's own
docs before relying on them.

## Short answer

The gap is real, but narrower than "nobody does neutral spend controls."

- **Rail-neutral policy engines already exist** at the developer level (Openfort, Nevermined, Payman,
  Skyfire, Crossmint, a dozen more). "Neutral" alone is not a differentiator.
- **What is still thin:** spend governance owned by the company's admins and finance team, living inside
  the system where work is tracked (the CRM), with approvals, receipts and audit tied to business records,
  across rails. No Salesforce-native product for agent *purchases* turned up.
- **Salesforce is moving toward the space:** on 2026-10-27 it shipped hard budgets for AI *model* spend
  (Agent Fabric Model Wallet). It does not cover payments to outside vendors yet. That validates the need
  and is also the biggest risk.

## What each major player covers

| Player | What it controls | Rail | Gap left |
|---|---|---|---|
| **Stripe** | Link agent wallet: per-request approval, one-time cards, scoped tokens. Issuing for agents (private preview): per-agent limits, merchant categories, single-use cards, real-time approval webhooks | Stripe only | No native per-agent budgets outside Issuing; a public request (Apr 2026) asks for a governance layer with allowlists and approval thresholds |
| **Visa** Intelligent Commerce Connect (Apr 2026) | Tokenized agent credentials with consumer-set limits; can route to other networks | Cards | Limits set by consumer/issuer, not company business rules |
| **Mastercard** Agent Pay | Agent-scoped tokens, issuer limits, merchant categories, approvals for out-of-bounds charges | Cards (+ machine payments, Jun 2026) | Same: no per-agent attribution or company policy |
| **Coinbase** Agentic Wallets (Feb 2026), x402 client | Per-transaction and per-session caps, allowed payees/networks | Crypto (x402) | AgentKit itself does not enforce caps or approvals; no cross-rail view |
| **Ramp** Agent Cards (Mar 2026) | Tokenized per-agent virtual cards, limits, approvals, categories, dashboard | Ramp cards | Closest to the finance buyer, but card-only and Ramp-only |
| **Brex** | AI for expense review and policy; no agent cards found | Brex cards | — |
| **Salesforce** Agent Fabric (2026-10-27) | Model Wallet: hard dollar/token budgets on LLM calls per agent; FinOps dashboard | LLM usage only | Nothing on agent purchases, vendor payments, receipts or purchase approvals |

## Neutral / policy-layer vendors

Described in at least one source as not tied to a single rail: **Openfort** (policy engine, approvals,
audit logs), **Nevermined** (scoped delegations, audit trace), **Payman** (dashboard limits, approval
threshold), **Skyfire** (agent identity + capped tokens), **Crossmint** (cards + onchain). Plus smaller
MCP tools (AgentCard, AgentPays, SpendNod) and early products (Pink).

Pattern: almost all target **developers**, most lean **crypto/stablecoin**, and audit and approvals are
often thin or undocumented. None found targets the Salesforce admin or ties receipts to CRM records.

## Points the sources agree on

1. Limits must live **outside the agent**. Protocols (x402, AP2, ACP) deliberately leave policy to
   the implementer.
2. A cap on one rail **can't see spend on another**. A company using cards and x402 and API keys needs
   one place that adds it up.
3. Enterprises need **per-agent attribution, company business rules and a unified audit trail** on top
   of card-network controls.
4. Funding for agent *governance* is heavy (hundreds of millions in 2026), mostly security, not spend.

## What this means for the demo

The opening that still looks open:

> Agent spending governed as **Salesforce records**: admins set policy, approvals happen in Salesforce,
> every attempt (paid, blocked, refused) is a receipt linked to the Account or Opportunity, and the rail
> underneath is swappable: x402 today, Stripe Issuing or Ramp Agent Cards tomorrow.

Treat Stripe, Ramp and Coinbase as **rails to plug in**, not competitors to beat. The product is the
governance and audit layer in the business system, not the payment.

## Risks

- **Salesforce extends Model Wallet to purchases.** Likely eventually. Mitigation: move fast, stay
  multi-rail, consider becoming an AppExchange partner rather than a rival.
- **Ramp/Brex add CRM integrations.** They own the finance buyer already.
- **Demand timing.** Few companies let agents buy from outside vendors yet; the pain may be 12–24 months out.
- **Source quality.** Much of this comes from vendor blogs; verify before betting on specifics.

## Sources

- Stripe: [agentic commerce blog](https://stripe.com/blog/introducing-our-agentic-commerce-solutions), [MindStudio guide](https://www.mindstudio.ai/blog/stripe-agentic-commerce-suite-ai-agent-payments), [Startupik on spend limits](https://startupik.com/ai-agent-spending-limits-2026/), [Link balance for agents](https://runtimewire.com/article/stripe-link-balance-ai-agents-unattended-spending)
- Visa/Mastercard: [TechInformed](https://techinformed.com/visa-opens-one-integration-for-ai-agent-payments/), [Shatale](https://shatale.com/blog/mastercard-agent-pay-visa-intelligent-commerce), [Elogic](https://elogic.co/blog/agentic-payments/)
- Coinbase: [Agentic Wallets](https://eco.com/support/en/articles/14845485-coinbase-agentic-wallets-explained), [Nevermined x402 review](https://nevermined.ai/blog/coinbase-x402-review), [AgentKit on DEV](https://dev.to/livasticvm1primary/a-coinbase-agentkit-action-that-cannot-spend-usdc-by-default-48-tests-and-a-real-402-31fj)
- Ramp/Brex: [Ramp on agent spending controls](https://ramp.com/blog/ai-agent-spending-controls), [Ramp Agent Cards launch](https://stabledash.com/news/2026-03-11-ramp-launches-agent-cards-to-enable-secure-autonomous-ai-spending)
- Salesforce: [Salesforce Ben, Oct 27 2026](https://www.salesforceben.com/salesforce-launches-agent-kill-switch-and-new-cost-controls/), [RohitAI on Agent Fabric](https://rohitai.com/blog/salesforce-agent-fabric-spending-controls-limits), [Agentforce Commerce GA](https://www.cxtoday.com/crm/salesforce-agentforce-commerce-generally-available/)
- Neutral layers: [PinkWallet comparison (competitor-written)](https://pinkwallet.com/agentic/learn/ai-agent-spend-governance-tools-compared/), [Lemniscap: the agentic control plane](https://paragraph.com/@lemniscap/the-agentic-control-plane), [x402/AP2/UCP are not your spending policy](https://dev.to/suraj_khaitan_f893c243958/your-ai-agent-can-pay-now-x402-ap2-and-ucp-are-not-your-spending-policy-3l25)
- Funding: [Yahoo Finance on governance funding](https://finance.yahoo.com/technology/ai/articles/enterprise-ai-agent-funding-surges-093104627.html)
