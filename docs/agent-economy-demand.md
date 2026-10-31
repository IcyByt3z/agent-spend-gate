# What agents actually pay other agents for — demand evidence for an A2A intermediary/auditor service

Date: 2026-10-30. Read-only research. Nothing purchased, published or deployed.

## Question

Is there behavioral evidence (actual payments, not listings) that agents pay another agent to act as an
intermediary, exchange or auditor in authorized workflows? If not, what *do* they pay for, and where could an
auditor-like service attach to real demand?

## Evidence

### 1. x402 Bazaar — the largest public record of agent-to-service payments

Coinbase's Bazaar lists each paid endpoint with 30-day unique payers and calls.

| Finding | Number | Source |
|---|---|---|
| Endpoints listed | ~31,600–34,000 | Tanod (Oct 9), Low Key Builds (Oct 13) |
| Listings with ≤2 payers in 30 days | 77% | Low Key Builds |
| Listings with ≥10 payers | 1.3% | Low Key Builds |
| Median price | $0.01 per call | x402 Doctor (Oct 17) |
| Most-demanded category | Plain chain reads (balance, block, logs) at $0.001–$0.008 | Both crawls |
| Other categories with >1,000 summed payers | Web search, company/people enrichment, scraping, news | Tanod |
| **Token-risk / "safety" listings** | **3,351 listings, average < 2 payers** | Low Key Builds |
| Single top endpoint | AX1 `q-verdict`: AI verdict on a Base token, $0.02, 4,750 payers, 390k calls | Tanod |

Caveats: payers are wallets, not proven customers. Of resources with ≥20 payers, 101 of 242 showed ~1 call per
payer, consistent with test fleets or activity farming. Some counters may include verified-but-unsettled payloads.
Treat all figures as upper bounds.

Quote from the Oct 13 crawl: *"Everyone is building the trust layer, and few agents are buying it."*

### 2. An x402 auditor already exists and is cheap

x402 Doctor checks ~50,000 paid endpoints daily and sells agents a pre-payment verdict (`go` / `caution` /
`no_go`) for **$0.001**. Its own trust record shows 30/30 days payable and verified purchases through two
directories. It also spot-buys 30 random endpoints weekly:

- 74–83% delivered a proper answer.
- **0 took the money without answering** (failures did not charge).

So the most obvious intermediary value — protecting buyers from paying for nothing — currently protects very
little money. Non-delivery mostly costs nothing.

### 3. Virtuals ACP — historical revenue, currently dormant

Cumulative figures on agdp.io (2026-10-30): $4.08M revenue, 2.28M jobs, 39,322 agents launched.

| Agent | Jobs | Revenue | Revenue per job | Category |
|---|---:|---:|---:|---|
| Ethy AI | 1.1M | $572.8k | ~$0.52 | Trading execution and analysis |
| Director Lucien | 59.5k | $262.5k | ~$4.41 | Video generation |
| WhaleIntel | 39.1k | $115k | ~$2.94 | Token data and flows |
| Nox | 92.1k | $75.8k | ~$0.82 | (no listed offerings) |
| Axelrod | 41.6k | $28.1k | ~$0.68 | Trading execution |
| ArAIstotle | 87.9k | $22.3k | ~$0.25 | Fact-checking |
| Otto AI | 56.6k | $18k | ~$0.32 | Crypto research |
| OOPZ Labs | 43.1k | $555 | ~$0.01 | Surveys |

Current-activity signals on the same page:

- 30-day change in revenue and jobs: **0.00%**.
- Most recent completed jobs listed: `transfer_token`, $0.01, **one month ago**.
- Incentive leaderboard: current epoch average earnings **$0**, no ranked agents.
- Newest agents (1 day old): names like `scprobe9`, `wprobe1`, `vsec-w-test3`, all with 0 jobs — probes and tests.

Revenue concentrated in trading and token intelligence and coincided with incentive programs. No category resembling
an independent auditor appears in the revenue leaders.

### 4. ACP's built-in evaluator role (the closest native fit to "auditor")

ERC-8183 / Virtuals ACP has an evaluator that approves or rejects a job before escrowed funds release. That is
exactly an auditor in an authorized workflow paid from the transaction.

- The standard leaves fees optional. A per-evaluation fee and an 80/20 evaluator/treasury split appear in one
  project's testnet deployment, not in the final standard.
- Public evidence of mainnet evaluator volume: one production deployment with **5** end-to-end transactions;
  another evaluator reporting **10** jobs on a testnet. No aggregate mainnet statistics found.
- Forum discussion notes small jobs may not cover an evaluator's gas.

The role is real and well-designed. Paid demand for it is not yet visible.

## Analysis

1. **Agents pay for inputs to their own decisions, not for oversight of other agents.** Repeat demand clusters on
   cheap, composable data: chain state, search, enrichment, news, market data.
2. **Verdicts sell only when they are the decision input.** The top endpoint (AX1 `q-verdict`) is a judgment, but a
   judgment about *what to buy*, not about whether a counterparty behaved. Trust-about-counterparties
   (token-risk, safety, preflight) is heavily supplied and thinly bought.
3. **The harm an auditor would prevent is currently small.** Payments are $0.001–$0.01 and failed deliveries
   mostly don't charge. Nobody pays $0.005 to protect $0.01.
4. **The intermediary/escrow version carries risk you shouldn't take on.** Holding or routing other agents' funds
   can raise money-transmission and custody obligations. ACP already provides escrow at the protocol level.
5. **The evaluator niche is a timing bet.** It becomes valuable when job values rise enough that a wrong
   approval costs real money (for example, multi-dollar ACP jobs like video or research). Today those jobs are few
   and ACP activity is flat.

## Shortlist

| Rank | Option | Evidence of paid demand | Fit for you | Verdict |
|---|---|---|---|---|
| 1 | **A small set of "boring" decision-input endpoints** in a niche next to security (e.g. "what is this contract/address" plus a plain-language risk summary, $0.001–$0.005) | Strongest: these are the categories with repeat payers | High: your security-research skills apply; runs on free tiers | **Test** |
| 2 | **ACP evaluator for one higher-value job type** (e.g. verifying that a research or code deliverable matches its spec) | Very weak today; protocol role exists | High conceptually; it is your original idea | **Watch**, revisit if ACP mainnet evaluator volume appears |
| 3 | Standalone auditor/preflight/escrow intermediary | Weak and contested (x402 Doctor at $0.001; 3,351 low-demand trust listings) | Medium | **No-go** |

## Recommended next step (requires your decision)

The previous research never produced behavioral evidence because it never touched the market. The cheapest way to
get it in the agent economy is to list one or two tiny endpoints and watch payers for 30 days.

- Cost: free-tier hosting (e.g. Cloudflare Workers) and a receiving wallet; no deposit needed to *receive*.
- Effort: a few hours to build; no ongoing manual work.
- Success threshold (set now): at least 10 distinct payers who call on more than one day within 30 days,
  excluding your own test wallet.
- Stop rule: fewer than 3 repeat payers after 30 days → park the agent-economy direction entirely.

This is outward-facing (publishing a paid service and creating a wallet), so it is your call. It also turns
"auditor" from a product into a data point: if a security-flavored decision input finds repeat buyers, the
evaluator role (option 2) becomes the natural upgrade.

## Addendum: why the Virtuals marketplace went quiet

ChainWard read the ACP contracts directly ([decode, Sep 30 2026](https://chainward.ai/decodes/virtuals-top-dog)):

| Month | Jobs created | Platform fee |
|---|---:|---:|
| Nov 2025 | 340,856 | $79K (≈$350M of trading capital passed through) |
| Feb 2026 | 819,587 | $315K |
| Mar 2026 | 814,185 | $345K |
| Apr 2026 (incentives end) | 214,091 | $4.9K |
| Sep 2026 | 6,918 | $5.48 |

- Activity came in two bursts: trading capital flowing through trading agents (Nov 2025) and a paid incentive
  program (Feb 11 – Mar 23, 2026) that paid out $1.02M, more than the fees it generated. Virtuals itself flagged
  "artificial service activity, self-directed flows… and other farming behavior."
- When incentives stopped, fees fell 98.6% in a month.
- ACP v2 (the ERC-8183 rebuild, April 2026, four chains): about $2,660 of stablecoin in six months; median Base
  payment $0.01; 64% of Base volume is two wallets paying each other.
- Registry: 44,052 agents; 2,470 ever had a job; 151 earned more than $1,000.

**Root cause:** agents have no money or goals of their own. Every dollar originates with a person or business,
reaching the agent economy through a human-facing app (Virtuals' Butler, trading bots). When subsidies and
speculative trading capital left, nothing replaced them. Supply (sellers, evaluators, auditors) is far ahead of
demand.

**Implication for an intermediary:** the missing piece is not another seller, exchange or auditor. It is a
demand-side gateway: something real people or businesses pay for, which then buys agent services underneath.
That is an ordinary customer-facing product with an agent supply chain behind it. Note that ChainWard itself
monetizes auditor-style checks ("should you pay this address?") by selling to humans, not agents.

## Exploration: demand-side gateway candidates

Criteria: (1) people already lose or spend money on the outcome, (2) a non-expert can't do it themselves,
(3) the answer is assembled from several cheap data sources (where pay-per-call agent services help),
(4) fits existing security and payment-authorization experience, (5) no custody of anyone's funds.

A pattern runs through this whole project: **a check before money moves.** It is the one idea that keeps surviving.

| Candidate | Harm / spend evidence | Competition | Supply-chain fit | Verdict |
|---|---|---|---|---|
| **"Before you pay" check for small businesses**: forward an invoice or "our bank details changed" email, get a plain-language risk read and the exact next step | BEC losses ≈ $3.0B in 2025 per secondary reports of the FBI IC3 report (verify against the primary report); payment redirection is a leading pattern | Enterprise tools (Trustmi, PaymentWorks, EFTsure); several free single-purpose checkers (invoice comparison, IBAN checks) | Good: lookalike-domain and domain-age checks, email authentication results from headers, company enrichment, comparison against earlier invoices | **Test** |
| Consumer "is this a scam?" check | Large consumer losses | Free tools from Bitdefender (Scamio), Norton (Genie), McAfee, Trend Micro | Good | No-go (free incumbents) |
| Crypto "should I pay this address / buy this token" | Paid demand exists (AX1 verdict endpoint; ChainWard briefs) | Crowded; many free rug checkers | Strong (chain reads are x402's best-selling category) | Possible, but speculative and cyclical |

### Why the small-business check is the best fit

- The buyer understands the outcome without jargon: "Is it safe to pay this?"
- It matches the user's own research thread: payment authorization, binding an action to the intended payee.
- The agent supply chain stays invisible behind a human product, which is the missing demand-side piece.

### Hard limits (design around them, don't hide them)

- **Never say "safe."** We cannot see bank account ownership without bank-level data (account-ownership services are
  priced for enterprises or need business agreements). The product can only flag risk signals and tell the customer
  to confirm by phone on a number already on file. A false "safe" verdict is the main liability.
- Invoices contain bank details and business data: minimize retention, no sharing, clear privacy terms.
- Free checkers exist; the differentiator must be a complete answer in plain language, not one technical check.

### Proposed test (outward-facing; requires the user's go-ahead)

- A one-page offer: "Forward a suspicious invoice or bank-change email. Get a plain-English risk check within the
  hour." Test price e.g. $9 per check or $19/month.
- Fulfilled manually with agent assistance for 3 weeks, before building any automation.
- Channel to test: **bookkeepers and fractional finance people**, who each serve many small businesses and already
  worry about payment redirection. One bookkeeper is a gateway to dozens of buyers.
- Success: at least 5 paid checks from people we don't know, or one bookkeeper paying for a monthly plan.
- Stop: no paid checks after 3 weeks of honest distribution effort → stop the gateway direction.

## Sources

- [Tanod: What AI agents actually pay for over x402 (30-day data)](https://dev.to/tanod/what-ai-agents-actually-pay-for-over-x402-30-day-data-from-the-bazaar-d6d)
- [Low Key Builds: I crawled all 31,620 x402 Bazaar listings](https://dev.to/lowkeybuilds/i-crawled-all-31620-x402-bazaar-listings-most-have-one-payer-and-boring-chain-reads-win-5c73)
- [x402 Doctor: We check 50,000 paid x402 endpoints every day](https://dev.to/fizzl13/we-check-50000-paid-x402-endpoints-every-day-heres-what-works-and-what-breaks-554j)
- [x402 Doctor trust record for its preflight endpoint](https://x402-doctor.fizzl.eu/api/trust?url=https://x402-doctor.fizzl.eu/api/v1/preflight)
- [AX1 Console listing](https://x402-list.com/services/ax1-console)
- [agdp.io (Virtuals ACP marketplace)](https://agdp.io/) and [leaderboard](https://agdp.io/leaderboard)
- [Forkast: Virtuals ACP and the evaluator problem](https://forkast.news/the-machine-as-buyer-virtuals-acp-and-the-evaluator-problem/) (AI-written outlet; used for architecture only)
- [ERC-8183: Agentic Commerce (EIP)](https://eips.ethereum.org/EIPS/eip-8183) and [Ethereum Magicians discussion](https://ethereum-magicians.org/t/erc-8183-agentic-commerce/27902)
