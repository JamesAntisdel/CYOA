#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

const SENSITIVE_KEYS = new Set([
  "ANTHROPIC_API_KEY",
  "APP_STORE_CONNECT_PRIVATE_KEY",
  "APP_STORE_CONNECT_BEARER_TOKEN",
  "BETTER_AUTH_SECRET",
  "CONVEX_DEPLOY_KEY",
  "DEEPSEEK_API_KEY",
  "EAS_TOKEN",
  "GEMINI_API_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_PLAY_ACCESS_TOKEN",
  "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "VERTEX_SERVICE_ACCOUNT_JSON",
]);

const files = [".env", ".env.local", ".env.production", ".env.staging"];
const violations = [];

for (const file of files) {
  if (!existsSync(file)) continue;
  const lines = readFileSync(file, "utf8").split(/\r?\n/u);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/gu, "");
    if (SENSITIVE_KEYS.has(key) && value.length > 0 && !isPlaceholder(value)) {
      violations.push(`${file}:${key}`);
    }
  }
}

if (violations.length > 0) {
  console.error("Sensitive credentials must live in Vault, not local env files:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("No sensitive credentials found in local env files.");

function isPlaceholder(value) {
  return value === "replace-with-a-local-random-string" || value.startsWith("replace-") || value.startsWith("<");
}
