#!/usr/bin/env node
import {
  ALL_VAULT_KEYS,
  REQUIRED_CONVEX_KEYS,
  parseArgs,
  readVaultSecret,
  requireKeys,
  resolveVaultConfig,
  selectedKeys,
} from "./vault-lib.mjs";

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`Usage: pnpm secrets:vault:check -- --path cyoa/dev

Required env:
  VAULT_ADDR
  VAULT_TOKEN

Optional:
  VAULT_NAMESPACE
  VAULT_KV_MOUNT=secret
  VAULT_SECRET_PATH=cyoa/dev

Flags:
  --path <path>       KV path without the mount, default cyoa/dev
  --mount <mount>     KV mount, default secret
  --all               Require mobile store/API credentials too
`);
  process.exit(0);
}

const config = resolveVaultConfig(args);
const secret = await readVaultSecret(config);
const required = args.all ? ALL_VAULT_KEYS : REQUIRED_CONVEX_KEYS;

requireKeys(secret, required);

const available = selectedKeys(secret, ALL_VAULT_KEYS);
console.log(`Vault secret ${config.mount}/${config.path} is ready.`);
console.log(`Validated ${required.length} required keys; ${available.length} known keys are present.`);
