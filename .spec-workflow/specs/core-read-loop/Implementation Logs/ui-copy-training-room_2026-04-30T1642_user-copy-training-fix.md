# UI Copy and Training Room Fix Log

**Date:** 2026-04-30
**Status:** Implemented and locally verified.

## Summary

Removed backend/provider implementation language from player-facing UI and fixed the Training Room reader fallback that could put real story saves into the old demo "continue carefully" loop.

## Files Changed

- `apps/app/app/settings/index.tsx`
  - Replaced runtime/provider status copy with reader-focused settings copy.
- `apps/app/app/login/index.tsx`
  - Replaced environment/auth-adapter copy with user-facing account value copy.
- `apps/app/lib/billingConfig.ts`
  - Replaced implementation-specific checkout unavailable messages with product-safe copy.
- `apps/app/app/creator/index.tsx`
  - Removed "Convex" and configuration language from creator save/publish status.
  - Replaced guest-profile language with session/user-flow language.
- `apps/app/app/account/index.tsx`
  - Removed "Delete local guest profile" from guest account actions.
  - Kept export/delete controls only for signed-in accounts where the destructive action makes product sense.
- `apps/app/app/library/index.tsx`
  - Replaced "local shelf" with "saved draft" and "Read seed" with "Read story".
- `apps/app/hooks/useTurn.ts`
  - Normal reader saves now resolve to the real Training Room story graph instead of falling into the legacy demo projection.
  - Preserved explicit special demo routes for safety and Pro media tests.
- `tests/e2e/critical-journeys.spec.ts`
  - Updated assertions for user-facing creator, checkout, and removed guest-delete flow.

## Verification

- `docker compose run --rm app pnpm typecheck` passed.
- `docker compose run --rm app pnpm test` passed.
- `docker compose run --rm app pnpm test:e2e` passed with 16 Playwright tests.

## Notes

- The app still contains implementation names in source identifiers and developer/admin internals. The user-facing app routes no longer describe Convex, provider clients, or local development setup.
- Live LLM verification remains tracked by `LR-3` and requires Vault-backed credentials synced to a configured Convex deployment.
