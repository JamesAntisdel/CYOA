# Implementation Log: HTTP SSE Streaming Lifecycle

**Date:** 2026-04-30 23:33 PT
**Scope:** Core read loop, LR-2 authorization hardening, LLM streaming readiness before live keys.

## Summary

Reworked the remote read-loop streaming path so gameplay uses a server-authoritative two-step lifecycle:

1. `game.beginStreamingChoice` applies the engine transition, consumes the daily turn, creates a pending scene, records turn history, and returns a pending projection to the client.
2. The client opens `/llm/scene-stream` with only account/save identity and guest proof when applicable.
3. The HTTP action calls `game.getAuthorizedSceneStreamRequest`, which validates account/save access and confirms the save has a current pending scene.
4. The provider request is built server-side from story/save state, streams token events to the client, and calls `game.completeSceneStream` to persist the accumulated prose and provider metadata.
5. If provider streaming fails, the HTTP action calls `game.failSceneStream` so the scene is marked failed and `activeTurnRequestId` is cleared.

## Files Changed

- `convex/game.ts`
  - Added `beginStreamingChoice`.
  - Added `getAuthorizedSceneStreamRequest`.
  - Added `completeSceneStream`.
  - Added `failSceneStream`.
  - Preserved authored seed story ids as `authored_seed:<seedId>` while loading published creator seed data.
- `convex/http.ts`
  - Changed `/llm/scene-stream` to accept minimal account/save identity.
  - Kept legacy full request parsing for compatibility, but reduces it to account/save identity before provider work.
  - Added stream completion and stream failure hooks.
  - Continued redacting raw provider errors from SSE output.
- `apps/app/lib/gameApi.ts`
  - Added `beginRemoteStreamingChoice`.
  - Added `streamRemoteScene` SSE parsing against `EXPO_PUBLIC_CONVEX_SITE_URL`.
- `apps/app/hooks/useTurn.ts`
  - Uses `beginRemoteStreamingChoice` before opening the HTTP stream.
  - Renders live SSE prose immediately and falls back to the current saved scene if streaming fails.
- `apps/app/hooks/useStreamingScene.ts`
  - Added instant reveal mode for already-streamed live prose.
- `convex/tests/llmRouter.test.ts`
  - Added coverage for stream completion hook accumulation.
  - Added coverage that provider failures call the cleanup hook and do not expose raw provider errors.
- `.spec-workflow/specs/core-read-loop/design.md`
  - Updated the turn sequence and security controls for the pending-scene SSE lifecycle.
- `.spec-workflow/specs/core-read-loop/requirements.md`
  - Updated Requirement 5 to name `game.beginStreamingChoice`, pending-scene authorization, and stream-failure recovery.
- `.spec-workflow/specs/core-read-loop/tasks.md`
  - Updated LR-2 progress notes.
- `docs/local-docker.md`
  - Documented the account/save + pending-scene SSE boundary.

## Verification

Commands run in Docker:

- `docker compose run --rm app pnpm typecheck` - passed.
- `docker compose run --rm app pnpm test` - passed, 93 Convex tests plus package tests.
- `docker compose run --rm app pnpm test:e2e` - passed, 16 Playwright tests.

## Residual Risk

LR-2 remains unchecked until the HTTPS tunnel points at a configured Convex dev deployment and we verify:

- unauthenticated direct `/llm/scene-stream` calls fail before provider work,
- authorized guest/user saves stream tokens,
- provider completion persists byte-identical prose,
- provider failure clears the active turn lock against the live deployment.

LR-3 remains unchecked until Vault-backed Anthropic, Vertex/Gemini, and DeepSeek credentials are synced and live provider smoke tests pass.
