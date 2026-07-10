# Implementation Log: Verification and Live Smoke Tooling

**Date:** 2026-04-30 23:44 PT
**Scope:** LR-9 verification bundle progress.

## Summary

Added a repeatable live-readiness smoke command for the HTTPS tunnel / Convex site phase and reran local verification after the streaming and native receipt changes.

## Files Changed

- `scripts/smoke/live-readiness.mjs`
  - Checks app HTML availability.
  - Checks `/llm/scene-stream` rejects direct unauthenticated/bogus calls with `llm_stream_forbidden`.
  - Checks BetterAuth session route is mounted.
  - Checks Stripe webhook route is mounted and rejects bad signatures rather than 404ing.
- `package.json`
  - Added `pnpm smoke:live-readiness`.
- `docs/vault.md`
  - Documented the smoke command.
- `cloudflare/README.md`
  - Documented the tunnel smoke command after Cloudflare routing is configured.

## Verification

Commands run in Docker:

- `docker compose run --rm app pnpm typecheck` - passed.
- `docker compose run --rm app pnpm test` - passed.
- `docker compose run --rm app pnpm test:e2e` - passed, 16 Playwright tests.
- `docker compose run --rm app pnpm secrets:local:check` - passed, no sensitive credentials found in local env files.
- `docker compose run --rm app pnpm audit --audit-level moderate` - passed, no known vulnerabilities found.
- `docker compose run --rm app pnpm build:web` - passed, Expo web export wrote `dist`.

## Residual Risk

`pnpm smoke:live-readiness` still needs to be run against the Cloudflare HTTPS app URL and the configured Convex site URL. It intentionally does not spend provider tokens; live provider, Stripe Checkout, BetterAuth account flows, seed import, deployment, and native sandbox receipt checks remain separate LR items until they are run with Vault-backed real credentials.
