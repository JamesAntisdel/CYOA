#!/usr/bin/env node
// SSE + deterministic-fallback smoke harness.
//
// Reproduces the bug-fix contract for the LLM scene-stream pipeline:
//   - SSE heartbeat: `: keep-alive` comment lines are flushed every ~5s during
//     the LLM call, so mobile Chrome / cloudflared / corporate proxies don't
//     close the idle connection while the provider thinks.
//   - Abort classification: when the CLIENT closes the SSE early, the server
//     does NOT fall to the deterministic provider and write
//     "Press on into the story" placeholder prose as the canonical scene.
//   - Deterministic sentinel: when deterministic IS used legitimately, the
//     scene record carries `isFallback: true` so the client can render a
//     "Try again" panel instead of treating filler as authored content.
//
// Three other agents are landing those server-side fixes in parallel. This
// harness writes the assertions against the CONTRACT — if the test fails
// before those agents finish, the failure points at the missing piece.
//
// Transport notes:
//   - Convex local backend exposes HTTP API on :3210 and the public site
//     (where /llm/scene-stream is mounted) on :3211. The task asks us to
//     target 127.0.0.1:3210, so we honour that for the API base and
//     auto-derive the site URL (3210 → 3211) for SSE. Both can be overridden
//     via --api-url / --site-url for staging or self-host setups.
//
// Usage:
//   node scripts/smoke/llm-stream-smoke.mjs
//   node scripts/smoke/llm-stream-smoke.mjs --api-url http://127.0.0.1:3210
//   node scripts/smoke/llm-stream-smoke.mjs --site-url http://127.0.0.1:3211

import { test } from "node:test";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import crypto from "node:crypto";
import { performance } from "node:perf_hooks";

const { values } = parseArgs({
  options: {
    "api-url": { type: "string" },
    "site-url": { type: "string" },
    "story-id": { type: "string" },
    "stream-timeout-ms": { type: "string" },
    "abort-wait-ms": { type: "string" },
    help: { type: "boolean" },
  },
});

if (values.help) {
  console.log(
    [
      "usage: node scripts/smoke/llm-stream-smoke.mjs [options]",
      "",
      "  --api-url <url>          Convex HTTP API base (default http://127.0.0.1:3210)",
      "  --site-url <url>         Convex site URL hosting /llm/scene-stream",
      "                           (default: derived from --api-url, with 3210→3211)",
      "  --story-id <id>          Story id to seed the save (default bone-cathedral)",
      "  --stream-timeout-ms <n>  Max wall-clock for a single SSE read (default 120000)",
      "  --abort-wait-ms <n>      How long to wait after a client-side abort before",
      "                           polling the scene record (default 30000)",
    ].join("\n"),
  );
  process.exit(0);
}

const API_URL = stripTrailingSlash(values["api-url"] ?? "http://127.0.0.1:3210");
const SITE_URL = stripTrailingSlash(values["site-url"] ?? deriveSiteUrl(API_URL));
const STORY_ID = values["story-id"] ?? "bone-cathedral";
const STREAM_TIMEOUT_MS = Number(values["stream-timeout-ms"] ?? 120_000);
const ABORT_WAIT_MS = Number(values["abort-wait-ms"] ?? 30_000);

if (!Number.isFinite(STREAM_TIMEOUT_MS) || STREAM_TIMEOUT_MS <= 0) {
  throw new Error("--stream-timeout-ms must be a positive number");
}
if (!Number.isFinite(ABORT_WAIT_MS) || ABORT_WAIT_MS <= 0) {
  throw new Error("--abort-wait-ms must be a positive number");
}

// ──────────────────────────────────────────────────────────────────────────
// HTTP helpers — Convex local exposes /api/mutation and /api/query.
// ──────────────────────────────────────────────────────────────────────────

async function convexCall(kind, path, args, { timeoutMs = 15_000 } = {}) {
  const url = `${API_URL}/api/${kind}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, args: args ?? {}, format: "json" }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`convex ${kind} ${path} HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`convex ${kind} ${path} non-JSON response: ${text.slice(0, 200)}`);
  }
  if (body.status === "success") return body.value;
  const message = body.errorMessage ?? JSON.stringify(body).slice(0, 200);
  throw new Error(`convex ${kind} ${path} server error: ${message}`);
}

async function createGuestAccount() {
  // The mutation hashes a guest token; we mint a fresh one per run so saves
  // don't collide with whatever a developer has open in their browser.
  const guestTokenHash = `smoke-${crypto.randomBytes(8).toString("hex")}`;
  const value = await convexCall("mutation", "game:createGuestAccount", {
    ageSelection: "18+",
    guestTokenHash,
  });
  if (!value?.account?.accountId) {
    throw new Error(`createGuestAccount returned no accountId: ${JSON.stringify(value).slice(0, 200)}`);
  }
  return { accountId: value.account.accountId, guestTokenHash };
}

async function createSave({ accountId, guestTokenHash, storyId }) {
  const value = await convexCall("mutation", "game:createSave", {
    accountId,
    guestTokenHash,
    storyId,
    mode: "story",
  });
  if (!value?.saveId) {
    throw new Error(`createSave returned no saveId: ${JSON.stringify(value).slice(0, 200)}`);
  }
  return { saveId: value.saveId, sceneId: value.sceneId, scene: value.scene };
}

async function getCurrentScene({ accountId, saveId, guestTokenHash }) {
  return await convexCall("query", "game:getCurrentScene", {
    accountId,
    saveId,
    guestTokenHash,
  });
}

// ──────────────────────────────────────────────────────────────────────────
// SSE reader — captures every byte with timestamps relative to open.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Open a POST SSE stream and feed every line into a structured timeline.
 *
 * @param {object} args
 * @param {string} args.accountId
 * @param {string} args.saveId
 * @param {string} args.guestTokenHash
 * @param {AbortSignal} [args.signal]
 * @param {(event: object) => boolean} [args.shouldStop] — return true to bail
 * @param {number} [args.timeoutMs]
 * @returns {Promise<{
 *   events: Array<{ tMs: number; kind: string; raw?: string; event?: string; data?: string }>;
 *   bytesReceived: number;
 *   closed: boolean;
 *   error: Error | null;
 *   response: Response;
 * }>}
 */
async function openSceneStream({
  accountId,
  saveId,
  guestTokenHash,
  signal,
  shouldStop,
  timeoutMs = STREAM_TIMEOUT_MS,
}) {
  const t0 = performance.now();
  const events = [];
  let bytesReceived = 0;
  let closed = false;
  let error = null;

  const localCtl = new AbortController();
  const linkAbort = () => {
    localCtl.abort();
  };
  if (signal) {
    if (signal.aborted) localCtl.abort();
    else signal.addEventListener("abort", linkAbort, { once: true });
  }
  const timer = setTimeout(() => {
    events.push({ tMs: Math.round(performance.now() - t0), kind: "timeout" });
    localCtl.abort();
  }, timeoutMs);

  let response;
  try {
    response = await fetch(`${SITE_URL}/llm/scene-stream`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ accountId, saveId, guestTokenHash }),
      signal: localCtl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (signal) signal.removeEventListener?.("abort", linkAbort);
    return { events, bytesReceived, closed: true, error: err, response: undefined };
  }

  events.push({
    tMs: Math.round(performance.now() - t0),
    kind: "open",
    raw: `HTTP ${response.status} content-type=${response.headers.get("content-type") ?? ""}`,
  });

  if (!response.ok || !response.body) {
    clearTimeout(timer);
    if (signal) signal.removeEventListener?.("abort", linkAbort);
    return { events, bytesReceived, closed: true, error: null, response };
  }

  // SSE framing: events end on a blank line. We buffer raw text and split
  // on `\n\n` to honour both `: comment` heartbeat lines AND structured
  // `event:`/`data:` blocks. We DO NOT collapse comment lines into "noise"
  // — the heartbeat assertion depends on seeing them with their timestamps.
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  const reader = response.body.getReader();

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        closed = true;
        events.push({ tMs: Math.round(performance.now() - t0), kind: "stream-end" });
        break;
      }
      bytesReceived += value.byteLength;
      buffer += decoder.decode(value, { stream: true });

      // Drain whole frames. Each SSE frame is terminated by a blank line.
      let idx;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const tMs = Math.round(performance.now() - t0);
        // Heartbeat / comment frames: a single line starting with ':'.
        if (frame.startsWith(":")) {
          events.push({ tMs, kind: "heartbeat", raw: frame });
          if (shouldStop && shouldStop({ kind: "heartbeat", tMs, raw: frame })) {
            localCtl.abort();
          }
          continue;
        }
        // Structured frame: parse event: + data: lines.
        let eventName = "message";
        const dataLines = [];
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
          // ignore id:/retry:/comment — we don't use them
        }
        const payload = {
          tMs,
          kind: "event",
          event: eventName,
          data: dataLines.join("\n"),
        };
        events.push(payload);
        if (shouldStop && shouldStop(payload)) {
          localCtl.abort();
        }
      }
    }
  } catch (err) {
    error = err instanceof Error ? err : new Error(String(err));
    events.push({
      tMs: Math.round(performance.now() - t0),
      kind: "read-error",
      raw: error.message,
    });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener?.("abort", linkAbort);
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }

  return { events, bytesReceived, closed, error, response };
}

// ──────────────────────────────────────────────────────────────────────────
// Assertions — kept in helpers so failure messages are self-describing.
// ──────────────────────────────────────────────────────────────────────────

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`assertion failed: ${label} — expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition, label) {
  if (!condition) throw new Error(`assertion failed: ${label}`);
}

// ──────────────────────────────────────────────────────────────────────────
// Scenarios.
// ──────────────────────────────────────────────────────────────────────────

test("happy path: SSE keep-alive, token stream, scene completes with non-empty prose", { timeout: STREAM_TIMEOUT_MS + 30_000 }, async () => {
  // 1) bootstrap an isolated guest account + save
  const { accountId, guestTokenHash } = await createGuestAccount();
  const { saveId, sceneId } = await createSave({ accountId, guestTokenHash, storyId: STORY_ID });
  console.log(`[happy] account=${accountId} save=${saveId} scene=${sceneId}`);

  // 2) consume the SSE stream end-to-end
  const stream = await openSceneStream({ accountId, saveId, guestTokenHash });
  const eventByKind = (filter) => stream.events.filter(filter);
  const tokens = eventByKind((e) => e.kind === "event" && e.event === "token");
  const choices = eventByKind((e) => e.kind === "event" && e.event === "choices");
  const dones = eventByKind((e) => e.kind === "event" && e.event === "done");
  const errors = eventByKind((e) => e.kind === "event" && e.event === "error");
  const heartbeats = eventByKind((e) => e.kind === "heartbeat");
  const open = stream.events.find((e) => e.kind === "open");

  console.log(
    `[happy] stream: bytes=${stream.bytesReceived} tokens=${tokens.length} choices=${choices.length} done=${dones.length} error=${errors.length} heartbeats=${heartbeats.length}`,
  );

  // 2a) connection opened with the right content type — bedrock check
  assertTrue(stream.response?.ok, `stream HTTP ok (got ${stream.response?.status})`);
  const ct = stream.response?.headers.get("content-type") ?? "";
  assertTrue(ct.includes("text/event-stream"), `content-type is text/event-stream (got ${ct})`);
  assertTrue(open !== undefined, "open event recorded");

  // 2b) heartbeat — at least one `: keep-alive` within the first 10s.
  //     Depends on the SSE-heartbeat agent's fix landing in
  //     convex/http.ts:sceneStreamResponse. Before that fix lands, this
  //     assertion is the canary that flags the bug.
  const earlyHeartbeat = heartbeats.find((h) => h.tMs <= 10_000);
  assertTrue(
    earlyHeartbeat !== undefined,
    `at least one ': keep-alive' line within 10s of open (saw ${heartbeats.length} total; first at ${heartbeats[0]?.tMs ?? "n/a"}ms)`,
  );
  assertTrue(
    String(earlyHeartbeat.raw ?? "").includes("keep-alive"),
    `heartbeat carries 'keep-alive' marker (got ${JSON.stringify(earlyHeartbeat.raw)})`,
  );

  // 2c) the stream must NOT have been forcibly closed mid-LLM. The terminal
  //     event we expect is `event: done`; an `event: error` would mean the
  //     server short-circuited (the deterministic-fallback bug presents as
  //     `done` with placeholder prose, not `error` — so we ALSO check prose).
  assertEqual(errors.length, 0, "no SSE error events on happy path");
  assertTrue(dones.length >= 1, `at least one 'event: done' (got ${dones.length})`);
  assertTrue(tokens.length >= 1, `at least one 'event: token' (got ${tokens.length})`);
  assertTrue(stream.closed, "stream closed cleanly server-side");

  // 2d) prose accumulated from token chunks is non-empty AND is not the
  //     deterministic placeholder. Once the deterministic-sentinel agent
  //     lands, we'll also verify `isFallback === false`/absent on the scene
  //     record itself (below). Keep both checks: the placeholder-prose check
  //     catches the bug today, the schema check catches it after the fix.
  const streamedProse = tokens
    .map((t) => safeJsonField(t.data, "text"))
    .filter((s) => typeof s === "string")
    .join("");
  assertTrue(streamedProse.length > 0, "accumulated streamed prose is non-empty");
  assertTrue(
    !/Press on into the story/i.test(streamedProse),
    `streamed prose is not the deterministic placeholder (got "${streamedProse.slice(0, 80)}")`,
  );

  // 3) query the scene record — single source of truth post-completion
  const scene = await getCurrentScene({ accountId, saveId, guestTokenHash });
  console.log(`[happy] scene: streamStatus=${scene?.streamStatus} prose_len=${scene?.prose?.length ?? 0} isFallback=${scene?.isFallback}`);

  assertEqual(scene?.streamStatus, "complete", "scene.streamStatus is 'complete'");
  assertTrue(typeof scene?.prose === "string" && scene.prose.length > 0, "scene.prose is non-empty");
  assertTrue(
    !/Press on into the story/i.test(scene.prose ?? ""),
    `scene.prose is not the deterministic placeholder (got "${String(scene.prose).slice(0, 80)}")`,
  );

  // Deterministic-sentinel agent: scene records that ARE deterministic-fallback
  // must carry `isFallback: true`; happy-path scenes must NOT. This assertion
  // is forward-compatible: until the field ships, `scene.isFallback` is
  // `undefined`, which satisfies "absent or false".
  assertTrue(
    scene?.isFallback === undefined || scene?.isFallback === false,
    `happy-path scene.isFallback is absent or false (got ${JSON.stringify(scene?.isFallback)})`,
  );
});

test("abort path: client-disconnect does NOT persist deterministic fallback prose", { timeout: ABORT_WAIT_MS + 60_000 }, async () => {
  // 1) bootstrap a SECOND isolated guest so this test never piggybacks on the
  //    happy-path save (which would now be `streamStatus:"complete"`)
  const { accountId, guestTokenHash } = await createGuestAccount();
  const { saveId } = await createSave({ accountId, guestTokenHash, storyId: STORY_ID });
  console.log(`[abort] account=${accountId} save=${saveId}`);

  // 2) open the SSE then abort it ASAP. We give the server enough time to
  //    accept the request and start the LLM call (so the abort is meaningful
  //    — an abort BEFORE the server reads the request body is a no-op),
  //    then we tear the client side down.
  const abortCtl = new AbortController();
  const t0 = performance.now();
  const streamPromise = openSceneStream({
    accountId,
    saveId,
    guestTokenHash,
    signal: abortCtl.signal,
    // Bail as soon as we see ANY byte come back so we know the server is
    // engaged and reading the LLM. If nothing arrives within 8s we still
    // abort, which is the worst-case "we never got a response started" path
    // — the abort-classification agent's fix must cover both.
    shouldStop: () => true,
  });

  // Race a fixed wait against the first event arriving, then abort.
  const ABORT_TRIGGER_MS = 1500;
  const winner = await Promise.race([
    streamPromise.then((r) => ({ kind: "stream", r })),
    delay(ABORT_TRIGGER_MS, null).then(() => ({ kind: "timer" })),
  ]);
  abortCtl.abort();
  if (winner.kind === "timer") {
    console.log(`[abort] aborted at ${Math.round(performance.now() - t0)}ms (no event yet)`);
  } else {
    console.log(
      `[abort] aborted after first event at ${Math.round(performance.now() - t0)}ms (events so far: ${winner.r.events.length})`,
    );
  }
  // Drain whatever the stream did up to abort — we don't assert on its
  // contents, just make sure the underlying promise resolves so we don't
  // leak an open fetch.
  const streamResult = await streamPromise.catch((err) => ({
    events: [],
    bytesReceived: 0,
    closed: true,
    error: err,
  }));
  console.log(`[abort] stream finalised: bytes=${streamResult.bytesReceived} error=${streamResult.error?.message ?? "none"}`);

  // 3) wait long enough for the LLM call to have run to completion server-side
  //    even though the client is gone. The bug is that the server, on hitting
  //    the abort, falls all the way through to the deterministic provider,
  //    which writes "Press on into the story" as the canonical scene prose.
  //    The fix: abort classification stops the router BEFORE deterministic
  //    runs, leaving the scene in pending/streaming (so a retry can pick up).
  console.log(`[abort] waiting ${ABORT_WAIT_MS}ms before polling scene…`);
  await delay(ABORT_WAIT_MS);

  // 4) read the scene record and assert the negative
  const scene = await getCurrentScene({ accountId, saveId, guestTokenHash });
  console.log(
    `[abort] scene: streamStatus=${scene?.streamStatus} prose_len=${scene?.prose?.length ?? 0} prose="${String(scene?.prose ?? "").slice(0, 80)}" isFallback=${scene?.isFallback}`,
  );

  // 4a) streamStatus must not be "complete" — completion would mean the
  //     server treated the abort as a legitimate finish (the bug).
  assertTrue(
    scene?.streamStatus !== "complete",
    `scene.streamStatus is NOT 'complete' after client-abort (got ${JSON.stringify(scene?.streamStatus)})`,
  );

  // 4b) prose must be empty. The deterministic provider writes filler
  //     ("Press on into the story") that satisfies streamStatus="complete"
  //     while looking semantically valid — assert on BOTH so a partial fix
  //     can't sneak through.
  assertTrue(
    typeof scene?.prose !== "string" || scene.prose.length === 0,
    `scene.prose is empty after client-abort (got "${String(scene?.prose).slice(0, 80)}")`,
  );
});

// ──────────────────────────────────────────────────────────────────────────
// Utilities.
// ──────────────────────────────────────────────────────────────────────────

function stripTrailingSlash(url) {
  return url.replace(/\/+$/, "");
}

function deriveSiteUrl(apiUrl) {
  // Convex local: API is 3210, site (where /llm/scene-stream is mounted) is
  // 3211. We swap the port if it's the well-known 3210; otherwise we assume
  // the caller already pointed --api-url at the site URL too (single-host
  // staging deployments do this).
  try {
    const u = new URL(apiUrl);
    if (u.port === "3210") {
      u.port = "3211";
      return u.toString().replace(/\/+$/, "");
    }
    return apiUrl;
  } catch {
    return apiUrl;
  }
}

function safeJsonField(text, key) {
  if (typeof text !== "string" || text.length === 0) return undefined;
  try {
    const parsed = JSON.parse(text);
    return parsed?.[key];
  } catch {
    return undefined;
  }
}
