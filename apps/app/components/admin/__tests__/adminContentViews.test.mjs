// Drift-guards for the admin content browser (product.md operator intent,
// Req 27). Same source-grep pattern as app/creator/__tests__/*.mjs: mounting
// the RN + Convex tree is out of scope for `node --test`. The behavioral
// pieces have vitest coverage (convex/tests/adminContent.test.ts,
// convex/tests/adminGrant.test.ts, apps/app/lib/__tests__/adminApi.test.ts);
// here we pin the client wiring so the views + routes can't silently drift.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(resolve(here, rel), "utf8");

const screenSrc = read("../AdminDashboardScreen.tsx");
const storiesSrc = read("../boards/Stories.tsx");
const usersSrc = read("../boards/Users.tsx");
const storiesRouteSrc = read("../../../app/admin/stories/index.tsx");
const usersRouteSrc = read("../../../app/admin/users/index.tsx");

test("the dashboard screen switches to the stories and users boards", () => {
  assert.match(screenSrc, /view === "stories" \? <StoriesBoard \/>/);
  assert.match(screenSrc, /view === "users" \? <UsersBoard \/>/);
  assert.match(
    screenSrc,
    /import \{[^}]*StoriesBoard[^}]*UsersBoard[^}]*\} from "\.\/boards"/,
    "boards must be imported from the shared boards barrel",
  );
});

test("the view union and titles include stories + users", () => {
  assert.match(screenSrc, /"stories"/);
  assert.match(screenSrc, /"users"/);
  assert.match(screenSrc, /Stories · content across accounts/);
  assert.match(screenSrc, /Users · accounts & admin/);
});

test("the admin nav deep-links every surface incl. stories + users", () => {
  assert.match(screenSrc, /href: "\/admin\/stories"/);
  assert.match(screenSrc, /href: "\/admin\/users"/);
  assert.match(screenSrc, /function AdminNav/);
});

test("the stories/users routes render the screen with the right view", () => {
  assert.match(storiesRouteSrc, /view="stories"/);
  assert.match(storiesRouteSrc, /useAdminAnalytics/);
  assert.match(usersRouteSrc, /view="users"/);
  assert.match(usersRouteSrc, /useAdminAnalytics/);
});

test("the stories board lists stories + recent saves and drills into save detail", () => {
  assert.match(storiesSrc, /useAdminStories/);
  assert.match(storiesSrc, /useAdminSaves/);
  assert.match(storiesSrc, /useAdminSaveDetail/);
  // The non-spoiler bible summary is surfaced (BC10 — no raw bible payload).
  assert.match(storiesSrc, /detail\.bible \? detail\.bible\.status : "none"/);
  assert.match(storiesSrc, /Endings reached/);
});

test("the users board grants admin, lists users, and toggles admin inline", () => {
  assert.match(usersSrc, /grantAdminByEmail/);
  assert.match(usersSrc, /useAdminUsers/);
  assert.match(usersSrc, /useAdminUserDetail/);
  assert.match(usersSrc, /promote\(user\.accountId, next\)/);
  // Only signed-up users can hold an admin claim.
  assert.match(usersSrc, /Only signed-up users can be admins\./);
});

test("every content panel renders loading / unavailable / empty states", () => {
  // The shared StateGate distinguishes the three states.
  assert.match(storiesSrc, /export function StateGate/);
  assert.match(storiesSrc, /status === "loading"/);
  assert.match(storiesSrc, /status === "unavailable"/);
  assert.match(storiesSrc, /emptyLabel/);
  assert.match(usersSrc, /StateGate/);
});
