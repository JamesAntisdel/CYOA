# LR-2 Implementation Log: Guest Proof and LLM Stream Authorization

**Date:** 2026-04-30T06:58Z

**Summary:** Replaced account-id-only guest authorization with guest-token proof and removed the temporary `LLM_STREAM_SECRET` spend-control model. The direct LLM stream HTTP route now authorizes account/save access through Convex before invoking provider streaming.

## Files Changed

- `convex/lib/authz.ts`
  - `assertAccountSessionAccess(ctx, account, guestTokenHash?)` now distinguishes user and guest accounts.
  - User accounts require `ctx.auth.getUserIdentity().subject === accounts.userId`.
  - Guest accounts require the provided guest token proof to match `accounts.guestTokenHash`.

- `convex/game.ts`
  - Added optional `guestTokenHash` args to guest-owned library/save/scene/turn functions.
  - Added `authorizeSceneStream({ accountId, saveId, guestTokenHash? })` query for HTTP stream authorization.

- `convex/accountFunctions.ts`
  - Added optional guest token proof to profile, claim, export, delete, and mature-content mutations/queries.

- `convex/creatorFunctions.ts`
  - Added optional guest token proof to creator draft/list/publish/archive functions.

- `convex/http.ts`
  - Replaced `LLM_STREAM_SECRET` header authorization with account/save authorization.
  - `/llm/scene-stream` now parses `accountId`, `saveId`, and optional `guestTokenHash`, runs `game:authorizeSceneStream`, and returns `llm_stream_forbidden` before provider work when unauthorized.

- `apps/app/hooks/useGuestSession.ts`
  - Exports `guestAuthArgs()` for callers to include guest token proof.
  - Clears the guest token when the guest session is cleared.

- `apps/app/lib/gameApi.ts`, `apps/app/hooks/useLibrary.ts`, `apps/app/hooks/useTurn.ts`, `apps/app/hooks/useAccountProfile.ts`, `apps/app/app/creator/index.tsx`
  - Threaded optional guest token proof into remote account-owned calls.

- `packages/shared/src/env/index.ts`, `packages/shared/tests/contracts.test.ts`, `.env.example`, `docs/local-docker.md`, `docs/vault.md`, `scripts/secrets/vault-lib.mjs`
  - Removed `LLM_STREAM_SECRET` from env contracts, examples, Vault docs, and allowlists.

- `.spec-workflow/specs/core-read-loop/requirements.md`
  - Added explicit guest-token proof and direct stream authorization requirements.

- `.spec-workflow/specs/core-read-loop/design.md`
  - Updated account/auth interfaces and authorization model.

- `.spec-workflow/specs/core-read-loop/tasks.md`
  - Updated LR-1 and LR-2 progress notes.

## Verification

- `docker compose run --rm app pnpm typecheck` passed.
- `docker compose run --rm app pnpm test` passed: 91 Convex tests.
- `docker compose run --rm app pnpm test:e2e` passed: 17 Playwright tests.

## Remaining Risk

- LR-2 remains unchecked until a live Convex HTTP smoke test verifies unauthorized direct calls fail and authorized calls stream tokens in the configured deployment.
- The guest token is still stored in browser local storage for local/web guest mode. Native app work must move equivalent tokens to secure storage.
- Any future account-owned functions must use the same user identity or guest proof model; account-id-only args should be treated as insufficient.
