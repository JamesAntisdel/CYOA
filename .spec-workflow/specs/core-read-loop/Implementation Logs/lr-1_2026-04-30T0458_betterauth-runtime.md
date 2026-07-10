# LR-1 Implementation Log: Convex BetterAuth Runtime

**Date:** 2026-04-30T04:58Z

**Summary:** Added the first real Convex-backed BetterAuth runtime path while keeping local auth as the default development mode. Registered BetterAuth HTTP routes, added an Expo-compatible auth client, connected Convex token fetching, and introduced server-side user account ownership checks backed by `ctx.auth`.

## Files Changed

- `convex/betterAuth/auth.ts`
  - Added `authComponent = createClient<DataModel>(components.betterAuth)`.
  - Added `createAuth(ctx)` using BetterAuth email/password auth, the Convex adapter, and the Convex JWT plugin.
  - Added `getAuthUser` export from the BetterAuth component client API.
  - Uses `CONVEX_SITE_URL`/`EXPO_PUBLIC_CONVEX_SITE_URL` for the BetterAuth base URL and `JWKS` only when present.

- `convex/http.ts`
  - Registers BetterAuth routes under `/api/auth/*`.
  - Keeps existing `/llm/scene-stream` and `/stripe/webhook` routes.
  - Adds CORS origins from app and Convex site URL env where present.

- `apps/app/lib/authClient.ts`
  - Replaced package-client imports with an app-local HTTP wrapper for `/api/auth/sign-up/email`, `/api/auth/sign-in/email`, `/api/auth/sign-out`, `/api/auth/get-session`, and `/api/auth/convex/token`.
  - Reason: Expo/Metro in this workspace does not resolve BetterAuth and `@convex-dev/better-auth` package export subpaths during web export.
  - Added a small subscription hook so mounted app auth state and Convex token state refresh after sign-in/sign-out.

- `apps/app/components/auth/BetterAuthConvexProvider.tsx`
  - Added a local `ConvexProviderWithAuth` wrapper.
  - Fetches Convex JWTs from `/api/auth/convex/token`.
  - Clears cached tokens when the BetterAuth session disappears.

- `apps/app/hooks/useAuthSession.ts`
  - Keeps local auth when BetterAuth is not fully configured.
  - Uses the app-local BetterAuth client when `EXPO_PUBLIC_AUTH_MODE=better-auth` and Convex URLs are set.
  - Normalizes BetterAuth session data into the existing `AuthSession` shape.

- `apps/app/app/_layout.tsx`
  - Switches from plain `ConvexProvider` to `BetterAuthConvexProvider` only in configured BetterAuth mode.

- `apps/app/app/login/index.tsx`
  - Awaits async sign-in/sign-up.
  - Shows environment-specific auth copy.

- `convex/lib/authz.ts`
  - Added `assertAccountSessionAccess(ctx, account)`.
  - Allows guest accounts for now.
  - Requires BetterAuth `identity.subject` to match `accounts.userId` for user accounts.

- `convex/accountFunctions.ts`, `convex/game.ts`, `convex/creatorFunctions.ts`
  - Added user-account session checks to profile, claim, mature-content, library, save, turn, and creator draft/publish/archive flows.

- `convex/tests/lib.test.ts`
  - Added tests for guest access, matching user identity, and mismatched user denial.

- `docs/convex-auth.md`
  - Updated current status, remaining LR-1 work, Metro client note, and verification status.

- `.spec-workflow/specs/core-read-loop/tasks.md`
  - Added LR-1 progress note while leaving the task unchecked until HTTPS tunnel smoke passes.

## Verification

- `docker compose run --rm app pnpm typecheck` passed.
- `docker compose run --rm app pnpm test` passed.
- `docker compose run --rm app pnpm test:e2e` passed, 17 Playwright tests.

## Remaining Risk

- LR-1 remains open because real HTTPS tunnel sign-up/sign-in/sign-out/reload/guest-claim has not been run against a configured Convex deployment.
- Guest flows still rely on account id access for several operations; user-owned account rows now require matching BetterAuth identity, but guest-token proof is still required.
- The app-local BetterAuth HTTP client is intentional for Metro compatibility. Before native release, either keep it and harden response handling or add resolver support for BetterAuth package export subpaths.
