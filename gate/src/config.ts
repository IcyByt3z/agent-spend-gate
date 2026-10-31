// The seller catalog and each org's spending policy. The catalog lists the vetted sellers
// the gate knows how to buy from; an org's policy turns some of them on and sets its limits.
// Amounts are stored in micro-USD (1 USD = 1,000,000) so limit arithmetic is integer arithmetic.

import { readFileSync } from "node:fs";

export type Seller = {
  id: string;
  name: string;
  // The gate only ever calls this URL. Callers choose a seller by id, never by URL.
  url: string;
  // Query parameters the caller may pass through, with the pattern each value must match.
  allowedParams: Record<string, string>;
  network: string;
  // Expected recipient address. When set, a payment request naming any other recipient is refused.
  payTo?: string;
  // Checks a paid result must pass before it reaches the caller. A result that fails is
  // withheld and recorded as a refund the seller owes.
  resultCheck?: {
    // The response field with this name must equal the request parameter of the same name.
    matchParam?: string;
    // Response fields that must be non-empty.
    requiredFields?: string[];
  };
};

export type Catalog = { sellers: Seller[] };

export type OrgPolicy = {
  maxPerCallUsd: number;
  // Resets at the start of each calendar month (UTC).
  monthlyBudgetUsd: number;
  // Sellers this org may buy from, each with an optional tighter per-purchase limit.
  sellers: Record<string, { maxPerCallUsd?: number }>;
};

export const MICROS = 1_000_000;

export function toMicros(usd: number): number {
  return Math.round(usd * MICROS);
}

export function fromMicros(micros: number): number {
  return micros / MICROS;
}

export function loadCatalog(path: string): Catalog {
  return validateCatalog(JSON.parse(readFileSync(path, "utf8")));
}

export function validateCatalog(raw: unknown): Catalog {
  const c = raw as Catalog;
  if (!c || !Array.isArray(c.sellers) || c.sellers.length === 0) throw new Error("catalog.sellers must be a non-empty list");
  const ids = new Set<string>();
  for (const s of c.sellers) {
    if (!s.id || ids.has(s.id)) throw new Error(`seller id missing or duplicated: ${s.id}`);
    ids.add(s.id);
    const url = new URL(s.url);
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      throw new Error(`seller ${s.id} must use https`);
    }
    for (const pattern of Object.values(s.allowedParams ?? {})) new RegExp(pattern);
    const check = s.resultCheck;
    if (check !== undefined) {
      if (check.matchParam !== undefined && !(check.matchParam in (s.allowedParams ?? {}))) {
        throw new Error(`seller ${s.id} resultCheck.matchParam must be one of its allowedParams`);
      }
      if (check.requiredFields !== undefined && !(Array.isArray(check.requiredFields) && check.requiredFields.every((f) => typeof f === "string"))) {
        throw new Error(`seller ${s.id} resultCheck.requiredFields must be a list of field names`);
      }
    }
  }
  return c;
}

export function validateOrgPolicy(raw: unknown, catalog: Catalog): OrgPolicy {
  const p = raw as OrgPolicy;
  if (!p || typeof p !== "object") throw new Error("policy must be an object");
  for (const key of ["maxPerCallUsd", "monthlyBudgetUsd"] as const) {
    if (typeof p[key] !== "number" || !(p[key] > 0)) throw new Error(`policy.${key} must be a positive number`);
  }
  if (!p.sellers || typeof p.sellers !== "object" || Array.isArray(p.sellers)) {
    throw new Error("policy.sellers must map seller ids to settings");
  }
  for (const [id, settings] of Object.entries(p.sellers)) {
    if (!catalog.sellers.some((s) => s.id === id)) throw new Error(`policy names seller ${id}, which isn't in the catalog`);
    const max = settings?.maxPerCallUsd;
    if (max !== undefined && !(typeof max === "number" && max > 0)) throw new Error(`seller ${id} maxPerCallUsd must be a positive number`);
  }
  return p;
}
