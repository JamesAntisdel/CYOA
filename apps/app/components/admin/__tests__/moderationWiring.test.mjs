// Drift-guards for the launch-blocker moderation + legal surface (product-
// readiness review: Apple 1.2 / Play UGC + GenAI). Same source-grep pattern as
// adminContentViews.test.mjs — mounting the RN + Convex tree is out of scope for
// `node --test`. Behavioral coverage lives in convex/tests/moderation.test.ts
// and apps/app/lib/__tests__/moderationApi.test.ts (vitest); here we pin the
// client wiring so the report/flag affordances, the admin queue, and the legal
// kit can't silently drift out of the build.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(resolve(here, rel), "utf8");

const screenSrc = read("../AdminDashboardScreen.tsx");
const boardsIndexSrc = read("../boards/index.ts");
const moderationBoardSrc = read("../boards/Moderation.tsx");
const moderationRouteSrc = read("../../../app/admin/moderation/index.tsx");
const moderationApiSrc = read("../../../lib/moderationApi.ts");
const reportButtonSrc = read("../../moderation/ReportButton.tsx");
const discoverCardSrc = read("../../discovery/DiscoverCard.tsx");
const taleRouteSrc = read("../../../app/tale/[taleId]/index.tsx");
const readerSrc = read("../../reading/ReaderScreen.tsx");
const ageGateSrc = read("../../account/AgeGate.tsx");
const publishRouteSrc = read("../../../app/publish/[saveId]/index.tsx");

test("the admin dashboard mounts the moderation board + nav + route", () => {
  assert.match(screenSrc, /view === "moderation" \? <ModerationBoard \/>/);
  assert.match(screenSrc, /ModerationBoard/);
  assert.match(screenSrc, /view: "moderation", label: "Moderation", href: "\/admin\/moderation"/);
  assert.match(boardsIndexSrc, /export \{ ModerationBoard \} from "\.\/Moderation"/);
  assert.match(moderationRouteSrc, /view="moderation"/);
});

test("the moderation board is admin-gated via the queue hook and offers takedown", () => {
  assert.match(moderationBoardSrc, /useModerationQueue/);
  // dismiss / resolve / hide actions are all present.
  assert.match(moderationBoardSrc, /status: "resolved"/);
  assert.match(moderationBoardSrc, /status: "dismissed"/);
  assert.match(moderationBoardSrc, /hideContent/);
});

test("the moderation client pins the registered paths", () => {
  assert.match(moderationApiSrc, /reportContent: "moderation:reportContent"/);
  assert.match(moderationApiSrc, /listReports: "moderation:listReports"/);
  assert.match(moderationApiSrc, /resolveReport: "moderation:resolveReport"/);
});

test("the report affordance is wired onto tale + community-shelf card + reader", () => {
  // ReportButton submits via the moderation client.
  assert.match(reportButtonSrc, /reportContent\(/);
  // Community shelf card.
  assert.match(discoverCardSrc, /<ReportButton/);
  assert.match(discoverCardSrc, /targetType="tale"/);
  // Published-tale read-along.
  assert.match(taleRouteSrc, /<ReportButton/);
  assert.match(taleRouteSrc, /targetType="tale"/);
  // AI-generated reader scene flag. reader-chrome-declutter Wave 1 moved the
  // per-scene flag OUT of the ReaderSaveActions pill row and into the Tome
  // menu's "Flag this scene" row (U3/R2.5): it now drives the controlled
  // (trigger-hidden) ReportButton with targetType="scene". The persistent
  // AI-generated disclosure stays a visible footer caption.
  assert.match(readerSrc, /<ReportButton/);
  assert.match(readerSrc, /targetType="scene"/);
  assert.match(readerSrc, /AI-generated tale/);
});

test("the age gate + publish flow surface the legal links", () => {
  assert.match(ageGateSrc, /<LegalFooter/);
  assert.match(ageGateSrc, /href: "\/terms"/);
  assert.match(ageGateSrc, /href: "\/privacy"/);
  assert.match(ageGateSrc, /href: "\/content-policy"/);
  assert.match(publishRouteSrc, /<LegalFooter/);
  assert.match(publishRouteSrc, /href: "\/content-policy"/);
});

test("the three legal routes exist with real section copy", () => {
  const terms = read("../../../app/terms/index.tsx");
  const privacy = read("../../../app/privacy/index.tsx");
  const contentPolicy = read("../../../app/content-policy/index.tsx");
  assert.match(terms, /Terms of Service/);
  assert.match(terms, /AI-generated content/);
  assert.match(privacy, /Privacy Policy/);
  assert.match(privacy, /Retention and deletion/);
  assert.match(contentPolicy, /Content Policy/);
  // The store-critical bright line must be present.
  assert.match(contentPolicy, /minors/);
  assert.match(contentPolicy, /Report affordance/);
});
