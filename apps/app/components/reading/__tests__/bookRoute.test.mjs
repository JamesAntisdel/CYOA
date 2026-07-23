// Shape + invariant tests for the read-runs-as-books route at
// `apps/app/app/read/[saveId]/book/index.tsx` and the shared load hook
// `apps/app/hooks/useRunHistory.ts` (reading-modes Wave 1, R2).
//
// The route is a pure PRESENTATION surface over `getRemoteRunHistory`
// (`game:getRunHistory`, owner-authed + entitlement-free — RM9). We don't
// mount React Native here (that would balloon the surface); instead we
// drift-guard the route/hook sources for the load-bearing invariants and
// mirror the two tiny pure helpers the route exports so their behavior is
// covered with plain data.
//
// Covered invariants:
//   1. Shared-hook parity — BOTH the archive route and the book route load
//      history through the SAME `useRunHistory` hook (R2.9).
//   2. Read-only by construction — the book route NEVER imports or calls the
//      rewind/rewrite mutation the archive route uses (RM9, R2.3).
//   3. In-progress "so far" framing (R2.6) via the pure `bookSubtitle`.
//   4. 200-turn cap handling — the route surfaces an explicit
//      "earlier chapters" notice on `hasMore`, never a silent omission (R2.8).
//   5. Choice-free treatment — the subtle italic transition line derived from
//      `turn.choice.choiceLabel`, null for the opening turn (OQ5 default).

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const bookRoutePath = resolve(here, "../../../app/read/[saveId]/book/index.tsx");
const historyRoutePath = resolve(
  here,
  "../../../app/read/[saveId]/history/index.tsx",
);
const hookPath = resolve(here, "../../../hooks/useRunHistory.ts");

const bookSource = readFileSync(bookRoutePath, "utf8");
const historySource = readFileSync(historyRoutePath, "utf8");
const hookSource = readFileSync(hookPath, "utf8");

// Strip block + line comments so negative assertions target real code, not
// the docstrings that legitimately NAME the things they forbid (e.g. the
// book route's comment "never imports the rewind mutation").
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
const bookCode = stripComments(bookSource);
const hookCode = stripComments(hookSource);

// ── 1. Shared-hook parity (R2.9) ──────────────────────────────────────────
test("both read-back routes load history through the shared useRunHistory hook", () => {
  assert.match(
    bookSource,
    /useRunHistory\(/,
    "book route must load through useRunHistory",
  );
  assert.match(
    historySource,
    /useRunHistory\(/,
    "history route must load through useRunHistory (post-R2.9 refactor)",
  );
  // The hook is the ONE place the read-back fetch lives.
  assert.match(
    hookSource,
    /getRemoteRunHistory\(\{/,
    "useRunHistory must call getRemoteRunHistory",
  );
});

test("the shared hook is the ONLY place the book route reaches for run history", () => {
  // The book route must NOT re-implement the fetch (that would let the two
  // routes diverge). It only consumes the hook.
  assert.doesNotMatch(
    bookSource,
    /getRemoteRunHistory\(/,
    "book route must not call getRemoteRunHistory directly — it uses the hook",
  );
});

// ── 2. Read-only by construction (RM9, R2.3) ──────────────────────────────
test("book route NEVER imports or calls the rewind/rewrite mutations", () => {
  // The archive route wires rewindRemoteSaveTurns for its trim-the-tail
  // panel; the book route is read-only by construction and must never touch
  // it (nor a hypothetical rewriteRemoteSaveTurns).
  assert.doesNotMatch(
    bookCode,
    /rewindRemoteSaveTurns/,
    "book route must never reference rewindRemoteSaveTurns",
  );
  assert.doesNotMatch(
    bookCode,
    /rewriteRemoteSaveTurns/,
    "book route must never reference rewriteRemoteSaveTurns",
  );
  // Broadest form of the assertion (comments stripped): no rewind/rewrite
  // token in real code — read-only surface by construction.
  assert.doesNotMatch(
    bookCode,
    /rewind|rewrite/i,
    "book route must contain no rewind/rewrite token — read-only surface",
  );
});

test("the shared hook itself is write-free (no rewind/rewrite)", () => {
  // Parity guarantee only holds if the shared hook is also read-only; the
  // rewind write path lives in the archive route, not the hook.
  assert.doesNotMatch(
    hookCode,
    /rewind|rewrite/i,
    "useRunHistory must be read-only — no rewind/rewrite",
  );
});

// ── 3. In-progress "so far" framing (R2.6) ────────────────────────────────
// Mirror of the route's exported `bookSubtitle`. Keep in lock-step with the
// route — the drift guard below asserts the route still defines it.
function bookSubtitle(input) {
  if (!input.ready) return "Read your run back as one continuous tale.";
  return input.finished
    ? "The tale, read start to finish."
    : "Your tale so far — read back as one continuous story.";
}

test("bookSubtitle frames an in-progress save as 'so far', never finished", () => {
  const inProgress = bookSubtitle({ finished: false, ready: true });
  assert.match(inProgress, /so far/i, "in-progress framing must say 'so far'");
  assert.doesNotMatch(
    inProgress,
    /start to finish|finished/i,
    "in-progress framing must not imply a finished tale",
  );
});

test("bookSubtitle frames a finished save as a complete tale", () => {
  const done = bookSubtitle({ finished: true, ready: true });
  assert.doesNotMatch(
    done,
    /so far/i,
    "finished framing must not say 'so far'",
  );
});

test("book route reads the finished flag from the route param and defaults to in-progress", () => {
  // The finished/in-progress fact arrives via the `finished` route param
  // (entry points pass finished=1); absence takes the SAFE in-progress
  // default so an unfinished run is never mis-framed as complete.
  assert.match(
    bookSource,
    /params\.finished === "1"/,
    "book route must read the finished route param",
  );
  assert.match(
    bookSource,
    /export function bookSubtitle/,
    "book route must define the mirrored bookSubtitle helper",
  );
});

// ── 4. 200-turn cap handling (R2.8) ───────────────────────────────────────
test("book route surfaces an explicit 'earlier chapters' notice on hasMore", () => {
  assert.match(
    bookSource,
    /state\.history\.hasMore/,
    "book route must branch on the getRunHistory hasMore cap flag",
  );
  assert.match(
    bookSource,
    /[Ee]arlier chapters/,
    "book route must show an explicit earlier-chapters notice (never silent)",
  );
});

// ── 5. Choice-free treatment — italic transition line (OQ5, R2.4) ─────────
// Mirror of the route's exported `chapterTransition`.
function chapterTransition(turn) {
  const label = turn.choice?.choiceLabel?.trim();
  if (!label) return null;
  return `— you chose to ${label}`;
}

test("chapterTransition derives a subtle italic transition from choiceLabel", () => {
  assert.equal(
    chapterTransition({ choice: { choiceId: "c1", choiceLabel: "open the door" } }),
    "— you chose to open the door",
  );
});

test("chapterTransition returns null for the opening turn (no inbound choice)", () => {
  assert.equal(chapterTransition({}), null);
  assert.equal(chapterTransition({ choice: undefined }), null);
  assert.equal(
    chapterTransition({ choice: { choiceId: "c1", choiceLabel: "   " } }),
    null,
    "a whitespace-only label must not paint a transition line",
  );
});

test("book route renders continuous prose without archive card chrome", () => {
  // No "Turn N" label, no "You chose:" chip — this is a continuous read.
  assert.doesNotMatch(
    bookCode,
    /Turn \{turn\.turnNumber\}/,
    "book route must not render a 'Turn N' label",
  );
  assert.doesNotMatch(
    bookCode,
    /You chose:/,
    "book route must not render a 'You chose:' chip",
  );
  assert.match(
    bookCode,
    /ProseRenderer/,
    "book route must render prose through the shared ProseRenderer",
  );
});
