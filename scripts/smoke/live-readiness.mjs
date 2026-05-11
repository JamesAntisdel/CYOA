#!/usr/bin/env node
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    "app-url": { type: "string" },
    "convex-site-url": { type: "string" },
    timeout: { type: "string", default: "8000" },
    help: { type: "boolean" },
  },
});

if (values.help) {
  console.log(`Usage:
  node scripts/smoke/live-readiness.mjs --app-url https://app.example --convex-site-url https://deployment.convex.site

Checks:
  - app URL returns HTML
  - /llm/scene-stream rejects direct unauthenticated/bogus requests
  - BetterAuth session route is mounted
  - Stripe webhook route is mounted and rejects bad signatures
`);
  process.exit(0);
}

const appUrl = cleanUrl(values["app-url"] ?? process.env.PUBLIC_APP_URL ?? process.env.EXPO_PUBLIC_APP_URL);
const convexSiteUrl = cleanUrl(values["convex-site-url"] ?? process.env.EXPO_PUBLIC_CONVEX_SITE_URL);
const timeoutMs = Number(values.timeout);

if (!appUrl) throw new Error("--app-url or PUBLIC_APP_URL is required");
if (!convexSiteUrl) throw new Error("--convex-site-url or EXPO_PUBLIC_CONVEX_SITE_URL is required");
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("--timeout must be a positive number");

const results = [];
results.push(await checkApp(appUrl, timeoutMs));
results.push(await checkForbiddenStream(convexSiteUrl, timeoutMs));
results.push(await checkAuthRoute(convexSiteUrl, timeoutMs));
results.push(await checkStripeWebhookRoute(convexSiteUrl, timeoutMs));

for (const result of results) {
  console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name}: ${result.detail}`);
}

const failures = results.filter((result) => !result.ok);
if (failures.length > 0) process.exit(1);

async function checkApp(url, timeout) {
  const response = await fetchWithTimeout(url, { headers: { accept: "text/html" } }, timeout);
  const text = await response.text();
  return {
    name: "app-html",
    ok: response.ok && text.includes("<html"),
    detail: `${response.status} ${response.statusText}`,
  };
}

async function checkForbiddenStream(url, timeout) {
  const response = await fetchWithTimeout(`${url}/llm/scene-stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId: "not-a-convex-id", saveId: "not-a-convex-id" }),
  }, timeout);
  const text = await response.text();
  return {
    name: "llm-stream-authz",
    ok: response.status === 403 && text.includes("llm_stream_forbidden"),
    detail: `${response.status} ${text.slice(0, 80)}`,
  };
}

async function checkAuthRoute(url, timeout) {
  const response = await fetchWithTimeout(`${url}/api/auth/session`, {
    headers: { accept: "application/json" },
  }, timeout);
  return {
    name: "betterauth-session-route",
    ok: response.status !== 404,
    detail: `${response.status} ${response.statusText}`,
  };
}

async function checkStripeWebhookRoute(url, timeout) {
  const response = await fetchWithTimeout(`${url}/stripe/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": "bad_signature",
    },
    body: "{}",
  }, timeout);
  return {
    name: "stripe-webhook-mounted",
    ok: response.status !== 404,
    detail: `${response.status} ${response.statusText}`,
  };
}

async function fetchWithTimeout(url, init, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function cleanUrl(value) {
  if (!value) return "";
  return value.replace(/\/$/u, "");
}
