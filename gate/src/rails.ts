// Payment rails. The gate's rules don't depend on which rail is used, so x402 on a
// test network today can be swapped for a card-based rail (such as Stripe MPP) later.

import { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import type { Seller } from "./config.ts";
import { demoLookup } from "./demo-data.ts";

export type BuyRequest = { seller: Seller; url: string; capMicros: number };

export type BuyResult =
  | { ok: true; data: unknown; paidMicros: number; network?: string; transaction?: string }
  | { ok: false; refused: boolean; noResult?: boolean; reason: string };

const NO_RESULT = "seller had no data for this request, so nothing was charged";

export interface Rail {
  buy(req: BuyRequest): Promise<BuyResult>;
}

type Settlement = { transaction?: string; network?: string; success?: boolean };

// Spend controls restrict payments to recognized USD stablecoins (USDC, 6 decimals),
// so a quoted atomic amount is already micro-USD.
export class X402Rail implements Rail {
  private account;
  private timeoutMs: number;

  constructor(privateKey: string, timeoutMs = 30_000) {
    this.account = privateKeyToAccount(privateKey as `0x${string}`);
    this.timeoutMs = timeoutMs;
  }

  get address(): string {
    return this.account.address;
  }

  async buy({ seller, url, capMicros }: BuyRequest): Promise<BuyResult> {
    let refusal: string | null = null;
    let quotedMicros = 0;
    let settled: Settlement | null = null;

    const client = new x402Client()
      .register(seller.network as `${string}:${string}`, new ExactEvmScheme(this.account))
      .setSpendControls({ maxAmountPerPayment: `$${(capMicros / 1_000_000).toFixed(6)}` });

    // Last check before anything is signed: the seller's actual quote must match policy.
    client.onBeforePaymentCreation(async ({ selectedRequirements: req }) => {
      if (req.network !== seller.network) refusal = `seller asked for network ${req.network}, policy allows ${seller.network}`;
      else if (seller.payTo && req.payTo.toLowerCase() !== seller.payTo.toLowerCase())
        refusal = "seller asked to be paid at an address that isn't the approved one";
      else if (BigInt(req.amount) > BigInt(capMicros))
        refusal = `price ${formatUsd(Number(req.amount))} is above the ${formatUsd(capMicros)} limit`;
      if (refusal) return { abort: true, reason: refusal };
      quotedMicros = Number(req.amount);
    });

    client.onPaymentResponse(async (ctx) => {
      if (ctx.settleResponse) settled = ctx.settleResponse as Settlement;
    });

    const fetchWithPayment = wrapFetchWithPayment(fetch, client);
    let response: Response;
    try {
      response = await fetchWithPayment(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (err) {
      if (refusal) return { ok: false, refused: true, reason: refusal };
      const message = (err as Error).message;
      // The library's own spend controls run before our hook and reject over-limit quotes.
      if (message.includes("spendControls")) {
        return { ok: false, refused: true, reason: `seller's price is above the ${formatUsd(capMicros)} limit` };
      }
      return { ok: false, refused: false, reason: `payment or request failed: ${message.slice(0, 200)}` };
    }

    if (refusal) return { ok: false, refused: true, reason: refusal };
    if (response.status === 402) {
      return { ok: false, refused: false, reason: "seller didn't accept the payment (check the buyer wallet has test USDC)" };
    }
    // x402 sellers only collect payment when they answer successfully, so a 404 costs nothing.
    if (response.status === 404) return { ok: false, refused: false, noResult: true, reason: NO_RESULT };
    if (!response.ok) {
      return { ok: false, refused: false, reason: `seller answered ${response.status}` };
    }

    const header = response.headers.get("PAYMENT-RESPONSE");
    if (!settled && header) {
      try {
        settled = decodePaymentResponseHeader(header) as Settlement;
      } catch {
        // Missing or unreadable receipt header: keep going without a transaction id.
      }
    }
    const s = settled as Settlement | null;
    return {
      ok: true,
      data: await response.json(),
      paidMicros: s?.success === false ? 0 : quotedMicros,
      network: s?.network ?? seller.network,
      transaction: s?.transaction,
    };
  }
}

// Stands in for a real rail in tests and while wiring up Salesforce without a wallet.
export class MockRail implements Rail {
  calls: BuyRequest[] = [];
  private priceMicros: number;
  private behavior: "ok" | "fail" | "slow";
  private sellerPrices: Record<string, number>;

  // sellerPrices overrides the default price for a seller id, so mock mode can mirror real seller prices.
  constructor(priceMicros = 5_000, behavior: "ok" | "fail" | "slow" = "ok", sellerPrices: Record<string, number> = {}) {
    this.priceMicros = priceMicros;
    this.behavior = behavior;
    this.sellerPrices = sellerPrices;
  }

  async buy(req: BuyRequest): Promise<BuyResult> {
    this.calls.push(req);
    if (this.behavior === "slow") await new Promise((r) => setTimeout(r, 25));
    const price = this.sellerPrices[req.seller.id] ?? this.priceMicros;
    if (price > req.capMicros) {
      return { ok: false, refused: true, reason: `seller's price ${formatUsd(price)} is above the ${formatUsd(req.capMicros)} limit` };
    }
    if (this.behavior === "fail") return { ok: false, refused: false, reason: "seller answered 500" };
    const url = new URL(req.url);
    const record = demoLookup(url.searchParams.get("domain") ?? "", url.pathname.endsWith("-premium"));
    if (!record) return { ok: false, refused: false, noResult: true, reason: NO_RESULT };
    return {
      ok: true,
      data: { ...record, source: "mock rail" },
      paidMicros: price,
      network: req.seller.network,
      transaction: "0xmock",
    };
  }
}

export function formatUsd(micros: number): string {
  return (micros / 1_000_000).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}
