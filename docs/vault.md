# Vault Secrets

HashiCorp Vault is the source of truth for real credentials. Do not put live keys
in `.env`, `.env.local`, shell history, EAS config, or committed docs.

The sync scripts read Vault KV v2 over the Vault HTTP API and push values into
the deployment secret stores that need them. Values are not written to disk.

## Required Local Environment

```sh
export VAULT_ADDR=https://vault.example.com
export VAULT_TOKEN=<operator-token>
export VAULT_KV_MOUNT=secret
export VAULT_SECRET_PATH=cyoa/dev
```

Set `VAULT_NAMESPACE` too if your Vault tenancy requires it.

## Secret Shape

Store one KV v2 secret per environment:

```sh
vault kv put secret/cyoa/dev \
  BETTER_AUTH_SECRET='<generated-secret>' \
  SITE_URL='https://your-tunnel-or-domain.example' \
  JWKS='<generated-jwks-json>' \
  STRIPE_SECRET_KEY='sk_test_...' \
  STRIPE_WEBHOOK_SECRET='whsec_...' \
  STRIPE_PRICE_UNLIMITED_MONTHLY='price_...' \
  STRIPE_PRICE_UNLIMITED_ANNUAL='price_...' \
  STRIPE_PRICE_PRO_MONTHLY='price_...' \
  STRIPE_PRICE_PRO_ANNUAL='price_...'
```

Optional provider/mobile credentials belong in the same environment path when
they are ready:

```sh
vault kv patch secret/cyoa/dev \
  GEMINI_API_KEY='...' \
  ANTHROPIC_API_KEY='...' \
  DEEPSEEK_API_KEY='...' \
  VERTEX_PROJECT_ID='...' \
  VERTEX_LOCATION='us-central1' \
  VERTEX_ACCESS_TOKEN='...' \
  EAS_TOKEN='...' \
  APP_STORE_CONNECT_API_KEY_ID='...' \
  APP_STORE_CONNECT_ISSUER_ID='...' \
  APP_STORE_CONNECT_PRIVATE_KEY='...' \
  APP_STORE_CONNECT_BEARER_TOKEN='...' \
  APPLE_BUNDLE_ID='com.example.cyoa' \
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON='...' \
  GOOGLE_PLAY_ACCESS_TOKEN='...' \
  GOOGLE_PLAY_PACKAGE_NAME='com.example.cyoa'
```

For live story-generation testing, at least one text provider key must be
present. Use `ANTHROPIC_API_KEY` for the quality route, `GEMINI_API_KEY` or
Vertex credentials for the Gemini fallback route, and `DEEPSEEK_API_KEY` for
the low-risk cost route. Keep provider base URLs unset for live testing unless
you are intentionally routing to a private proxy; the local `.env.example`
base URLs point at non-billable mocks.

## Validate Vault Readiness

```sh
pnpm secrets:local:check
pnpm secrets:vault:check
```

Require the mobile/store credentials too:

```sh
pnpm secrets:vault:check -- --all
```

## Sync to Convex

Dev deployment:

```sh
pnpm secrets:vault:sync-convex -- --deployment dev
```

Production deployment:

```sh
pnpm secrets:vault:sync-convex -- --deployment prod --path cyoa/prod
```

Dry run without writing:

```sh
pnpm secrets:vault:sync-convex -- --deployment prod --path cyoa/prod --dry-run
```

After syncing, run Convex deploy/codegen from an authenticated shell. Convex
stores these values as deployment environment variables; Vault remains the
canonical place to rotate and re-sync them.

## Run Tools With Vault Secrets

Use `secrets:vault:exec` when a tool needs credentials in environment variables,
for example EAS:

```sh
pnpm secrets:vault:exec -- --require EAS_TOKEN -- npx eas-cli build --profile production --platform all
```

Expose only selected keys when a command should receive a narrow environment:

```sh
pnpm secrets:vault:exec -- --require EAS_TOKEN --only EAS_TOKEN -- npx eas-cli whoami
```

## Live Readiness Smoke

After the app is exposed over HTTPS and Convex env is synced, run:

```sh
pnpm smoke:live-readiness -- --app-url https://your-app.example --convex-site-url https://your-convex-site.example
```

This does not spend provider tokens. It checks that the app serves HTML, the LLM stream route rejects unauthenticated direct calls before provider work, BetterAuth routes are mounted, and the Stripe webhook route is reachable.
