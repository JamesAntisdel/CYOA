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
if [ -n "${JWKS:-}" ]; then
  JWKS_VALUE="$JWKS"
else
  JWKS_VALUE='[]'
fi

pnpm exec convex env set JWKS "$JWKS_VALUE" >/dev/null
exec pnpm exec convex dev
