# Local Docker Development

This scaffold gives developers a production-like local boundary without pretending that managed production systems run fully offline.

## Quick Start

```sh
cp .env.example .env
docker compose up --build app provider-mocks
```

Open the Expo web URL printed by the `app` service, usually `http://localhost:8081`.

## Services

- `app`: Expo web dev server for `apps/app`.
- `provider-mocks`: deterministic local HTTP mocks for Anthropic-like, Vertex-like, DeepSeek-like, and Stripe-placeholder responses. No paid provider calls are made.
- `convex`: optional Convex CLI process under the `convex` profile. Convex is managed infrastructure, so most developers should connect to a personal Convex dev deployment and set `EXPO_PUBLIC_CONVEX_URL`.
- `object-storage`: optional MinIO service under the `storage` profile for asset-flow experiments before GCS/CDN wiring exists.
- `stripe-cli`: optional Stripe CLI webhook forwarder under the `stripe` profile. Use Stripe test mode only.

## Common Commands

```sh
docker compose up --build app provider-mocks
docker compose --profile convex up convex
docker compose --profile storage up object-storage
docker compose run --rm app node scripts/dev/seed-local.mjs
```

To force provider failure-mode checks:

```sh
MOCK_PROVIDER_MODE=fail docker compose up provider-mocks
```

## Convex Boundary

Convex production is fully managed and is not reproduced by Docker. Local Docker can run the Convex CLI or connect the app to a personal Convex dev deployment, but it does not mirror Convex production scheduling, storage, auth integration, deployment isolation, or runtime scaling.

Use `pnpm dev:convex` locally or `docker compose --profile convex up convex` when you want the CLI process in a container. Use the deployment URL it prints as `EXPO_PUBLIC_CONVEX_URL`.

## Provider Boundary

Default local development uses deterministic mocks and in-repo fallback providers. Do not put live Anthropic, Vertex, DeepSeek, or Google service-account credentials in `.env` unless you are explicitly testing paid sandbox/provider behavior.

Production provider behavior that cannot be mirrored locally:

- Anthropic production latency, rate limits, billing, model quality, and safety behavior.
- Vertex AI IAM, quotas, regional behavior, Imagen/Veo generation, and audit logs.
- DeepSeek production latency, rate limits, billing, model quality, and outages.

## Stripe Webhooks

Use Stripe test mode only. Start forwarding with:

```sh
docker compose --profile stripe up stripe-cli
```

Set `STRIPE_WEBHOOK_FORWARD_URL` to the local Convex HTTP action endpoint once the billing webhook route is available. The Stripe CLI prints a test webhook signing secret; put that value in your uncommitted `.env` as `STRIPE_WEBHOOK_SECRET`.

Stripe live billing, invoices, tax behavior, metered usage settlement, disputes, and production webhook delivery are not mirrored locally.

## Seed Data

The current seed command is a placeholder:

```sh
docker compose run --rm app node scripts/dev/seed-local.mjs
```

Starter story data is owned by `packages/stories`. The placeholder documents the intended Convex mutation boundary and avoids direct table writes until a seed/import API exists.

## What Local Docker Does Not Mirror

- Convex production runtime, managed storage, scheduled jobs, auth deployment isolation, and scaling.
- Stripe live billing, live webhooks, disputes, invoices, tax behavior, and production customer portal behavior.
- Vertex/Anthropic/DeepSeek production calls, quotas, billing, model quality, and outages.
- StoreKit and Google Play Billing receipt verification.
- EAS Build, EAS Submit, app-store review, and native signing.
- Real push notification delivery.

These are intentionally managed or sandboxed systems. Local Docker mirrors contracts, service boundaries, and failure modes only.
