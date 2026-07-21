// Reading-modes R2.7 — drift guards for the "Read this tale as a book"
// action on EndingPanel.
//
// EndingPanel imports react-native, so (per the co-located vitest config)
// we do NOT mount it — we drift-guard the source for the optional
// onReadAsBook prop and its self-hiding render branch. RM-AUTO wires the
// handler from ReaderScreen; the prop name (onReadAsBook) and signature
// (() => void) are the cross-agent contract this test pins.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "../EndingPanel.tsx"), "utf8");

describe("EndingPanel read-as-book action", () => {
  it("declares an OPTIONAL onReadAsBook handler prop (the RM-AUTO contract)", () => {
    expect(source).toMatch(
      /onReadAsBook\?:\s*\(\(\) => void\)\s*\|\s*undefined/,
    );
  });

  it("destructures onReadAsBook from props", () => {
    expect(source).toMatch(/\bonReadAsBook,\n\}: EndingPanelProps/);
  });

  it("self-hides the action when no handler is supplied (BC4 — never undefined)", () => {
    // When absent, the bare variant renders — no wrapper, no button.
    expect(source).toMatch(/if \(onReadAsBook === undefined\) \{\s*return <Variant \{\.\.\.variantProps\} \/>;/);
  });

  it("renders the 'Read this tale as a book' action when a handler is present", () => {
    expect(source).toMatch(/accessibilityLabel="Read this tale as a book"/);
    expect(source).toMatch(/onPress=\{onReadAsBook\}/);
    expect(source).toMatch(/Read this tale as a book/);
  });
});
