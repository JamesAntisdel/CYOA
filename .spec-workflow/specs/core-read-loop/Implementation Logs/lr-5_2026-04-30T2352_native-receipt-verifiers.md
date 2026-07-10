# Implementation Log: Native Receipt Verifier Boundaries

**Date:** 2026-04-30 23:52 PT
**Scope:** LR-5 code-side receipt verification hardening.

## Summary

Replaced the local native receipt placeholder behavior that treated any non-empty transaction id as verified. The Apple and Google helpers now require store-returned transaction/subscription records and validate:

- transaction id or purchase token match,
- product id match,
- account binding when the store record carries an app account token / obfuscated account id,
- bundle/package identity when configured,
- expiry,
- Apple revocation,
- Google acknowledgement and active/grace subscription states.

## Files Changed

- `convex/billing/apple.ts`
  - Added `AppleReceiptVerifier`.
  - Added `appleReceiptVerifierFromEnv`.
  - `verifyAppleReceipt` is now async and validates the store transaction record.
- `convex/billing/google.ts`
  - Added `GoogleReceiptVerifier`.
  - Added `googleReceiptVerifierFromEnv`.
  - `verifyGoogleReceipt` is now async and validates the Play subscription record.
- `convex/tests/billing.test.ts`
  - Added verified native receipt normalization coverage.
  - Added wrong-product, expired, cross-account, and empty-token rejection coverage.
- `scripts/secrets/vault-lib.mjs`
  - Added known Vault keys for mobile store access tokens and package/bundle ids.
- `scripts/secrets/check-local-env.mjs`
  - Added those store tokens to local secret leak detection.
- `docs/stripe-mobile.md`
  - Documented the new verifier behavior and remaining sandbox requirement.
- `.spec-workflow/specs/core-read-loop/tasks.md`
  - Added LR-5 progress details while keeping the item unchecked until sandbox API verification.

## Residual Risk

LR-5 remains open until real App Store and Google Play sandbox receipt checks are run with Vault-backed store credentials. The current implementation closes the application-side placeholder gap, but it does not prove store API credentials, app product setup, or sandbox receipt lifecycle.
