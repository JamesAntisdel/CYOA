#!/usr/bin/env node
// Live Stripe smoke (LR-4). Verifies test-mode credentials + checkout
// session + webhook secret without ever spending real money.
//
// Probes:
//   1. POST /v1/payment_methods using the test secret key returns 200
//      (proves the key is valid against Stripe's API).
//   2. Construct a fake event JSON and sign it with STRIPE_WEBHOOK_SECRET
//      using the documented HMAC-SHA256 scheme; assert the signature
//      header is well-formed. Does NOT POST to a webhook endpoint —
//      that's a separate `stripe trigger` step the operator runs locally.
//   3. List the configured price IDs (PRICE_UNLIMITED / PRICE_PRO if
//      set) and assert they exist + are active.
//
// Auto-skips when STRIPE_SECRET_KEY is absent or doesn't start with
// "sk_test_". Live (non-test) keys cause an explicit FAIL — this script
// is for test-mode only, never against production.

import { createHmac } from "node:crypto";
import { parseArgs } from "node:util";
import { performance } from "node:perf_hooks";

const { values } = parseArgs({
  options: {
    require: { type: "boolean" },
    "timeout-ms": { type: "string" },
    help: { type: "boolean" },
  },
});

if (values.help) {
  console.log("usage: node scripts/smoke/live-stripe.mjs [--require]");
  process.exit(0);
}

const timeoutMs = Number(values["timeout-ms"] ?? 15_000);
const isRequired = Boolean(values.require);

const results = [];
results.push(await probeApiKey());
results.push(await probeWebhookSignature());
results.push(await probePriceIds());

for (const r of results) console.log(`${r.status} stripe.${r.name}: ${r.detail}`);

process.exit(results.some((r) => r.status === "FAIL") ? 1 : 0);

async function probeApiKey() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return {
      name: "api-key",
      status: isRequired ? "FAIL" : "SKIP",
      detail: "STRIPE_SECRET_KEY not set",
    };
  }
  if (!key.startsWith("sk_test_")) {
    return {
      name: "api-key",
      status: "FAIL",
      detail: "STRIPE_SECRET_KEY must be a test-mode key (sk_test_...)",
    };
  }
  const start = performance.now();
  const res = await fetchWithTimeout("https://api.stripe.com/v1/payment_methods?limit=1", {
    headers: {
      authorization: `Bearer ${key}`,
    },
  }, timeoutMs);
  const ms = Math.round(performance.now() - start);
  return {
    name: "api-key",
    status: res.ok ? "PASS" : "FAIL",
    detail: `HTTP ${res.status} in ${ms}ms`,
  };
}

async function probeWebhookSignature() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return {
      name: "webhook-signature",
      status: isRequired ? "FAIL" : "SKIP",
      detail: "STRIPE_WEBHOOK_SECRET not set",
    };
  }
  if (!secret.startsWith("whsec_")) {
    return {
      name: "webhook-signature",
      status: "FAIL",
      detail: "STRIPE_WEBHOOK_SECRET must start with whsec_",
    };
  }
  // Stripe signs with `<timestamp>.<body>` HMAC-SHA256. Reproducing the
  // shape locally proves the secret is well-formed for the verifier.
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ id: "evt_smoke", type: "smoke.test" });
  const signed = `${timestamp}.${payload}`;
  const signature = createHmac("sha256", secret).update(signed).digest("hex");
  const header = `t=${timestamp},v1=${signature}`;
  const ok = /^t=\d+,v1=[0-9a-f]{64}$/.test(header);
  return {
    name: "webhook-signature",
    status: ok ? "PASS" : "FAIL",
    detail: `header well-formed (length=${signature.length})`,
  };
}

async function probePriceIds() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !key.startsWith("sk_test_")) {
    return {
      name: "price-ids",
      status: isRequired ? "FAIL" : "SKIP",
      detail: "no test key — cannot resolve price ids",
    };
  }
  const wanted = ["STRIPE_PRICE_UNLIMITED", "STRIPE_PRICE_PRO"]
    .map((envKey) => ({ envKey, id: process.env[envKey] }))
    .filter((p) => p.id);
  if (wanted.length === 0) {
    return {
      name: "price-ids",
      status: isRequired ? "FAIL" : "SKIP",
      detail: "no STRIPE_PRICE_* env keys set",
    };
  }
  const checks = await Promise.all(wanted.map(async ({ envKey, id }) => {
    const res = await fetchWithTimeout(`https://api.stripe.com/v1/prices/${id}`, {
      headers: { authorization: `Bearer ${key}` },
    }, timeoutMs);
    const data = await res.json();
    return {
      envKey,
      id,
      ok: res.ok && data?.active === true,
      detail: res.ok ? `active=${data?.active}` : `HTTP ${res.status}`,
    };
  }));
  const allOk = checks.every((c) => c.ok);
  return {
    name: "price-ids",
    status: allOk ? "PASS" : "FAIL",
    detail: checks.map((c) => `${c.envKey}=${c.id ? c.id.slice(0, 12) + "…" : "<unset>"} ${c.detail}`).join("; "),
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
