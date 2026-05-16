# EAS native build pre-flight (LR-8)

Before submitting the first native iOS or Android build, work through this
checklist. Every step is gated by credentials — none of them are part of
the local Docker / Convex dev loop.

## Prerequisites

- Apple Developer account active, paid, and with iOS Distribution +
  Push Notification entitlements enabled.
- Google Play Console account with a real package owner.
- App Store Connect API key (issuer ID, key ID, .p8) stored in Vault as
  `apple/app-store-connect.{issuer-id,key-id,key-p8}`.
- Google Play Service Account JSON stored in Vault as
  `google/play-service-account.json`.
- EAS account linked to the project (`eas init`).

## Pre-flight checks

### 1 — App configuration

- [ ] `apps/app/app.json` `ios.bundleIdentifier` matches the App Store
      Connect record (currently `com.cyoa.unwritten`).
- [ ] `apps/app/app.json` `android.package` matches the Play Console
      record (currently `com.cyoa.unwritten`).
- [ ] Icons + splash + adaptive-icon are pointed at canonical assets
      from `apps/app/assets/design/marketing/` and
      `apps/app/assets/design/logos/`.
- [ ] `eas.json` has `development`, `preview`, and `production`
      build profiles. Each binds to the right release channel.
- [ ] `eas.json` build profiles set `env.EXPO_PUBLIC_CONVEX_URL` and
      `EXPO_PUBLIC_CONVEX_SITE_URL` for the matching deployment.

### 2 — Signing + credentials

iOS:
- [ ] `eas credentials --platform ios` shows a valid distribution
      certificate + provisioning profile for the bundle id.
- [ ] Push notification key is uploaded if `apps/app/app.json` opts
      into push.

Android:
- [ ] `eas credentials --platform android` shows a valid upload
      keystore.
- [ ] Google Play Console has the upload key fingerprint registered.

### 3 — Receipt verification

- [ ] App Store Server API key tested locally (Vault → `pnpm smoke:live-stripe`
      doesn't cover this; native receipt validation is via
      `convex/billing/apple.ts` + `nativeReceipts.ts`).
- [ ] Google Play Developer API access works against a sandbox purchase.

### 4 — Native build

```bash
# Sync Vault env into the local shell so EAS can pick up the secrets.
pnpm secrets:vault:exec -- bash -c 'eas build --profile preview --platform all'
```

Expected:
- Both platforms succeed in ~15-25 minutes.
- The download links work on a device with the right TestFlight /
  internal-testing access.

### 5 — Submit dry-run

```bash
# iOS — submit to TestFlight for internal review:
eas submit --platform ios --profile production --latest

# Android — submit to internal testing track:
eas submit --platform android --profile production --latest
```

### 6 — Push notification path

If push is wired (Req 25.4):

- [ ] Send a test push from the Convex backend to a test device.
- [ ] Confirm permission prompt appears on first launch.
- [ ] Confirm the daily-candle reminder + co-op-turn-waiting paths both
      deliver.

### 7 — Release channel separation

- [ ] `eas update --branch development` only affects dev builds.
- [ ] `eas update --branch preview` only affects preview/TestFlight.
- [ ] `eas update --branch production` is gated by manual approval in
      the CI workflow.

## Rollback

EAS Update lets you roll back without re-submitting the app store
binary:

```bash
# List recent updates on the production branch:
eas update:list --branch production

# Promote a specific older update back to production:
eas update --branch production --message "Rollback to <id>" --re-publish <update-id>
```

If the binary itself is the problem (not OTA-fixable), use App Store
Connect's "Remove from Sale" or Play Console's "Halt staged rollout"
and submit a fix build under the same version + bumped buildNumber.

## Sign-off artifact

When the pre-flight is fully green, attach the output of:

```bash
pnpm smoke:launch-verify --require-llm anthropic,vertex,deepseek --require-stripe
```

to the EAS submission PR. The log file under
`.spec-workflow/specs/core-read-loop/Implementation Logs/lr-9_*.md` is
the auditable trail.
