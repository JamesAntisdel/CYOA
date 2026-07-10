// Regression test for the /map storyboard caption helper.
//
// `captionFromProse` lives inline in `apps/app/app/map/[saveId]/index.tsx`
// (small enough not to warrant its own module). This test pins the
// behaviour by mirroring the helper here and drift-guarding the source.
//
// IMPORTANT: keep `captionFromProseMirror` below in lock-step with the
// real helper — if one changes, change the other.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(here, "../../../app/map/[saveId]/index.tsx");
const tsSource = readFileSync(sourcePath, "utf8");

// Drift guards: pin the two invariants of the helper. The 160-char cap
// and the 60-char minimum-window-before-fallback together stop the
// helper from emitting either bare-fragment captions ("The") or wall-of-
// text captions that crowd out the image.
assert.match(
  tsSource,
  /STORYBOARD_CAPTION_CHARS = 160;/,
  "captionFromProse must cap at 160 chars",
);
assert.match(
  tsSource,
  /function captionFromProse\(prose: string\): string/,
  "captionFromProse signature must stay (prose: string) => string",
);
assert.match(
  tsSource,
  /if \(lastBoundary >= 60\)/,
  "captionFromProse must require >=60 chars before accepting a sentence boundary",
);

const STORYBOARD_CAPTION_CHARS = 160;

function captionFromProseMirror(prose) {
  const trimmed = prose.trim();
  if (trimmed.length === 0) return "";
  if (trimmed.length <= STORYBOARD_CAPTION_CHARS) return trimmed;
  const window = trimmed.slice(0, STORYBOARD_CAPTION_CHARS);
  const lastBoundary = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("! "),
    window.lastIndexOf("? "),
  );
  if (lastBoundary >= 60) {
    return window.slice(0, lastBoundary + 1);
  }
  const lastSpace = window.lastIndexOf(" ");
  if (lastSpace >= 60) {
    return `${window.slice(0, lastSpace)}…`;
  }
  return `${window}…`;
}

test("captionFromProse returns empty for empty prose", () => {
  assert.equal(captionFromProseMirror(""), "");
  assert.equal(captionFromProseMirror("   "), "");
});

test("captionFromProse returns the full prose when under the cap", () => {
  const short = "The lantern flickered once.";
  assert.equal(captionFromProseMirror(short), short);
});

test("captionFromProse cuts at the first sentence boundary past 60 chars", () => {
  const prose =
    "The hall was narrow and smelled of beeswax. A chalk sigil hummed under her boots, throwing soft blue light into the gathered dust. She pulled the brass bowl closer to her chest.";
  const caption = captionFromProseMirror(prose);
  assert.ok(caption.length <= STORYBOARD_CAPTION_CHARS);
  assert.ok(
    caption.endsWith("."),
    `caption should end on a sentence boundary; got: "${caption}"`,
  );
  assert.equal(
    caption,
    "The hall was narrow and smelled of beeswax. A chalk sigil hummed under her boots, throwing soft blue light into the gathered dust.",
  );
});

test("captionFromProse falls back to word-boundary ellipsis when no sentence break fits", () => {
  // No sentence-terminator inside the 160-char window.
  const prose =
    "An interminable corridor whose walls were lined with brass plaques whose engravings curled like ivy under the torchlight and whispered themselves into impossible cursive letters that no one in the academy could ever quite read aloud without stumbling on the third syllable";
  const caption = captionFromProseMirror(prose);
  assert.ok(caption.length <= STORYBOARD_CAPTION_CHARS + 1); // +1 for the …
  assert.ok(caption.endsWith("…"), `caption should end with ellipsis; got: "${caption}"`);
  assert.ok(!caption.includes("  "), "caption should not include doubled spaces");
});

test("captionFromProse trims leading whitespace before measuring length", () => {
  const prose = `   ${"hi ".repeat(200)}`;
  const caption = captionFromProseMirror(prose);
  assert.ok(!caption.startsWith(" "), "caption should be trimmed at the start");
  assert.ok(caption.length <= STORYBOARD_CAPTION_CHARS + 1);
});

test("captionFromProse handles question and exclamation boundaries", () => {
  const prose =
    "Did the door open on its own? A long pause, a thin draft from somewhere below the floorboards, and then a thump that rattled the whole frame. She froze. She had not pressed anything.";
  const caption = captionFromProseMirror(prose);
  assert.ok(
    caption.endsWith("?") || caption.endsWith(".") || caption.endsWith("!"),
    `caption should end on a sentence terminator; got: "${caption}"`,
  );
});
