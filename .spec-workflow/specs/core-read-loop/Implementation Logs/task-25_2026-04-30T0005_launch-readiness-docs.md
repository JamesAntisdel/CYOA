# Implementation Log: Task 25 Follow-up

**Summary:** Updated documentation and task tracking so launch-blocking operational work is explicit rather than hidden behind completed scaffold tasks. Added a Launch Readiness Tracker with unchecked P0 items for BetterAuth, live providers, Stripe, native billing, seed import, deployment, native release, and final verification.

**Timestamp:** 2026-04-30T00:05:00-07:00
**Log ID:** launch-readiness-docs-20260430

---

## Why This Follow-up Was Needed

The original `tasks.md` showed Tasks 1-25 as complete. That was accurate for local/mock-verified scaffold work, but misleading for launch readiness. Several docs still described required work in prose:

- `docs/convex-auth.md` listed generated BetterAuth runtime steps.
- `docs/stripe-mobile.md` noted placeholder native receipt verifiers.
- `docs/local-docker.md` documented a seed command placeholder.
- Provider docs distinguished local mocks from live provider behavior.

Without an explicit tracker, future work could treat these as documentation footnotes instead of blocking P0 tasks.

## Files Modified

- `.spec-workflow/specs/core-read-loop/tasks.md`
- `README.md`
- `docs/convex-auth.md`
- `docs/stripe-mobile.md`
- `docs/local-docker.md`

## Tracker Added

Added `## Launch Readiness Tracker` to `tasks.md` with unchecked items:

- `LR-1` Convex-backed BetterAuth runtime and session auth.
- `LR-2` Replace temporary LLM stream secret with account/save authorization.
- `LR-3` Validate live Anthropic, Vertex/Gemini, and DeepSeek calls.
- `LR-4` Stripe test-mode checkout and webhook entitlement pass.
- `LR-5` Replace native receipt placeholders.
- `LR-6` Implement explicit Convex seed/import command.
- `LR-7` Production/staging deployment rehearsal.
- `LR-8` Native build, signing, submit, and push validation.
- `LR-9` Final launch verification bundle.

Each item includes file ownership, required work, and concrete success criteria.

## Documentation Updates

### `README.md`

- Added a top-level note pointing to `tasks.md`.
- Clarified that Tasks 1-25 are local/mock-verified scaffold work and that Launch Readiness is the source of truth for remaining P0 work before real credentials or production traffic.

### `docs/convex-auth.md`

- Added `Current Status`.
- Fixed a malformed code fence around Vault sync commands.
- Added an explicit verification checklist for BetterAuth deployment.
- Linked production/session-backed auth completion to `LR-1`.

### `docs/stripe-mobile.md`

- Added `Current Status`.
- Clarified that billing launch readiness requires Stripe test-mode Checkout -> webhook -> Convex entitlement verification.
- Linked web checkout to `LR-4` and native receipt replacement to `LR-5`.
- Added receipt-rejection criteria for malformed, replayed, expired, wrong-product, and cross-account receipts.

### `docs/local-docker.md`

- Added current provider-client status.
- Clarified that local Docker uses provider mocks despite live provider clients existing.
- Linked live provider validation to `LR-3`, stream authorization to `LR-2`, and seed/import completion to `LR-6`.

## Verification

Documentation-only changes do not affect runtime code, but they were made after the following verification from the implementation/security pass:

- `pnpm typecheck` passed.
- `pnpm test` passed.
- `pnpm test:e2e` passed.
- `pnpm audit --audit-level moderate` passed.
- `pnpm secrets:local:check` passed.

## Residual Risks / Follow-up

- The Launch Readiness Tracker is now the authoritative list for remaining P0 work, but items are not complete.
- New implementation work must add dated implementation logs and should not check off `LR-*` items without real-service verification.
- Any future doc that says "placeholder", "Next Generated Step", or "Replace..." should either map to an `LR-*` item or be removed by implementation.
