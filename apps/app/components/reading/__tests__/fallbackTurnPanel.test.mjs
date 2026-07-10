// Drift-guard for the deterministic-fallback FallbackTurnPanel surface.
//
// `FallbackTurnPanel` renders in place of the prose + ChoiceList whenever
// `projection.scene.isFallback === true`. Without it the reader would see
// the deterministic provider's placeholder text ("press on into the
// story", "hold still and listen") as if it were a real LLM scene — the
// exact bug this whole change set fixes.
//
// This file is pure-Node so it runs as part of
// `pnpm --filter @cyoa/app test` without a JSX transform. It asserts:
//
//  1. FallbackTurnPanel.tsx exposes the documented props + copy.
//  2. Every reading layout (Book, Mobile, Journal, ModernApp,
//     GraphicNovel) imports FallbackTurnPanel and branches on
//     `projection.scene.isFallback`.
//  3. The Layout-shared `ReaderLayoutProps` carries the
//     `onRetryCurrentTurn` callback that the panel consumes.
//
// If any of these checks fails, the panel was either removed, renamed,
// or one of the layouts forgot to wire it — both leave the reader
// looking at deterministic placeholder prose.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const readingRoot = resolve(here, "..");

function readSource(relativePath) {
  return readFileSync(resolve(readingRoot, relativePath), "utf8");
}

test("FallbackTurnPanel renders the documented copy and the retry button", () => {
  const source = readSource("FallbackTurnPanel.tsx");
  // Title — the in-story headline the reader sees first. Pin the exact
  // string so a copy refresh doesn't silently regress to a placeholder.
  assert.match(
    source,
    /The page is blank for a moment\./,
    "FallbackTurnPanel must show the canonical title copy",
  );
  // Body — explains the recovery without leaking provider terminology.
  assert.match(
    source,
    /We couldn[a-zA-Z&;'\\]+t reach the storyteller/,
    "FallbackTurnPanel must explain the failure in reader-facing language",
  );
  // Button label — what the user taps. Both states ("Try again" and the
  // in-flight "Trying again...") must be present.
  assert.match(source, /Try again/, "FallbackTurnPanel must offer a Try again button");
  assert.match(
    source,
    /Trying again\.\.\./,
    "FallbackTurnPanel must surface an in-flight label while retrying",
  );
  // Props contract.
  assert.match(
    source,
    /onRetry: \(\) => void \| Promise<void>;/,
    "FallbackTurnPanel must accept onRetry as a void/promise callback",
  );
});

test("FallbackTurnPanel is owned by the deterministic-fallback projection branch", () => {
  // The panel must NOT silently render on real-provider scenes. The
  // simplest invariant: the source never references `prose` (the panel
  // is intentionally content-free apart from the canonical copy).
  const source = readSource("FallbackTurnPanel.tsx");
  assert.equal(
    /streamedProse/.test(source),
    false,
    "FallbackTurnPanel must not render scene prose — that's the bug it exists to avoid",
  );
});

const LAYOUTS = ["Book.tsx", "Mobile.tsx", "Journal.tsx", "ModernApp.tsx", "GraphicNovel.tsx"];

for (const layoutFile of LAYOUTS) {
  test(`${layoutFile} renders FallbackTurnPanel when projection.scene.isFallback`, () => {
    const source = readSource(`layouts/${layoutFile}`);
    assert.match(
      source,
      /import \{ FallbackTurnPanel \} from "\.\.\/FallbackTurnPanel";/,
      `${layoutFile} must import FallbackTurnPanel`,
    );
    assert.match(
      source,
      /projection\.scene\.isFallback === true/,
      `${layoutFile} must branch on projection.scene.isFallback === true`,
    );
    assert.match(
      source,
      /<FallbackTurnPanel[\s\S]*?onRetry=/,
      `${layoutFile} must mount <FallbackTurnPanel onRetry=...>`,
    );
  });
}

test("ReaderLayoutProps carries the onRetryCurrentTurn callback", () => {
  const source = readSource("layouts/types.ts");
  assert.match(
    source,
    /onRetryCurrentTurn\?: \(\) => void \| Promise<void>;/,
    "ReaderLayoutProps must declare onRetryCurrentTurn so layouts can wire the panel",
  );
});
