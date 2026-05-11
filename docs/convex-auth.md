# Convex BetterAuth Setup

Convex owns the BetterAuth runtime. The Expo app should use local auth by default and switch
to Convex-backed BetterAuth only after a Convex deployment has been initialized.

## Current Status

- Local development auth exists and is covered by Playwright.
- Convex auth config and BetterAuth component registration exist.
- `convex/betterAuth/auth.ts` now creates the BetterAuth runtime with email/password auth, the Convex adapter, and the Convex JWT plugin.
- `convex/http.ts` registers `/api/auth/*` BetterAuth HTTP routes before the LLM and Stripe routes.
- The Expo app keeps local auth as the default and switches to BetterAuth only when `EXPO_PUBLIC_AUTH_MODE=better-auth`, `EXPO_PUBLIC_CONVEX_URL`, and `EXPO_PUBLIC_CONVEX_SITE_URL` are all set.
- The Expo bundle uses a small app-local BetterAuth HTTP client instead of importing BetterAuth browser subpaths, because Metro does not resolve those package export subpaths in this workspace.
- Production/session-backed auth is still tracked as `LR-1` in `.spec-workflow/specs/core-read-loop/tasks.md` until HTTPS tunnel smoke testing passes with real Convex env.

Do not mark launch auth complete until a clean browser can create/sign in/sign out through Convex-backed BetterAuth over HTTPS and Convex functions can authorize from `ctx.auth`.

## Local Bootstrap

```sh
pnpm --filter @cyoa/convex exec convex dev
```

Keep that process running once it creates `CONVEX_DEPLOYMENT` and prints the deployment URLs.
Copy the cloud URL into:

```sh
EXPO_PUBLIC_CONVEX_URL=https://<deployment>.convex.cloud
EXPO_PUBLIC_CONVEX_SITE_URL=https://<deployment>.convex.site
EXPO_PUBLIC_AUTH_MODE=better-auth
```

Set auth runtime env on the Convex deployment:

Store `SITE_URL`, `BETTER_AUTH_SECRET`, and `JWKS` in Vault, then sync them:

```sh
pnpm secrets:vault:check
pnpm secrets:vault:sync-convex -- --deployment dev
```

For tunnel testing, set `SITE_URL` to the Cloudflare HTTPS origin instead of localhost.

## Already Added

- `convex/auth.config.ts` registers BetterAuth as Convex's custom JWT auth provider.
- `convex/convex.config.ts` registers the BetterAuth Convex component.
- `convex/betterAuth/auth.ts` exports `authComponent`, `createAuth`, and `getAuthUser`.
- `convex/http.ts` registers BetterAuth routes under `/api/auth/*`.
- `apps/app/lib/authConfig.ts` centralizes app, Convex, and auth base URLs.
- `apps/app/lib/authClient.ts` wraps the BetterAuth HTTP endpoints used by the app.
- `apps/app/components/auth/BetterAuthConvexProvider.tsx` feeds Convex auth tokens from `/api/auth/convex/token` into `ConvexProviderWithAuth`.

## Remaining `LR-1` Work

After `convex dev` has initialized `CONVEX_DEPLOYMENT`, run:

```sh
pnpm --filter @cyoa/convex codegen
```

Then verify the generated component API still includes `components.betterAuth`. Do not hand-write Convex generated files.

Remaining implementation/verification items:

- Run a clean-browser HTTPS tunnel smoke test for sign-up, sign-in, reload session restore, and sign-out.
- Verify guest claim migrates the active guest `accounts` row to the BetterAuth `user.id` without losing saves.
- Continue applying the guest-token proof model to any new account-owned functions; current profile, library, save, turn, creator, export/delete, and LLM stream authorization paths require either matching BetterAuth identity or guest token proof.
- Decide whether to keep the app-local BetterAuth HTTP client or add Metro resolver support for BetterAuth package export subpaths before native app work.

## Verification Checklist

- `EXPO_PUBLIC_AUTH_MODE=better-auth` set for the app environment.
- `EXPO_PUBLIC_CONVEX_URL` points at the Convex cloud URL.
- `EXPO_PUBLIC_CONVEX_SITE_URL` points at the Convex site URL.
- `SITE_URL` matches the exact HTTPS app origin, including Cloudflare tunnel origin during tunnel testing.
- `BETTER_AUTH_SECRET` and `JWKS` are synced from Vault, not local `.env`.
- Guest account can be claimed into an authenticated account without losing saves.
- Reload restores the same authenticated profile.
- Sign-out clears app navigation and account state across mounted components.
- Convex functions reject account-owned operations without a matching authenticated identity.

## Latest Local Verification

Recorded on 2026-04-30:

- `docker compose run --rm app pnpm typecheck` passed.
- `docker compose run --rm app pnpm test` passed, including 90 Convex unit tests.
- `docker compose run --rm app pnpm test:e2e` passed, 17 Playwright tests.
