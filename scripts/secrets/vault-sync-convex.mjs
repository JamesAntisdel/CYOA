#!/usr/bin/env node
import { spawnSync } from "node:child_process";

import {
  CONVEX_SECRET_KEYS,
  REQUIRED_CONVEX_KEYS,
  parseArgs,
  readVaultSecret,
  requireKeys,
  resolveVaultConfig,
  selectedKeys,
} from "./vault-lib.mjs";

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`Usage: pnpm secrets:vault:sync-convex -- --deployment prod --path cyoa/prod

Reads HashiCorp Vault KV v2 and syncs present Convex runtime keys with:
  pnpm --filter @cyoa/convex exec convex env set NAME

Required env:
  VAULT_ADDR
  VAULT_TOKEN

Optional:
  VAULT_NAMESPACE
  VAULT_KV_MOUNT=secret
  VAULT_SECRET_PATH=cyoa/dev

Flags:
  --deployment <ref>  Convex deployment ref: dev, prod, local, staging, or a deployment name
  --prod              Shortcut for --deployment prod
  --path <path>       KV path without the mount, default cyoa/dev
  --mount <mount>     KV mount, default secret
  --dry-run           Validate and print key names only
`);
  process.exit(0);
}

const config = resolveVaultConfig(args);
const secret = await readVaultSecret(config);
requireKeys(secret, REQUIRED_CONVEX_KEYS);

const keys = selectedKeys(secret, CONVEX_SECRET_KEYS);
if (keys.length === 0) throw new Error("No Convex keys found in Vault secret");

const deploymentArgs = [];
if (args.prod) {
  deploymentArgs.push("--prod");
} else if (args.deployment) {
  deploymentArgs.push("--deployment", args.deployment);
}

if (args["dry-run"]) {
  console.log(`Would sync ${keys.length} Convex env keys from ${config.mount}/${config.path}:`);
  for (const key of keys) console.log(`- ${key}`);
  process.exit(0);
}

for (const key of keys) {
  const result = spawnSync(
    "pnpm",
    ["--filter", "@cyoa/convex", "exec", "convex", "env", ...deploymentArgs, "set", key],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      input: `${secret[key]}\n`,
      stdio: ["pipe", "inherit", "inherit"],
    },
  );
  if (result.status !== 0) {
    throw new Error(`Failed to sync ${key}`);
  }
  console.log(`Synced ${key}`);
}

console.log(`Synced ${keys.length} Convex env keys from Vault.`);
