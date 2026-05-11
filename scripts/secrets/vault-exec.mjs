#!/usr/bin/env node
import { spawnSync } from "node:child_process";

import {
  ALL_VAULT_KEYS,
  parseArgs,
  readVaultSecret,
  requireKeys,
  resolveVaultConfig,
  selectedKeys,
} from "./vault-lib.mjs";

const rawArgs = process.argv.slice(2);
if (rawArgs[0] === "--") rawArgs.shift();
const commandIndex = rawArgs.indexOf("--");
const optionArgs = commandIndex === -1 ? rawArgs : rawArgs.slice(0, commandIndex);
const command = commandIndex === -1 ? [] : rawArgs.slice(commandIndex + 1);
const args = parseArgs(optionArgs);

if (args.help || command.length === 0) {
  console.log(`Usage: pnpm secrets:vault:exec -- --require EAS_TOKEN -- npx eas-cli build --profile production

Reads HashiCorp Vault KV v2 and runs a command with selected Vault values in
the child process environment. Values are not printed or written to disk.

Required env:
  VAULT_ADDR
  VAULT_TOKEN

Flags:
  --path <path>       KV path without the mount, default cyoa/dev
  --mount <mount>     KV mount, default secret
  --require <keys>    Comma-separated keys that must exist
  --only <keys>       Comma-separated keys to expose; default exposes known keys present in Vault
`);
  process.exit(args.help ? 0 : 1);
}

const config = resolveVaultConfig(args);
const secret = await readVaultSecret(config);
const required = splitKeys(args.require);
if (required.length > 0) requireKeys(secret, required);

const keys = splitKeys(args.only);
const exposedKeys = keys.length > 0 ? keys : selectedKeys(secret, ALL_VAULT_KEYS);
const childEnv = { ...process.env };
for (const key of exposedKeys) {
  if (typeof secret[key] === "string" && secret[key].trim().length > 0) {
    childEnv[key] = secret[key];
  }
}

const result = spawnSync(command[0], command.slice(1), {
  cwd: process.cwd(),
  env: childEnv,
  stdio: "inherit",
});

process.exit(result.status ?? 1);

function splitKeys(value) {
  if (typeof value !== "string") return [];
  return value.split(",").map((key) => key.trim()).filter(Boolean);
}
