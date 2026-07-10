# Implementation Log: Task 24 Follow-up

**Summary:** Performed a security and bug scrub after live LLM client wiring. Fixed unauthenticated stream-spend risk, provider credential transport risk, provider error leakage, missing Vault/env schema entries, and vulnerable transitive dependency advisories.

**Timestamp:** 2026-04-29T23:58:00-07:00
**Log ID:** security-audit-scrub-20260429

---

## Findings And Fixes

### Finding 1: Direct LLM SSE Route Could Trigger Provider Spend

- **Risk:** `/llm/scene-stream` accepted any valid scene-generation request. Once live keys were configured, an unauthenticated caller could trigger paid provider traffic.
- **Fix:** Added `isAuthorizedStreamRequest` in `convex/http.ts`.
- **Current behavior:** Route returns `401` unless `LLM_STREAM_SECRET` is configured and the caller sends `x-cyoa-stream-secret` with the matching value.
- **Residual risk:** Shared secret is an interim control only. `LR-2` tracks replacing it with session-aware account/save authorization.

### Finding 2: Raw Provider Errors Could Leak Through SSE

- **Risk:** Provider exceptions could include endpoint details or other sensitive diagnostics and were streamed to clients.
- **Fix:** SSE error events now always emit `llm_stream_failed` instead of raw exception text.
- **Regression test:** `convex/tests/llmRouter.test.ts` verifies raw provider exception text is not present in stream output.

### Finding 3: Provider Credentials Could Be Sent To Plain HTTP Non-local URLs

- **Risk:** Misconfigured provider base URLs could send `Authorization` or API-key headers over plain HTTP.
- **Fix:** `postJson` now calls `assertSafeProviderUrl` before network I/O. Plain HTTP is allowed only for recognized local/mock hosts.
- **Regression test:** `postJson` rejects `http://example.com/...` with `llm_provider_insecure_url`.

### Finding 4: Vault Sync Allowlist Missed New LLM Keys

- **Risk:** Operators could store new LLM config in Vault but `secrets:vault:sync-convex` would silently omit it.
- **Fix:** Added `ANTHROPIC_MODEL`, `DEEPSEEK_MODEL`, `GEMINI_TEXT_MODEL`, `VERTEX_ACCESS_TOKEN`, `VERTEX_TEXT_MODEL`, `LLM_TIMEOUT_MS`, and `LLM_STREAM_SECRET` to `scripts/secrets/vault-lib.mjs`.

### Finding 5: Shared Env Schema Missed New LLM Settings

- **Risk:** Contract tests did not validate newly introduced LLM environment variables.
- **Fix:** Added the new LLM keys to `packages/shared/src/env/index.ts`.
- **Regression test:** `packages/shared/tests/contracts.test.ts` validates accepted values and rejects too-short `LLM_STREAM_SECRET`.

### Finding 6: Dependency Audit Found Vulnerable Transitives

- **Risk:** `pnpm audit --audit-level high` initially reported high-severity advisories in Expo/Vitest transitive dev tooling (`tar`, `@xmldom/xmldom`). Moderate advisories remained for `esbuild`, `postcss`, `vite`, and `uuid`.
- **Fix:** Added pnpm overrides in root `package.json` and regenerated `pnpm-lock.yaml`:
  - `tar: 7.5.11`
  - `@xmldom/xmldom: 0.8.13`
  - `esbuild: 0.25.12`
  - `postcss: 8.5.10`
  - `vite: 6.4.2`
  - `uuid: 14.0.0`
- **Verification:** `pnpm audit --audit-level moderate` reports no known vulnerabilities.

---

## Files Modified

- `convex/http.ts`
- `convex/llm/httpClient.ts`
- `convex/tests/llmRouter.test.ts`
- `packages/shared/src/env/index.ts`
- `packages/shared/tests/contracts.test.ts`
- `scripts/secrets/vault-lib.mjs`
- `package.json`
- `pnpm-lock.yaml`
- `.env.example`
- `docs/vault.md`
- `.spec-workflow/specs/core-read-loop/design.md`

## Spec Update

- Updated `design.md` to require authenticated SSE stream requests and account/save authorization before any LLM provider call.
- Added launch-readiness tracker item `LR-2` for replacing the temporary shared stream secret with session-aware authorization.

## Verification

- `pnpm typecheck` passed.
- `pnpm test` passed.
- `pnpm test:e2e` passed.
- `pnpm audit --audit-level moderate` passed with no known vulnerabilities.
- `pnpm secrets:local:check` passed with no sensitive credentials found in local env files.
- Generated JavaScript source scan was clean outside `convex/_generated`.

## Residual Risks / Follow-up

- `LLM_STREAM_SECRET` is not a final public-auth model; it is a spend-control guard until BetterAuth/session auth is complete.
- Dependency overrides should be revisited when upgrading Expo/Vitest so they can be removed if upstream packages pull patched versions naturally.
- Native receipt verification remains placeholder-level and is tracked by `LR-5`.
