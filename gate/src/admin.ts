// Manages customer orgs: create one, change its policy, rotate its key, list them.
//
//   npm run admin -- create-org --name "Acme Corp" [--policy file.json] [--key-env VAR]
//   npm run admin -- set-policy --org <id> --policy file.json
//   npm run admin -- rotate-key --org <id>
//   npm run admin -- list-orgs
//
// A new key is printed once and never stored; only its hash is kept. --key-env reuses a key
// from an environment variable (for example an existing Salesforce credential) instead of
// generating one, so keys never have to be typed on the command line.

import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { loadCatalog, validateOrgPolicy } from "./config.ts";
import { Store } from "./store.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: "string" },
    org: { type: "string" },
    policy: { type: "string" },
    "key-env": { type: "string" },
  },
});

const catalog = loadCatalog(process.env.CATALOG_FILE ?? "config/catalog.json");
const store = new Store(process.env.DATABASE_PATH ?? "data/gate.db");
const policyFrom = (path: string) => validateOrgPolicy(JSON.parse(readFileSync(path, "utf8")), catalog);
const required = (value: string | undefined, flag: string) => {
  if (!value) throw new Error(`--${flag} is required`);
  return value;
};
const keyFromEnv = () => {
  const name = values["key-env"];
  if (!name) return undefined;
  const key = process.env[name];
  if (!key) throw new Error(`environment variable ${name} is empty`);
  return key;
};

switch (positionals[0]) {
  case "create-org": {
    const policy = policyFrom(values.policy ?? "config/org-policy.example.json");
    const given = keyFromEnv();
    const { org, apiKey } = store.createOrg(required(values.name, "name"), policy, given);
    console.log(`Created org ${org.name} (${org.id}).`);
    if (!given) console.log(`API key (shown once, store it in the customer's Named Credential):\n${apiKey}`);
    break;
  }
  case "set-policy": {
    store.setPolicy(required(values.org, "org"), policyFrom(required(values.policy, "policy")));
    console.log("Policy updated.");
    break;
  }
  case "rotate-key": {
    const apiKey = store.rotateKey(required(values.org, "org"), keyFromEnv());
    console.log(values["key-env"] ? "Key replaced." : `New API key (shown once; the old key stops working now):\n${apiKey}`);
    break;
  }
  case "list-orgs": {
    for (const org of store.listOrgs()) {
      const spent = store.spentThisMonthMicros(org.id) / 1_000_000;
      console.log(`${org.id}  ${org.name}  spent this month $${spent}  of $${org.policy.monthlyBudgetUsd}`);
    }
    break;
  }
  default:
    console.log("Commands: create-org, set-policy, rotate-key, list-orgs (see the top of src/admin.ts)");
    process.exitCode = 1;
}
store.close();
