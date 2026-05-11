# LR-6 Implementation Log: Seed Command and Creator Seed Launch

**Date:** 2026-04-30
**Status:** Locally implemented and unit/type verified; LR-6 remains open pending a clean Convex dev deployment smoke.

## Summary

Replaced the local seed placeholder with an explicit Convex seed-validation boundary and closed the product gap where account-backed creator seeds could publish into Convex but not reliably appear in the playable library.

## Files Changed

- `convex/seeds.ts`
  - Added `seeds:loadStarterStories`.
  - Validates every package-owned starter story with `validateStory`.
  - Returns catalog mode, story ids, versions, node counts, and ending counts without direct starter table writes.
- `scripts/dev/seed-local.mjs`
  - Replaced placeholder logging with `pnpm exec convex run seeds:loadStarterStories`.
- `convex/liveCore.ts`
  - Added `authoredSeedStoryId`, `parseAuthoredSeedStoryId`, and `buildCreatorSeedLibraryItems`.
  - Added a launchable account-library projection for published creator seeds.
- `convex/creatorFunctions.ts`
  - Added `listPublishedMine`, guarded by account/session authorization.
- `convex/game.ts`
  - Added server-side resolution for `authored_seed:<seedId>` story ids.
  - `createSave`, `getCurrentScene`, and `submitChoice` can now operate on published account seed stories.
  - Library title projection now knows owned published seed titles.
- `apps/app/lib/gameApi.ts`
  - Added `RemoteCreatorSeedItem` and `listRemotePublishedCreatorSeeds`.
- `apps/app/hooks/useLibrary.ts`
  - Allows account-backed seed launches with a title override while preserving starter validation for package stories.
- `apps/app/app/library/index.tsx`
  - Lists Convex-published creator seeds under "Created by you".
  - Launching an account-backed seed creates and opens a normal remote save.
- `docs/local-docker.md`
  - Documented the real seed command and creator seed launch model.
- `.spec-workflow/specs/core-read-loop/requirements.md`
  - Added Requirement 22 acceptance coverage for cross-reload/device account-backed seed surfacing.
- `.spec-workflow/specs/core-read-loop/design.md`
  - Documented `authored_seed:<seedId>` launch resolution and starter catalog validation.
- `.spec-workflow/specs/core-read-loop/tasks.md`
  - Added LR-6 progress details and kept the item unchecked pending clean deployment smoke.

## Verification

- `docker compose run --rm app pnpm typecheck` passed.
- `docker compose run --rm app pnpm test` passed.
  - Convex suite is now 92 tests.

## Remaining Risk

- `scripts/dev/seed-local.mjs` still needs to be run against a clean configured Convex dev deployment before LR-6 can be checked off.
- Starter stories intentionally remain package-owned rather than duplicated into Convex tables. This keeps versioning simple but means changing starter data still requires a code deploy.
