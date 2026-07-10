# Task 10 Implementation Log: Scene Length Budgets

**Date:** 2026-04-30
**Status:** Implemented and locally verified.

## Summary

Added first-class scene prose budgets so the tutorial can stay concise while main adventures and chapter beats can request richer prose from the LLM without changing engine authority.

## Files Changed

- `packages/engine/src/types.ts`
  - Added `SceneLength = "brief" | "standard" | "rich" | "chapter"`.
  - Added optional `Story.defaultSceneLength` and `StoryNode.sceneLength`.
- `convex/llm/types.ts`
  - Added `sceneLength` to `SceneGenerationRequest` and its Zod schema, defaulting parsed HTTP requests to `standard`.
- `convex/llm/prompts/scene.ts`
  - Added prose-budget instructions to the scene prompt.
  - Mapped `brief`, `standard`, `rich`, and `chapter` to concrete paragraph/word-count guidance.
- `convex/turn.ts`
  - Resolves scene length as node override, then story default, then `standard`.
- `packages/stories/src/training-room/index.ts`
  - Set the tutorial default to `brief`.
- `packages/stories/src/stubs.ts`
  - Set starter adventure defaults to `standard` or `rich` based on difficulty.
- `apps/app/app/creator/index.tsx`
  - Sets generated creator seeds to `standard` by default.
- `convex/tests/llmRouter.test.ts`
  - Added prompt coverage for rich prose-budget instructions.
- Requirements, design, and task tracker
  - Documented the prose-budget model and the current Pro media tier boundary.

## Verification

- `docker compose run --rm app pnpm typecheck` passed.
- `docker compose run --rm app pnpm test` passed.

## Notes

- The entitlement model currently supports `free`, `unlimited`, and `pro`. Image and video generation are Pro-gated; a future Max tier needs a new entitlement value and product mapping before it can be advertised.
