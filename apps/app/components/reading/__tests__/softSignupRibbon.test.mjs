// Drift-guards for the Panel-2 Wave 2 turn-3 soft-signup ribbon (panel-review-2
// HIGH: "The turn-3 soft signup prompt — a named product.md target — does not
// exist"). One-shot dismissible, guest-only, at turn 3, claiming in place via
// the already-built claimWithEmail. Source-level greps.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "../../..");

function read(rel) {
  return readFileSync(resolve(appRoot, rel), "utf8");
}

test("softSignup.ts pins the turn-3 trigger + one-shot dismissal (coach-mark pattern)", () => {
  const src = read("components/reading/softSignup.ts");
  assert.match(src, /export const SOFT_SIGNUP_TURN = 3;/, "prompt fires at turn 3");
  assert.match(src, /SOFT_SIGNUP_DISMISSED_KEY = "cyoa\.softSignupDismissed\.v1"/, "versioned storage key");
  assert.match(src, /export function hasDismissedSoftSignup\(/, "read helper");
  assert.match(src, /export function markSoftSignupDismissed\(/, "write helper");
  // Same guarded-localStorage discipline as the first-lock coach — degrades to
  // "never persisted" without web storage.
  assert.match(src, /globalThis as \{ localStorage\?: Storage \}/, "guarded web storage access");
});

test("the honest copy names the 7-day guest purge (true urgency)", () => {
  const src = read("components/reading/softSignup.ts");
  assert.match(src, /vanishing ink/i, "narrator-voiced framing");
  assert.match(src, /seven days/i, "must state the real 7-day purge honestly");
});

test("SoftSignupRibbon claims in place with an inline email field (no route change)", () => {
  const src = read("components/reading/SoftSignupRibbon.tsx");
  assert.match(src, /onClaim: \(email: string\) => Promise/, "takes an onClaim(email) prop");
  assert.match(src, /onDismiss: \(\) => void/, "takes an onDismiss prop");
  assert.match(src, /<Field/, "uses the canonical Field primitive for email input");
  assert.match(src, /keyboardType="email-address"/, "email keyboard");
  // No router import — the claim happens inline, preserving the reading flow.
  assert.ok(!/expo-router/.test(src), "the ribbon must not navigate away to claim");
});

test("ReaderScreen gates the ribbon on guest + turn>=3 + not-yet-dismissed", () => {
  const src = read("components/reading/ReaderScreen.tsx");
  assert.match(
    src,
    /profile\?\.kind === "guest" &&\s*\n\s*turnNumber >= SOFT_SIGNUP_TURN/,
    "must gate on guest kind AND turnNumber >= SOFT_SIGNUP_TURN",
  );
  assert.match(src, /!softSignupDismissed/, "must respect the one-shot dismissal");
  assert.match(src, /!isTerminalView/, "must not show on terminal panels");
  // Wires the existing claim path + persists dismissal.
  assert.match(src, /onClaim=\{claimWithEmail\}/, "reuses claimWithEmail");
  assert.match(src, /markSoftSignupDismissed\(\)/, "persists the dismissal");
});
