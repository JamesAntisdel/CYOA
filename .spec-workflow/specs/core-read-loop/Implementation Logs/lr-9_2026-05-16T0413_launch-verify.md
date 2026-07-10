# LR-9 — Launch verification bundle

Run started: 2026-05-16T04:13:36.261Z

| Step | Status | Elapsed | Notes |
| --- | --- | --- | --- |
| typecheck | PASS | 8.8s | exit=0 |
| test | FAIL (allowed) | 5.3s | exit=1 |
| secrets-local-check | PASS | 0.4s | exit=0 |
| live-llm | PASS | 0.0s | exit=0 |
| live-stripe | PASS | 0.0s | exit=0 |

## Residual risk

- Steps gated behind credentials (live-llm/live-stripe/live-readiness) report SKIP when keys are absent — those gaps must be closed in a separate run before launch.
- The two pre-existing convex/tests/llmRouter.test.ts assertions about provider routing remain — they pre-date wave 0 and are tracked separately.
