# CYOA

CYOA is a server-authoritative AI choose-your-own-adventure app. The approved V1 specification lives in `.spec-workflow/specs/core-read-loop`.

The implementation task tracker is `.spec-workflow/specs/core-read-loop/tasks.md`. Tasks 1-25 describe the local/mock-verified V1 scaffold. The separate **Launch Readiness Tracker** in that file is the source of truth for remaining P0 work before real credentials, paid provider traffic, native store submission, or production deployment.

## Workspace

- `apps/app`: Expo Router app for web, iOS, and Android.
- `convex`: Convex backend functions and schema.
- `packages/engine`: Pure TypeScript game engine.
- `packages/stories`: Starter adventure data.
- `packages/shared`: Cross-layer Zod contracts and shared types.
- `infra`: Pulumi infrastructure.

## Scripts

If `pnpm` is not installed globally, use Corepack:

```sh
COREPACK_HOME="$PWD/.corepack" corepack pnpm --version
```

- `pnpm dev`: run the app and Convex dev targets.
- `pnpm lint`: lint all workspaces that define lint scripts.
- `pnpm typecheck`: typecheck all workspaces.
- `pnpm test`: run all workspace tests.
- `pnpm build`: build/check all workspaces.
- `pnpm verify`: run lint, typecheck, tests, and builds in sequence.
- `pnpm test:e2e`: run the Playwright critical-journey suite.
- `pnpm secrets:vault:check`: validate required real credentials in Vault.
- `pnpm secrets:vault:sync-convex`: sync Vault-backed runtime credentials to Convex.

This workspace was developed with:

```sh
COREPACK_HOME="$PWD/.corepack" pnpm install
COREPACK_HOME="$PWD/.corepack" pnpm typecheck
COREPACK_HOME="$PWD/.corepack" pnpm test
```

## Local Docker

Production-like local Docker setup is documented in [docs/local-docker.md](docs/local-docker.md). Start with:

```sh
cp .env.example .env
docker compose up --build app provider-mocks
```

The local environment mirrors contracts, provider failures, seeded data, and webhook flow. It does not run managed Convex production, Stripe live billing, live Vertex/Anthropic/DeepSeek calls, StoreKit/Play Billing, EAS submit, or real push delivery.

## Secrets

Real credentials live in HashiCorp Vault and are synced into deployment secret stores. Do not put live Stripe, auth, model-provider, EAS, App Store, or Play Console credentials in `.env`.

See [docs/vault.md](docs/vault.md) for the required Vault shape and sync commands.

## Safety And Age Policy

- Users must select an age range before guest session creation.
- Under-13 users are blocked before session/save creation.
- The app stores age band only, not date of birth.
- Self-harm, suicide, depressive hopelessness, and player-directed despair are blocked for everyone.
- Adult-only language, subject matter, and imagery require an authenticated paid 18+ account with explicit opt-in.
- Opting into mature content never unlocks globally blocked safety categories.

## Billing

Stripe is the primary billing path. Billing utilities model checkout metadata, subscription webhook application, plan previews, native receipt normalization, credits, daily limits, and explicit overage opt-in with monthly spend caps. Client paywall surfaces only preview upgrades; entitlement changes require server-confirmed Stripe or verified native receipt events.

## Providers

The LLM router supports Anthropic as quality-first, Vertex/Gemini fallback, DeepSeek for low-risk cost-optimized text, and deterministic fallback. Local Docker points those clients at provider mocks by default; live provider calls require Vault-backed keys synced into Convex env. Provider outputs are parsed and safety-checked before persistence. Pro media orchestration is asynchronous and does not block text reading.

## Verification Notes

Current focused checks that have passed during implementation include workspace typechecks, Convex unit/integration tests, app typecheck, infra typecheck/build, Docker Compose config validation, provider mock smoke test, and task-specific media/analytics/co-op/publishing tests.

The Playwright E2E specs are in `tests/e2e`. The app E2E runner exports the Expo web app, serves the static output locally, waits for readiness, and runs Playwright against `E2E_BASE_URL`. For fast repeated local runs, set `E2E_REUSE_EXPORT=1` after a fresh export exists.
