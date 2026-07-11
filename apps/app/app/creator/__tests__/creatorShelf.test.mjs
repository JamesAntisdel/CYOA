// Drift-guards for the creator iteration loop (drafts shelf + update-in-place
// saves + field-mapped validation errors) in app/creator/index.tsx.
//
// These are source-level greps (same pattern as
// components/reading/__tests__/storyEngagementClient.test.mjs) because
// mounting the RN + Convex tree is out of scope for `node --test`. The pure
// server logic (updateAuthoredSeedDraft / validateCreatorSeedSubmission /
// per-field policy evaluation) has behavioral coverage in the vitest suites
// convex/tests/creator.test.ts and convex/tests/creatorFunctions.test.ts;
// here we pin the client wiring that connects it to the creator form.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, "../index.tsx"), "utf8");

test("saveDraft updates the current remote draft instead of inserting a new row per save", () => {
  assert.match(
    src,
    /creatorFunctions:updateDraft/,
    "the route must call the updateDraft mutation",
  );
  assert.match(
    src,
    /seedId && !seedId\.startsWith\("local_"\) && seedStatus === "draft" \? seedId : null/,
    "only a non-local draft-status seed is updatable in place",
  );
  // Update failure (or no updatable draft) must still fall through to create.
  assert.match(src, /if \(!remote\) \{\s*remote = await createRemoteCreatorDraft\(/, "create remains the fallback");
  // The local_ device-draft fallback must survive (offline / no Convex).
  assert.match(src, /const localId = `local_\$\{story\.id\}`;/, "local_ draft fallback must be preserved");
  assert.match(src, /Draft saved on this device\./, "local fallback status copy must be preserved");
});

test("saves are pre-flighted through the structured validateSeed query and mapped onto form fields", () => {
  assert.match(src, /creatorFunctions:validateSeed/, "the route must call the validateSeed query");
  assert.match(
    src,
    /await validateBeforeSave\(guest\.session\.accountId\)/,
    "both saveDraft and publishSeed must pre-flight validation",
  );
  assert.match(
    src,
    /setFieldIssues\(groupIssuesByField\(validation\.issues\)\)/,
    "structured issues must be grouped per form field",
  );
  // Path → field mapping covers every editable input of the simple form.
  assert.match(src, /path === "nodes\.start\.seed"\) return "opening";/, "opening field mapping");
  assert.match(src, /nodes\.start\.choices\.careful\./, "careful-choice field mapping");
  assert.match(src, /nodes\.start\.choices\.bold\./, "bold-choice field mapping");
  assert.match(src, /return "general";/, "unmapped paths fall into the general bucket");
});

test("field issues render adjacent to the inputs they belong to", () => {
  for (const field of ["title", "opening", "carefulChoice", "boldChoice", "general"]) {
    assert.match(
      src,
      new RegExp(`<FieldIssues issues=\\{fieldIssues\\.${field}\\} />`),
      `fieldIssues.${field} must render through FieldIssues`,
    );
  }
  // Each FieldIssues block sits directly under its TextInput.
  for (const label of ["Seed title", "Opening seed", "Careful choice", "Bold choice"]) {
    const inputAt = src.indexOf(`accessibilityLabel="${label}"`);
    assert.ok(inputAt > -1, `input ${label} must exist`);
    const issuesAt = src.indexOf("<FieldIssues", inputAt);
    assert.ok(
      issuesAt > -1 && issuesAt - inputAt < 900,
      `a FieldIssues block must follow the "${label}" input`,
    );
  }
  // Inputs with issues get the danger border.
  assert.match(src, /tokens\.colors\.danger : tokens\.colors\.borderMuted/, "issue inputs use the danger border");
  assert.match(src, /accessibilityRole="alert"/, "issue lists announce as alerts");
});

test("the drafts shelf consumes listMine merged with device-local drafts", () => {
  assert.match(src, /creatorFunctions:listMine/, "the shelf must consume creatorFunctions:listMine");
  assert.match(src, /listLocalCreatorSeeds\(\)/, "local_ drafts must feed the shelf");
  assert.match(src, /seed\.seedId\.startsWith\("local_"\)/, "only device-only rows come from local storage");
  assert.match(src, /mergeDraftShelf\(remote, local\)/, "remote + local rows merge through mergeDraftShelf");
  // Remote rows win over local mirrors; archived seeds drop off; newest first.
  assert.match(src, /!seen\.has\(item\.seedId\)/, "mergeDraftShelf must dedupe by seedId");
  assert.match(src, /item\.status !== "archived"/, "archived seeds must not shelve");
  assert.match(src, /right\.updatedAt - left\.updatedAt/, "shelf sorts newest first");
});

test("shelf rows load into the form and archive through creatorFunctions:archive", () => {
  assert.match(src, /creatorFunctions:archive/, "the shelf must call the archive mutation");
  assert.match(src, /onPress=\{\(\) => loadShelfSeed\(item\)\}/, "each row needs a Load action");
  assert.match(src, /onPress=\{\(\) => archiveShelfSeed\(item\)\}/, "remote rows need an Archive action");
  assert.match(
    src,
    /item\.source === "remote" \? \(/,
    "archive only offers on remote rows (local rows have no server doc)",
  );
  // Load restores all four form fields from the stored story.
  assert.match(src, /const values = formValuesFromStory\(item\.story\);/, "load must decode the story");
  assert.match(src, /start\?\.choices\[0\]\?\.label \?\? ""/, "careful choice restores from the story");
  assert.match(src, /start\?\.choices\[1\]\?\.label \?\? ""/, "bold choice restores from the story");
  assert.match(src, /setSeedStatus\(item\.status\)/, "load must track the seed's lifecycle status");
});

test("publish syncs the on-screen form into the draft before publishing", () => {
  const publishAt = src.indexOf("const publishSeed = async");
  assert.ok(publishAt > -1, "publishSeed must exist");
  const publishBody = src.slice(publishAt, src.indexOf("const loadShelfSeed"));
  const updateAt = publishBody.indexOf("updateRemoteCreatorDraft");
  const publishCallAt = publishBody.lastIndexOf("publishRemoteCreatorSeed");
  assert.ok(
    updateAt > -1 && publishCallAt > updateAt,
    "publishSeed must update the draft with the current form before publishRemoteCreatorSeed",
  );
});
