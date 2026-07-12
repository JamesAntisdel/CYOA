// Drift-guards for the terminal ending-panel promises (panel-review fix;
// core-read-loop Req 8.3 + story-engagement R14.2):
//
//   1. "Begin again" creates a FRESH save of the SAME story via the cover
//      screen's create-save flow (useLibrary.createSave + forceNew) and opens
//      its reader — never a dead tap: failures fall back to the cover.
//   2. "See the map" opens the per-save path map `/map/[saveId]` and "Fork
//      from a decision" opens the run-history fork surface
//      `/read/[saveId]/history` — not the global trophy crypt.
//   3. The panel receives the run facts (turnNumber + endingNumber/
//      endingsTotal) so Brutal's "Ending #X of Y · turn N" line can render,
//      and the layouts mount the ConsequenceReel recap on the terminal panel.
//   4. The trophy crypt prettifies raw endingId slugs / recorded node paths
//      so machine ids (`storyId:llm:N`) never surface.
//
// Source-level greps (same pattern as storyEngagementW3Client.test.mjs) —
// mounting the RN + Convex tree is out of scope for `node --test`. The pure
// prettifier logic has behavioral coverage in
// `apps/app/lib/__tests__/endingLabels.test.ts`.

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

test("ReaderScreen wires Begin again to a fresh same-story save with a cover fallback", () => {
  const src = read("components/reading/ReaderScreen.tsx");
  assert.match(
    src,
    /import \{ useLibrary \} from "\.\.\/\.\.\/hooks\/useLibrary";/,
    "ReaderScreen must reuse the cover screen's create-save flow (useLibrary)",
  );
  assert.match(
    src,
    /library\.createSave\(storyId, "story", undefined, undefined, undefined, \{\s*forceNew: true,?\s*\}\)/,
    "Begin again must mint a FRESH save of the same story (forceNew — Req 8.3)",
  );
  assert.match(
    src,
    /router\.push\(`\/read\/\$\{save\.saveId\}`\)/,
    "Begin again must open the new save's reading view",
  );
  // Never a dead tap: guest/limit/network errors land on the cover.
  assert.match(
    src,
    /catch \{\n\s*\/\/ guest_session_required \/ save limits \/ network — land on the cover\n\s*\/\/ so the reader can restart from there\.\n\s*router\.push\("\/"\);/,
    "Begin again failures must fall back to the story cover",
  );
  assert.match(src, /onBeginAgain=\{\(\) => void beginAgain\(\)\}/, "the layout must receive onBeginAgain");
});

test("ReaderScreen wires See-map to the per-save path map and Fork to run history", () => {
  const src = read("components/reading/ReaderScreen.tsx");
  assert.match(
    src,
    /onSeeMap=\{\(\) => router\.push\(`\/map\/\$\{saveId\}`\)\}/,
    "See the map must open /map/[saveId], not the trophy crypt",
  );
  assert.match(
    src,
    /onFork=\{\(\) => router\.push\(`\/read\/\$\{saveId\}\/history`\)\}/,
    "Fork from a decision must open /read/[saveId]/history (R14.2)",
  );
});

test("useLibrary.createSave supports forceNew so Begin again never resumes the ended run", () => {
  const src = read("hooks/useLibrary.ts");
  assert.match(src, /forceNew\?: boolean;/, "createSave must accept a forceNew option");
  assert.match(
    src,
    /if \(!seed\?\.premise && !options\?\.forceNew\) \{/,
    "forceNew must skip the reuse-an-active-save shortcut",
  );
});

test("endingPanelHandlers prefers the dedicated Begin-again / See-map handlers", () => {
  const types = read("components/reading/layouts/types.ts");
  assert.match(
    types,
    /const beginAgain = props\.onBeginAgain \?\? props\.onReturnHome;/,
    "onBeginAgain must win over the legacy return-home wire",
  );
  assert.match(
    types,
    /const seeMap = props\.onSeeMap \?\? props\.onOpenEndings;/,
    "onSeeMap must win over the legacy open-endings wire",
  );
});

test("the terminal panel receives the run facts for 'Ending #X of Y · turn N'", () => {
  const types = read("components/reading/layouts/types.ts");
  assert.match(
    types,
    /if \(input\.projection\.turnNumber !== undefined\) out\.turnNumber = input\.projection\.turnNumber;/,
    "endingVariantProps must forward the projection's turnNumber",
  );
  assert.match(
    types,
    /if \(ending\?\.endingNumber !== undefined\) out\.endingNumber = ending\.endingNumber;/,
    "endingVariantProps must forward endingNumber",
  );
  assert.match(
    types,
    /if \(ending\?\.endingsTotal !== undefined\) out\.endingsTotal = ending\.endingsTotal;/,
    "endingVariantProps must forward endingsTotal",
  );

  const useTurn = read("hooks/useTurn.ts");
  assert.match(
    useTurn,
    /function endingCatalogFacts\(/,
    "useTurn must derive ending catalog facts",
  );
  // Both projection paths (remote + local engine) stamp the facts onto the
  // ending, conditional via the helper's {} return (BC4).
  const occurrences = useTurn.split("...endingCatalogFacts(story, terminal.endingId)").length - 1;
  assert.equal(occurrences, 2, "both scene projections must spread the ending catalog facts");
});

test("layouts mount the ConsequenceReel recap on the terminal panel", () => {
  for (const layout of ["Book", "Mobile", "ModernApp", "GraphicNovel", "Journal"]) {
    const src = read(`components/reading/layouts/${layout}.tsx`);
    assert.match(
      src,
      /import \{ ConsequenceReel \} from "\.\.\/ConsequenceReel";/,
      `${layout} must import ConsequenceReel`,
    );
    assert.match(
      src,
      /\{choiceHistory && choiceHistory\.length > 0 \? \(\s*<ConsequenceReel entries=\{choiceHistory\} \/>\s*\) : null\}/,
      `${layout} must render ConsequenceReel only when the run recorded choices`,
    );
    // Inside the terminal-only branch, alongside EndingPanel.
    const endingBranch = src.slice(src.indexOf("projection.ending ?"));
    assert.ok(
      endingBranch.indexOf("<ConsequenceReel") > -1 &&
        endingBranch.indexOf("<ConsequenceReel") < endingBranch.indexOf("<ChoiceList"),
      `${layout} must render ConsequenceReel in the terminal branch, before the ChoiceList fallback`,
    );
  }
});

test("the trophy crypt prettifies endingId slugs and hides machine path hints", () => {
  const src = read("app/endings/index.tsx");
  assert.match(
    src,
    /import \{ preferredPathHint, prettifyEndingLabel \} from "\.\.\/\.\.\/lib\/endingLabels";/,
    "endings route must import the prettifiers",
  );
  assert.doesNotMatch(
    src,
    /title: u\.safetyEnding \? "A safe close" : u\.endingId,/,
    "raw endingId slugs must no longer render as trophy titles",
  );
  assert.match(
    src,
    /prettifyEndingLabel\(u\.endingId, u\.label\)/,
    "trophy titles must prefer a server label with the title-cased-slug fallback",
  );
  assert.doesNotMatch(
    src,
    /path\.join\(" → "\)/,
    "raw node-id paths must no longer render as path hints",
  );
  // Panel review follow-up: path hints prefer the server-persisted choice
  // labels (`pathLabels`) and fall back to the prettified node-id path for
  // legacy rows — for both catalog unlocks and appended llm/safety unlocks.
  assert.match(
    src,
    /preferredPathHint\(unlock\.pathLabels, unlock\.path\)/,
    "catalog path hints must prefer server choice labels over node ids",
  );
  assert.match(
    src,
    /preferredPathHint\(u\.pathLabels, u\.path\)/,
    "appended-unlock path hints must prefer server choice labels over node ids",
  );
});
