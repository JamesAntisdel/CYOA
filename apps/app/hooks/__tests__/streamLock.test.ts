/**
 * Unit tests for the per-save SSE stream lock used by `useTurn`. These
 * tests pin the dedup invariant that fixes the "turn 3 echoes the
 * premise" bug: when both the mount-effect and `submitChoice` try to
 * open `/llm/scene-stream` for the same save, only one acquire() should
 * succeed; the second sees `false` and must skip the stream open.
 *
 * Run:
 *   pnpm --filter @cyoa/convex exec vitest run -c apps/app/vitest.config.ts \
 *     apps/app/hooks/__tests__/streamLock.test.ts
 */
import { describe, expect, it } from "vitest";

import { StreamLock } from "../streamLock";

describe("StreamLock", () => {
  it("first acquire returns true and second concurrent acquire returns false", () => {
    const lock = new StreamLock();
    expect(lock.acquire("save_1")).toBe(true);
    // Sibling caller — must NOT open a parallel SSE stream.
    expect(lock.acquire("save_1")).toBe(false);
  });

  it("release lets a future caller reclaim the lock", () => {
    const lock = new StreamLock();
    expect(lock.acquire("save_1")).toBe(true);
    lock.release("save_1");
    // Next turn can claim a fresh stream.
    expect(lock.acquire("save_1")).toBe(true);
  });

  it("releases are scoped per save (one save does not unlock another)", () => {
    const lock = new StreamLock();
    expect(lock.acquire("save_a")).toBe(true);
    expect(lock.acquire("save_b")).toBe(true);
    lock.release("save_a");
    // save_b is still held.
    expect(lock.acquire("save_b")).toBe(false);
    // save_a is reclaimable.
    expect(lock.acquire("save_a")).toBe(true);
  });

  it("releasing an unheld save is a no-op", () => {
    const lock = new StreamLock();
    lock.release("never_held");
    expect(lock.acquire("never_held")).toBe(true);
  });

  it("isHeld reflects the current state", () => {
    const lock = new StreamLock();
    expect(lock.isHeld("save_1")).toBe(false);
    lock.acquire("save_1");
    expect(lock.isHeld("save_1")).toBe(true);
    lock.release("save_1");
    expect(lock.isHeld("save_1")).toBe(false);
  });
});
