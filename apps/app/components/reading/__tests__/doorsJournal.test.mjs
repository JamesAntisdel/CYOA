// Drift-guards for the DOORS-JOURNAL reader surface (the client half of the
// story-bible fetch-quest loop). Source-level greps, same pattern as
// storyEngagementClient.test.mjs — the pure derivation logic (tome voice,
// key-arrival detection) has behavioral coverage in the vitest suite
// `apps/app/lib/__tests__/doorsJournal.test.ts`; here we pin the wiring and
// the spoiler-safe wire shape.

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

test("DoorsJournal hides entirely at zero (zero-state invisible, ThreadsPill discipline)", () => {
  const src = read("components/reading/DoorsJournal.tsx");
  assert.match(
    src,
    /if \(!entries \|\| entries\.length === 0\) return null;/,
    "DoorsJournal must render nothing for saves with no teased doors",
  );
});

test("DoorsJournal fetches the server projection and speaks in the tome voice", () => {
  const src = read("components/reading/DoorsJournal.tsx");
  assert.match(src, /getRemoteDoorsJournal\(/, "DoorsJournal must fetch via getRemoteDoorsJournal");
  assert.match(src, /doorJournalLine\(entry\)/, "entries must render through the tome-voice line");
  assert.match(src, /the tome remembers/, "the pill must carry the tome-voice framing");
});

test("DoorsJournal nudges once per scene when a teased door's key arrives, naming the door", () => {
  const src = read("components/reading/DoorsJournal.tsx");
  assert.match(src, /doorsNewlyKeyed\(/, "arrival detection must go through doorsNewlyKeyed");
  // The nudge now NAMES the door + points at the pill (panel-review-2 merged
  // doors-journal idea) via the shared keyArrivalToast helper — no longer the
  // anonymous "A key has turned up." string inline.
  assert.match(src, /keyArrivalToast\(arrivals\)/, "the nudge must build its copy from keyArrivalToast");
  assert.match(src, /nudgedSceneRef/, "the nudge must be a one-shot per scene");
  assert.match(src, /setExpanded\(true\)/, "a key arrival must open the journal so the tap-through is immediate");

  // The canonical copy lives in the shared lib and names the reader-seen door.
  const lib = read("lib/storyEngagement.ts");
  assert.match(lib, /export function keyArrivalToast\(/, "keyArrivalToast must be the shared source of the nudge copy");
  assert.match(lib, /A key has turned up — \$\{label\}\. See the tome above\./, "the nudge must name the door and point at the journal pill");
});

test("gameApi calls the full-path convex query and pins the spoiler-safe wire shape", () => {
  const src = read("lib/gameApi.ts");
  assert.match(
    src,
    /"llm\/storyBible:getDoorsJournal"/,
    "the fetcher must use the directory-qualified convex path",
  );
  // The wire type is exactly {label, hint, state} — anything more would mean
  // the server projection widened past the BC10 seen-only contract.
  const typeStart = src.indexOf("export type RemoteDoorsJournalEntry = {");
  assert.ok(typeStart > -1, "RemoteDoorsJournalEntry must exist");
  const typeBody = src.slice(typeStart, src.indexOf("};", typeStart));
  const fields = [...typeBody.matchAll(/^\s{2}(\w+)[?]?:/gm)].map((m) => m[1]);
  assert.deepEqual(
    fields.sort(),
    ["hint", "label", "state"],
    "the doors-journal wire shape must stay label/hint/state only (BC10)",
  );
});

test("ReaderScreen mounts DoorsJournal adjacent to ThreadsPill", () => {
  const src = read("components/reading/ReaderScreen.tsx");
  assert.match(src, /import \{ DoorsJournal \}/, "ReaderScreen must import DoorsJournal");
  assert.match(src, /<DoorsJournal/, "ReaderScreen must render DoorsJournal");
  assert.match(
    src,
    /<DoorsJournal[\s\S]{0,200}sceneId=\{projection\.scene\.id\}/,
    "DoorsJournal must be keyed to the scene identity for refetch + one-shot nudges",
  );
});
