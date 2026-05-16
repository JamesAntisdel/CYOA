# Deployment runbook — staging + production (LR-7)

This document is the source of truth for promoting a build from local dev
to staging, and from staging to production. It assumes Vault is wired
(see `docs/vault.md`) and BetterAuth + Convex local dev work end-to-end
(see `docs/convex-auth.md`).

## Pre-flight checklist

Before any deployment:

- [ ] `pnpm install` is clean.
- [ ] `pnpm typecheck` is green across all six workspaces.
- [ ] `pnpm test` is green for shared/engine/stories; the two pre-existing
      `convex/tests/llmRouter.test.ts` failures are tracked and acknowledged.
- [ ] `pnpm secrets:local:check` returns "No sensitive credentials found"
      (no real keys committed in any `.env*` file).
- [ ] `pnpm secrets:vault:check` confirms the Vault entries the deployment
      needs are present and sealed.
- [ ] The current branch's design canvas has no uncommitted drift
      (`pnpm test:visual` if baselines are seeded).

## Staging deployment

Staging is the first cloud target. All credentials come from Vault — do
not paste API keys at the shell.

### 1 — Convex deploy

```bash
# Sync env vars from Vault → Convex dev/staging deployment
pnpm secrets:vault:sync-convex --deployment $CONVEX_STAGING_DEPLOYMENT

# Deploy
CONVEX_DEPLOYMENT=$CONVEX_STAGING_DEPLOYMENT pnpm convex:deploy
```

Expected:
- Codegen succeeds.
- BetterAuth `/api/auth/*`, Stripe `/stripe/webhook`, LLM `/llm/scene-stream`
  routes mount on the configured site URL.
- Convex schema migration runs cleanly (no destructive table drops).

### 2 — Web export + hosting

```bash
pnpm build:web
# Output: apps/app/dist/

# Upload via Cloudflare Pages or whatever the staging host is. Example:
# wrangler pages deploy apps/app/dist --project-name cyoa-staging
```

### 3 — Health check

```bash
pnpm smoke:live-readiness \
  --app-url $STAGING_APP_URL \
  --convex-site-url $STAGING_CONVEX_SITE_URL
```

Expected output:
```
PASS app-html: 200 OK
PASS llm-stream-authz: 403 llm_stream_forbidden
PASS betterauth-session-route: 200/401 (anything but 404)
PASS stripe-webhook-mounted: 400 (bad signature is the right error)
```

### 4 — Provider fallback smoke

```bash
pnpm smoke:live-llm
# Or to enforce all three providers respond:
pnpm smoke:live-llm --require anthropic,vertex,deepseek
```

### 5 — Stripe webhook smoke

In a second shell:
```bash
stripe listen --forward-to $STAGING_CONVEX_SITE_URL/stripe/webhook
```

In a third shell:
```bash
stripe trigger checkout.session.completed
```

Verify in the Stripe CLI output that the event 200s back from the
webhook handler, and verify in Convex logs that the matching account's
entitlement updated.

## Production promotion

Production requires explicit human approval at three gates:

1. Staging has been live for ≥24 hours with no Sev-1 incidents.
2. Provider fallback rates are normal (Sentry / operator dashboard).
3. Schema migration has been rehearsed against a staging clone of
   production data.

Once approved, run the same deploy sequence with the production
deployment name. Then watch:

- Convex realtime logs for the first 15 minutes.
- The operator dashboard live board for unusual error spikes.
- Stripe dashboard for any payment intent failures.

## Rollback

### Convex

```bash
# Convex retains every deployed version. To roll back:
CONVEX_DEPLOYMENT=$CONVEX_PROD_DEPLOYMENT \
  npx convex deploy --version-id <previous-version-id>
```

The migration path must be append-only — destructive schema changes
require a forward-only rollback plan documented in the migration PR.

### Web

Cloudflare Pages keeps the last N deployments; promote the previous
build via the dashboard or `wrangler pages deployment list`.

### Native (EAS)

See `docs/eas-preflight.md` for the EAS Update channel rollback path.

## Monitoring

Operator dashboard at `/admin` (admin-gated) surfaces:

- Funnel — `session_start → first_turn → first_paywall_view → upgrade`.
- Cost — per-provider request count + dollar estimate.
- Safety — classified outcomes (`allow / redirect / safe_close / refuse`).
- Live — current concurrent reads, stream health, error rate.

Sentry (if wired) catches client + server exceptions. Convex's built-in
log stream is the source of truth for backend errors.

## Post-deploy artifact

After every staging or production deploy, run:

```bash
pnpm smoke:launch-verify \
  --app-url $APP_URL \
  --convex-site-url $CONVEX_SITE_URL
```

This emits a dated log under
`.spec-workflow/specs/core-read-loop/Implementation Logs/lr-9_*.md`
with every check's status, elapsed time, and residual risk. Attach
that file to the deployment PR.
