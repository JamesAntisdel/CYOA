// Drift-guards for the A3 DecisionPoint frame (reading-modes cleanup). The
// frame wraps a real branching fork with a printed header; it must NEVER wrap
// Novel mode's sole synthetic `turn-page` choice. Source-level greps + a pure
// mirror of the `isDecisionPoint` predicate, matching the house pattern in
// components/*/__tests__ (mounting the RN tree is out of scope for node --test).

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

// The single control-emoji family we must never ship in UI (RC5). Story-art
// glyphs are exempt but none appear here; the motif is drawn Views.
const BANNED_EMOJI =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️]/u;

test("DecisionPoint renders the italic 'The path forks' label + the stakes subline", () => {
  const src = read("components/choices/DecisionPoint.tsx");
  assert.match(
    src,
    /DECISION_POINT_LABEL = "The path forks"/,
    "the header label must read 'The path forks'",
  );
  assert.match(
    src,
    /DECISION_POINT_SUBLINE = "What you choose here changes what comes next\."/,
    "the subline must read 'What you choose here changes what comes next.'",
  );
  // The label is set in an italic serif — the printed-fork voice.
  assert.match(src, /fontStyle: "italic"/, "the label must be italicised");
  assert.match(
    src,
    /fontFamily: tokens\.typography\.families\.serif/,
    "the label must use the serif family token",
  );
});

test("DecisionPoint draws the fork motif from Views — no control emoji (RC5)", () => {
  const src = read("components/choices/DecisionPoint.tsx");
  assert.ok(
    !BANNED_EMOJI.test(src),
    "DecisionPoint must not contain any control/arrow emoji — the motif is drawn Views",
  );
  // The motif is a real drawn View primitive, not a glyph.
  assert.match(src, /function ForkMark/, "the diverging-path motif must be a drawn ForkMark");
  assert.ok(
    /transform: \[\{ rotate:/.test(src),
    "the fork branches must be drawn as rotated View strokes",
  );
});

test("the frame uses a hairline top rule from the theme tokens (no raw hex)", () => {
  const src = read("components/choices/DecisionPoint.tsx");
  assert.match(
    src,
    /borderTopWidth: tokens\.borderWidths\.hairline/,
    "the top rule must be a hairline token",
  );
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src), "no raw hex colors — theme tokens only");
});

test("isDecisionPoint reuses the PAGE_TURN_CHOICE_ID contract, not a hardcoded id", () => {
  const src = read("components/choices/DecisionPoint.tsx");
  assert.match(
    src,
    /import \{ PAGE_TURN_CHOICE_ID \} from "\.\.\/reading\/layouts\/pageTurn"/,
    "the predicate must import the shared page-turn id",
  );
  assert.match(
    src,
    /choices\[0\]\?\.id === PAGE_TURN_CHOICE_ID/,
    "suppression must test against PAGE_TURN_CHOICE_ID, not a literal 'turn-page'",
  );
  // The predicate must not smuggle the literal into the fork detection.
  const predStart = src.indexOf("export function isDecisionPoint");
  const predBody = src.slice(predStart, src.indexOf("}", src.indexOf("return true", predStart)));
  assert.ok(
    !/"turn-page"/.test(predBody),
    "isDecisionPoint must not hardcode the 'turn-page' literal",
  );
});

// PURE MIRROR of isDecisionPoint (the source imports the id; here we pin its id
// to the same contract value and re-derive the branching decision so the
// behavior — frame a 2-choice scene, suppress a sole synthetic turn-page — is
// checked, not just grepped).
const PAGE_TURN_CHOICE_ID = "turn-page";
function isDecisionPoint(choices) {
  if (!choices || choices.length === 0) return false;
  if (choices.length === 1 && choices[0]?.id === PAGE_TURN_CHOICE_ID) return false;
  return true;
}

test("frame shows for a normal 2-choice fork, suppressed for the sole turn-page", () => {
  assert.equal(
    isDecisionPoint([{ id: "a" }, { id: "b" }]),
    true,
    "a normal 2-choice scene is a fork — frame it",
  );
  assert.equal(
    isDecisionPoint([{ id: PAGE_TURN_CHOICE_ID }]),
    false,
    "Novel's sole synthetic turn-page is NOT a fork — no frame",
  );
  assert.equal(isDecisionPoint([]), false, "0-choice terminal payload is not a fork");
  assert.equal(isDecisionPoint(null), false, "missing choices is not a fork");
  assert.equal(
    isDecisionPoint([{ id: "a" }]),
    true,
    "a single real branching choice still forks",
  );
});

// Pin the source constant that the mirror above depends on, so a rename of the
// page-turn id can't silently drift the mirror out of sync with the app.
test("the mirror's page-turn id matches the pageTurn source of truth", () => {
  const src = read("components/reading/layouts/pageTurn.ts");
  assert.match(
    src,
    /PAGE_TURN_CHOICE_ID = "turn-page"/,
    "pageTurn.ts must still stamp the id this mirror pins",
  );
});

test("ChoiceList wraps the list in DecisionPoint only at a real fork", () => {
  const src = read("components/choices/ChoiceList.tsx");
  assert.match(
    src,
    /import \{ DecisionPoint, isDecisionPoint \} from "\.\/DecisionPoint"/,
    "ChoiceList must import the frame + predicate",
  );
  assert.match(
    src,
    /const framed = isDecisionPoint\(choices\)/,
    "ChoiceList must gate the frame on isDecisionPoint",
  );
  assert.match(
    src,
    /framed \? <DecisionPoint>\{list\}<\/DecisionPoint> : list/,
    "ChoiceList must wrap the choices only when framed",
  );
  // The submit path stays byte-identical — onChoose still fires directly.
  assert.match(src, /onPress=\{\(\) => onChoose\(choice\)\}/, "onChoose must be unchanged");
});

test("FootnoteChoices gains the 'The path forks' header above the footnote rule", () => {
  const src = read("components/reading/layouts/spread/FootnoteChoices.tsx");
  assert.match(
    src,
    /import \{ DecisionPointHeader, isDecisionPoint \} from "\.\.\/\.\.\/\.\.\/choices\/DecisionPoint"/,
    "FootnoteChoices must import the shared header + predicate",
  );
  // The header must sit ABOVE the footnote rule (the printed dividing line).
  const headerIdx = src.indexOf("<DecisionPointHeader />");
  const ruleIdx = src.indexOf("The footnote rule");
  assert.ok(headerIdx > -1, "the header must be rendered");
  assert.ok(ruleIdx > -1, "the footnote rule comment must still exist");
  assert.ok(headerIdx < ruleIdx, "the header must render above the footnote rule");
  assert.match(
    src,
    /isDecisionPoint\(choices\) \? <DecisionPointHeader \/> : null/,
    "the header must be gated on a real fork",
  );
});
