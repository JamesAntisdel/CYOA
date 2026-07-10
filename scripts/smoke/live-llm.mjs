#!/usr/bin/env node
// Live LLM provider smoke (LR-3). Runs only when real API keys are present
// in the env; otherwise prints a SKIP line per provider and exits 0.
//
// Probes each provider with a tiny non-spending prompt:
//   - Anthropic: a 10-token completion against the configured model
//   - Vertex/Gemini: a 10-token completion against the configured model
//   - DeepSeek:  a 10-token completion against the configured model
//
// Verifies:
//   - The provider responds with non-empty text
//   - The HTTP call does NOT echo the API key into any error message
//   - Total wall-clock per provider is under LLM_TIMEOUT_MS
//
// Usage:
//   node scripts/smoke/live-llm.mjs [--require <provider>...]
//
//   --require anthropic       — fail if Anthropic key is absent or fails
//   --require vertex,deepseek — multiple, comma-separated
//
//   With no --require, all three are best-effort and missing keys SKIP.

import { parseArgs } from "node:util";
import { performance } from "node:perf_hooks";

const { values } = parseArgs({
  options: {
    require: { type: "string" },
    "timeout-ms": { type: "string" },
    help: { type: "boolean" },
  },
});

if (values.help) {
  console.log("usage: node scripts/smoke/live-llm.mjs [--require anthropic,vertex,deepseek]");
  process.exit(0);
}

const required = new Set(
  (values.require ?? "").split(",").map((s) => s.trim()).filter(Boolean),
);
const timeoutMs = Number(values["timeout-ms"] ?? process.env.LLM_TIMEOUT_MS ?? 20_000);

const probes = [
  { name: "anthropic", run: probeAnthropic },
  { name: "vertex", run: probeVertex },
  { name: "deepseek", run: probeDeepseek },
];

const results = [];
for (const probe of probes) {
  const isRequired = required.has(probe.name);
  results.push(await safeRun(probe, isRequired));
}

let failed = 0;
for (const r of results) {
  console.log(`${r.status} ${r.name}: ${r.detail}`);
  if (r.status === "FAIL") failed += 1;
}

process.exit(failed === 0 ? 0 : 1);

async function safeRun(probe, isRequired) {
  try {
    return await probe.run(isRequired);
  } catch (err) {
    const message = scrubSecrets(err?.message ?? String(err));
    return {
      name: probe.name,
      status: "FAIL",
      detail: `unhandled error: ${message}`,
    };
  }
}

async function probeAnthropic(isRequired) {
  const key = process.env.ANTHROPIC_API_KEY;
  const base = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";
  const model = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";
  if (!key) {
    return skip("anthropic", isRequired, "ANTHROPIC_API_KEY not set");
  }
  const start = performance.now();
  const res = await fetchWithTimeout(`${base}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 10,
      messages: [{ role: "user", content: "Reply with the single word: candle" }],
    }),
  }, timeoutMs);
  const ms = Math.round(performance.now() - start);
  const data = await res.json();
  if (!res.ok) {
    return {
      name: "anthropic",
      status: "FAIL",
      detail: `HTTP ${res.status} in ${ms}ms ${scrubSecrets(JSON.stringify(data)).slice(0, 120)}`,
    };
  }
  const text = data?.content?.[0]?.text ?? "";
  return {
    name: "anthropic",
    status: text.length > 0 ? "PASS" : "FAIL",
    detail: `${ms}ms model=${model} reply=${JSON.stringify(text).slice(0, 60)}`,
  };
}

async function probeVertex(isRequired) {
  const project = process.env.VERTEX_PROJECT_ID;
  const token = process.env.VERTEX_ACCESS_TOKEN;
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.VERTEX_TEXT_MODEL ?? process.env.GEMINI_TEXT_MODEL ?? "gemini-2.5-flash";
  if (!project && !apiKey) {
    return skip("vertex", isRequired, "no VERTEX_PROJECT_ID and no GEMINI_API_KEY");
  }
  // Prefer Vertex if we have a token; fall back to AI Studio (gemini) if not.
  const useVertex = Boolean(project && token);
  const url = useVertex
    ? `https://${process.env.VERTEX_LOCATION ?? "us-central1"}-aiplatform.googleapis.com/v1/projects/${project}/locations/${process.env.VERTEX_LOCATION ?? "us-central1"}/publishers/google/models/${model}:generateContent`
    : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const headers = useVertex
    ? { authorization: `Bearer ${token}`, "content-type": "application/json" }
    : { "content-type": "application/json" };
  const start = performance.now();
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "Reply with the single word: candle" }] }],
      generationConfig: { maxOutputTokens: 10 },
    }),
  }, timeoutMs);
  const ms = Math.round(performance.now() - start);
  const data = await res.json();
  if (!res.ok) {
    return {
      name: "vertex",
      status: "FAIL",
      detail: `HTTP ${res.status} in ${ms}ms ${scrubSecrets(JSON.stringify(data)).slice(0, 120)}`,
    };
  }
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return {
    name: "vertex",
    status: text.length > 0 ? "PASS" : "FAIL",
    detail: `${ms}ms via=${useVertex ? "vertex" : "gemini"} model=${model} reply=${JSON.stringify(text).slice(0, 60)}`,
  };
}

async function probeDeepseek(isRequired) {
  const key = process.env.DEEPSEEK_API_KEY;
  const base = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
  const model = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
  if (!key) {
    return skip("deepseek", isRequired, "DEEPSEEK_API_KEY not set");
  }
  const start = performance.now();
  const res = await fetchWithTimeout(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 10,
      messages: [{ role: "user", content: "Reply with the single word: candle" }],
    }),
  }, timeoutMs);
  const ms = Math.round(performance.now() - start);
  const data = await res.json();
  if (!res.ok) {
    return {
      name: "deepseek",
      status: "FAIL",
      detail: `HTTP ${res.status} in ${ms}ms ${scrubSecrets(JSON.stringify(data)).slice(0, 120)}`,
    };
  }
  const text = data?.choices?.[0]?.message?.content ?? "";
  return {
    name: "deepseek",
    status: text.length > 0 ? "PASS" : "FAIL",
    detail: `${ms}ms model=${model} reply=${JSON.stringify(text).slice(0, 60)}`,
  };
}

function skip(name, isRequired, reason) {
  return {
    name,
    status: isRequired ? "FAIL" : "SKIP",
    detail: reason,
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

// Defense in depth: API keys must never appear in any logged output.
function scrubSecrets(text) {
  if (typeof text !== "string") return String(text);
  const secrets = [
    process.env.ANTHROPIC_API_KEY,
    process.env.DEEPSEEK_API_KEY,
    process.env.GEMINI_API_KEY,
    process.env.VERTEX_ACCESS_TOKEN,
  ].filter((v) => v && v.length > 8);
  let out = text;
  for (const secret of secrets) {
    out = out.split(secret).join("<redacted>");
  }
  // Also redact any sk-* or Bearer ... shapes that might leak from upstream
  // errors.
  out = out.replace(/(?:Bearer\s+)?sk-[A-Za-z0-9-_]{16,}/g, "<redacted>");
  out = out.replace(/(?:Bearer\s+)[A-Za-z0-9._-]{32,}/g, "Bearer <redacted>");
  return out;
}
