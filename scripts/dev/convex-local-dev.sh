#!/bin/sh
set -eu

cd "$(dirname "$0")/../.."

if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.local
  set +a
fi

export CONVEX_DEPLOYMENT="${CONVEX_DEPLOYMENT:-anonymous:anonymous-workspace}"

# JWKS handling: only push a real JWK Set. The placeholder `[]` (empty
# array) trips BetterAuth's parser, so we clear the env var in that case
# and let BetterAuth auto-generate dev keys on first start.
if [ -n "${JWKS:-}" ] && [ "$JWKS" != "[]" ] && [ "$JWKS" != "" ]; then
  pnpm exec convex env set JWKS "$JWKS" >/dev/null
else
  pnpm exec convex env remove JWKS >/dev/null 2>&1 || true
fi

# BetterAuth needs a non-default secret. Pull from .env if set; otherwise
# generate a one-shot local secret. NEVER reuse this value in staging/prod;
# it lives on an anonymous local backend that's reset by deleting
# convex/.convex/local/.
if [ -n "${BETTER_AUTH_SECRET:-}" ] && [ "$BETTER_AUTH_SECRET" != "replace-with-a-local-random-string" ]; then
  AUTH_SECRET="$BETTER_AUTH_SECRET"
else
  AUTH_SECRET="$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 40)"
fi
pnpm exec convex env set BETTER_AUTH_SECRET "$AUTH_SECRET" >/dev/null

# Push every env var the Convex backend reads. Shell `.env` does not
# propagate into Convex actions — each var must be set on the deployment.
# Anything not set in the shell is skipped; sensitive Vault keys never
# end up here because `.env` should not carry them.
push_env() {
  local key="$1"
  local fallback="${2:-}"
  eval "local value=\${$key:-}"
  if [ -z "$value" ] && [ -n "$fallback" ]; then
    value="$fallback"
  fi
  if [ -n "$value" ]; then
    pnpm exec convex env set "$key" "$value" >/dev/null
  fi
}

# BetterAuth + app URLs
push_env SITE_URL
push_env BETTER_AUTH_URL
push_env PUBLIC_APP_URL
push_env EXPO_PUBLIC_APP_URL
push_env EXPO_PUBLIC_CONVEX_URL
push_env EXPO_PUBLIC_CONVEX_SITE_URL

# Provider routing. Defaults point at the docker-network mock host so the
# Convex container resolves them even when the developer never sets the
# vars in `.env`.
push_env ANTHROPIC_BASE_URL "http://provider-mocks:4010/anthropic"
push_env VERTEX_BASE_URL "http://provider-mocks:4010/vertex"
push_env DEEPSEEK_BASE_URL "http://provider-mocks:4010/deepseek"
push_env ANTHROPIC_API_KEY
push_env ANTHROPIC_MODEL
push_env VERTEX_PROJECT_ID
push_env VERTEX_LOCATION
push_env VERTEX_ACCESS_TOKEN
push_env VERTEX_TEXT_MODEL
push_env GEMINI_API_KEY
push_env GOOGLE_CLOUD_TTS_API_KEY
push_env GEMINI_TEXT_MODEL
push_env GEMINI_IMAGE_MODEL
push_env GEMINI_VEO_MODEL
push_env GEMINI_VEO_DURATION_MS
push_env GEMINI_VEO_RESOLUTION
push_env GEMINI_VEO_ASPECT_RATIO
push_env GEMINI_VEO_ESTIMATED_CENTS_PER_SECOND
push_env DEEPSEEK_API_KEY
push_env DEEPSEEK_MODEL
push_env LLM_TIMEOUT_MS

# Dev override: when set, queueSceneImage skips the Pro entitlement
# check so local testing of MediaPlate doesn't require billing config.
# UNSET this before any tunnel test exposed to other accounts.
push_env CYOA_DEV_FORCE_PRO_MEDIA "1"

# Stripe — push the secret so the webhook handler can reach signature
# validation (and return 400 instead of crashing) even when no real
# webhook is wired. Real test keys come from Vault.
push_env STRIPE_SECRET_KEY
push_env STRIPE_WEBHOOK_SECRET "whsec_local_placeholder_only_signature_400s_will_be_correct"
push_env STRIPE_WEBHOOK_FORWARD_URL
push_env STRIPE_PRICE_UNLIMITED_MONTHLY
push_env STRIPE_PRICE_UNLIMITED_ANNUAL
push_env STRIPE_PRICE_PRO_MONTHLY
push_env STRIPE_PRICE_PRO_ANNUAL

# Native IAP product ids (for nativeReceipts validation)
push_env APPLE_PRODUCT_UNLIMITED_MONTHLY
push_env APPLE_PRODUCT_PRO_MONTHLY
push_env GOOGLE_PRODUCT_UNLIMITED_MONTHLY
push_env GOOGLE_PRODUCT_PRO_MONTHLY

exec pnpm exec convex dev
