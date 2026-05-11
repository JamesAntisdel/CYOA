/**
 * Unit tests for the toast queue. The app does not yet have a JS test runner
 * configured (see apps/app/package.json's "test" script), so this file is
 * authored as a self-contained module that runs its assertions when invoked
 * directly via `node --import tsx`. Each helper is a pure function so the
 * checks are deterministic.
 */
import { __advanceQueueForTest, type Toast } from "../useToast";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`assert failed: ${message}`);
  }
}

function makeToast(id: string, message = "hello"): Toast {
  return { id, message, tone: "info", durationMs: 3200 };
}

export function runUseToastTests(): void {
  // push appends to the tail
  {
    const a = makeToast("a");
    const b = makeToast("b");
    const q1 = __advanceQueueForTest([], { type: "push", toast: a });
    const q2 = __advanceQueueForTest(q1, { type: "push", toast: b });
    assert(q2.length === 2, "queue should have two toasts");
    assert(q2[0]?.id === "a", "first toast should be a");
    assert(q2[1]?.id === "b", "second toast should be b");
  }

  // dismiss with no id pops the head
  {
    const a = makeToast("a");
    const b = makeToast("b");
    const q = __advanceQueueForTest([a, b], { type: "dismiss" });
    assert(q.length === 1, "queue should drop the head");
    assert(q[0]?.id === "b", "remaining toast should be b");
  }

  // dismiss with matching id pops the head
  {
    const a = makeToast("a");
    const b = makeToast("b");
    const q = __advanceQueueForTest([a, b], { type: "dismiss", id: "a" });
    assert(q.length === 1, "matching dismiss should pop");
    assert(q[0]?.id === "b", "remaining toast should be b");
  }

  // dismiss with non-head id is a no-op (single visible toast invariant)
  {
    const a = makeToast("a");
    const b = makeToast("b");
    const q = __advanceQueueForTest([a, b], { type: "dismiss", id: "b" });
    assert(q.length === 2, "non-head dismiss should be a no-op");
    assert(q[0]?.id === "a", "head should still be a");
  }

  // empty queue dismiss is a no-op
  {
    const q = __advanceQueueForTest([], { type: "dismiss" });
    assert(q.length === 0, "empty dismiss is a no-op");
  }
}

if (typeof require !== "undefined" && require.main === module) {
  runUseToastTests();
  // eslint-disable-next-line no-console
  console.log("useToast tests passed");
}
