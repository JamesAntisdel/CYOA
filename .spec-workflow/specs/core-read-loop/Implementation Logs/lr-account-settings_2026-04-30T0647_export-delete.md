# Account Settings Implementation Log: Export and Delete

**Date:** 2026-04-30T06:47Z

**Summary:** Added the next account-settings requirement slice for Requirement 16. Account data export and deletion are now represented in Convex functions and exposed from the account page, while reader preferences remain on the settings route.

## Files Changed

- `convex/account.ts`
  - Added `AccountDeletionSummary`.
  - Added `createAccountDeletionSummary(accountId)` with explicit counters.

- `convex/accountFunctions.ts`
  - Added `exportAccount` query.
  - Added `deleteAccount` mutation requiring `confirm: "DELETE"`.
  - Export includes redacted account data, entitlements without Stripe IDs, usage meters, saves, turn history, endings, authored seeds, published tale ownership metadata, redacted analytics fields, asset metadata, and daily counters.
  - Deletion removes private account-owned records, archives authored seeds, revokes published tales, closes hosted co-op rooms, and deletes the account row.
  - Existing user account ownership guard remains enforced through `ctx.auth`.

- `apps/app/lib/gameApi.ts`
  - Added `exportRemoteAccount`.
  - Added `deleteRemoteAccount`.

- `apps/app/hooks/useAccountProfile.ts`
  - Added `exportAccountData`.
  - Added `deleteAccountData`.
  - Provides a local fallback export when remote Convex account export is unavailable.

- `apps/app/app/account/index.tsx`
  - Added “Privacy and data” section.
  - Added JSON export button.
  - Added typed `DELETE` confirmation flow for account deletion.

- `convex/tests/account.test.ts`
  - Added direct coverage for deletion summary shape.

## Verification

- `docker compose run --rm app pnpm typecheck` passed.
- `docker compose run --rm app pnpm test` passed before the focused test addition.
- `docker compose run --rm app pnpm test:e2e` passed, 17 Playwright tests.
- `docker compose run --rm app pnpm --filter @cyoa/convex test -- tests/account.test.ts` passed, 8 account tests.

## Remaining Risk

- Convex export/delete functions need live Convex smoke once the tunnel and deployment env are configured.
- Guest-token proof is still needed for guest-owned account operations; user-owned account rows are guarded by BetterAuth identity.
- Deletion currently revokes public-facing published tales rather than preserving readable public pages. This matches privacy-first deletion, but product policy should confirm the final retention behavior.
