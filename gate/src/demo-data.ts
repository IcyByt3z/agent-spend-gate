// Fictional company data shared by the demo seller and the mock rail, so both behave
// the same. Two domain prefixes trigger the cases result checks exist for:
//   unknown-*   the seller has no record (answers 404, so x402 never collects payment)
//   mismatch-*  the seller returns a record for a different company (bad data)

import { createHash } from "node:crypto";

const INDUSTRIES = ["Logistics", "Food & Beverage", "Construction", "Software", "Healthcare", "Retail", "Manufacturing"];
const SIZES = ["1-10", "11-50", "51-200", "201-500"];

export function fictionalCompany(domain: string, premium: boolean) {
  const h = createHash("sha256").update(domain).digest();
  const base = domain.split(".")[0].replace(/[-_]/g, " ");
  return {
    demo: true,
    note: "Fictional data from a test seller. Not real company information.",
    domain,
    companyName: base.replace(/\b\w/g, (ch) => ch.toUpperCase()) + " (demo)",
    industry: INDUSTRIES[h[0] % INDUSTRIES.length],
    employees: SIZES[h[1] % SIZES.length],
    foundedYear: 1980 + (h[2] % 44),
    ...(premium ? { estimatedRevenueBand: ["<$1M", "$1M-$10M", "$10M-$50M"][h[3] % 3] } : {}),
  };
}

// Returns null when the seller has no record for the domain.
export function demoLookup(domain: string, premium: boolean) {
  const d = domain.toLowerCase();
  if (d.startsWith("unknown-")) return null;
  if (d.startsWith("mismatch-")) return { ...fictionalCompany("some-other-company.com", premium), companyName: "" };
  return fictionalCompany(d, premium);
}
