// Creates a test-network buyer wallet and a seller address, and writes
// them to .env. These are for Base Sepolia test funds only; never put real money in them.

import { existsSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

if (existsSync(".env")) {
  console.log(".env already exists. Delete it first if you want new keys.");
  process.exit(1);
}

const buyerKey = generatePrivateKey();
const sellerKey = generatePrivateKey();
const buyer = privateKeyToAccount(buyerKey);
const seller = privateKeyToAccount(sellerKey);

writeFileSync(
  ".env",
  [
    "# TEST NETWORK ONLY (Base Sepolia). Never send real funds to these addresses.",
    "RAIL=mock",
    `BUYER_PRIVATE_KEY=${buyerKey}`,
    `BUYER_ADDRESS=${buyer.address}`,
    `SELLER_PRIVATE_KEY=${sellerKey}`,
    `SELLER_PAY_TO=${seller.address}`,
    "",
  ].join("\n"),
  { mode: 0o600 },
);

console.log("Wrote .env (readable only by you).");
console.log(`Buyer test wallet:  ${buyer.address}  <- fund this with Base Sepolia test USDC`);
console.log(`Seller test wallet: ${seller.address}`);
console.log("Set payTo for the demo sellers in config/catalog.json to the seller address above.");
