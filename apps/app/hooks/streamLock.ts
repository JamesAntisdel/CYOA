// Per-save in-flight SSE-stream lock. The hook layer routes two callers
// into the same `/llm/scene-stream` endpoint: the `useTurn` mount-effect
// (when a `pending`/`streaming` scene loads) and `submitChoice` (after
// `beginRemoteStreamingChoice` resolves). When both fire concurrently
// against the same save, the browser cancels the earlier connection,
// Vertex aborts mid-flight, and the LLM router falls back to the
// deterministic provider — which echoes the reader's premise as the
// scene's prose (the user-visible "it says the story name" bug).
//
// This helper exposes a tiny acquire/release API around a Set<string>
// so the dedup invariant is unit-testable in isolation. The hook owns
// the actual Set via a useRef; this module just defines the operations
// and their (intentionally simple) semantics:
//
//   - `acquire(saveId)`: returns `true` and marks the save as held
//     when the save was NOT already held; returns `false` otherwise.
//     Callers that get `false` MUST NOT open a parallel stream; the
//     other holder will deliver the prose. A typical second-caller
//     recovery is `getRemoteCurrentScene` after a short delay.
//
//   - `release(saveId)`: clears the lock so a future turn can claim
//     a new one. Idempotent — releasing an unheld save is a no-op.
//
// The lock is intentionally local to the hook instance (one per save
// open in the reader). Server-side dedup in
// `convex/game.ts:getAuthorizedSceneStreamRequest` is the
// defense-in-depth backstop for the cross-tab / cross-process case.

export class StreamLock {
  private readonly heldSaves: Set<string>;

  constructor() {
    this.heldSaves = new Set();
  }

  acquire(saveId: string): boolean {
    if (this.heldSaves.has(saveId)) return false;
    this.heldSaves.add(saveId);
    return true;
  }

  release(saveId: string): void {
    this.heldSaves.delete(saveId);
  }

  isHeld(saveId: string): boolean {
    return this.heldSaves.has(saveId);
  }
}
