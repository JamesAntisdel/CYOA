# Stripe and Mobile Billing

## Current Status

- Pure billing helpers, entitlement modeling, Stripe webhook normalization, and test coverage exist.
- Local paywall UI uses mocked/preview upgrade flows unless Stripe test keys are synced.
- Real Stripe checkout and webhook entitlement changes are tracked as `LR-4`.
- Native receipt verification now validates store-returned transaction/subscription records for product, account binding, expiry, revocation/inactive state, and package/bundle identity. `LR-5` remains open until those verifiers are run against App Store and Google Play sandbox APIs with Vault-backed credentials.

Do not mark billing launch-ready until Stripe test mode has completed Checkout -> webhook -> Convex entitlement update end to end with Vault-backed keys and price IDs.

## Stripe Web Checkout

The pure billing layer now builds subscription Checkout params and normalizes Stripe webhooks.
Generated Convex functions should call these helpers after `convex dev` creates `_generated`.

Real Stripe keys and price IDs must be stored in Vault first. Do not paste live
keys into `.env`.

Required Vault fields for Convex:

```sh
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_UNLIMITED_MONTHLY
STRIPE_PRICE_UNLIMITED_ANNUAL
STRIPE_PRICE_PRO_MONTHLY
STRIPE_PRICE_PRO_ANNUAL
```

Validate and sync them:

```sh
pnpm secrets:vault:check
pnpm secrets:vault:sync-convex -- --deployment dev
```

Local Stripe CLI:

```sh
docker compose --profile stripe up stripe-cli
```

Use the CLI-printed `whsec_...` as `STRIPE_WEBHOOK_SECRET` for forwarded events.

## Native Billing

Production mobile builds use app-store billing rather than Stripe Checkout for digital access.
Product IDs are reserved in `.env.example`:

- `cyoa_unlimited_monthly`
- `cyoa_pro_monthly`

Before store submission:

- Create matching products in App Store Connect.
- Create matching products in Google Play Console.
- Store `EAS_TOKEN`, App Store Connect API credentials, and Google Play service account JSON in Vault.
- Sync either short-lived API access tokens or CI-generated bearer tokens from Vault for sandbox verification:
  - `APP_STORE_CONNECT_BEARER_TOKEN`
  - `APPLE_BUNDLE_ID`
  - `GOOGLE_PLAY_ACCESS_TOKEN`
  - `GOOGLE_PLAY_PACKAGE_NAME`
- Decide whether to use direct StoreKit/Play Billing or a billing provider abstraction.

Receipt verification must reject malformed, replayed, expired, wrong-product, and cross-account receipts before native billing can be considered complete.

Vault-backed EAS command shape:

```sh
pnpm secrets:vault:exec -- --require EAS_TOKEN --only EAS_TOKEN -- npx eas-cli build --profile production --platform all
```
