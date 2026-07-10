import { describe, expect, it } from "vitest";

import {
  guardMemoryBeats,
  guardSeedText,
  readIdempotentTurnResult,
  recordIdempotentTurnResult,
} from "../game";

const generationContext = {
  surface: "generation" as const,
  entitlementTier: "free" as const,
  matureContentEnabled: false,
};

// A minimal in-memory fake of the subset of ctx.db the idempotency helpers use:
// query(table).withIndex(name, q => q.eq(field, val)...).first() and insert().
function makeIdemDb(initial: Record<string, unknown>[] = []) {
  const rows = [...initial];
  return {
    rows,
    query(_table: string) {
      return {
        withIndex(_name: string, fn: (q: any) => any) {
          const constraints: Record<string, unknown> = {};
          const q = {
            eq(field: string, val: unknown) {
              constraints[field] = val;
              return q;
            },
          };
          fn(q);
          const matches = rows.filter((r) =>
            Object.entries(constraints).every(([k, v]) => (r as any)[k] === v),
          );
          return {
            first: async () => matches[0] ?? null,
            collect: async () => matches,
          };
        },
      };
    },
    insert(_table: string, doc: Record<string, unknown>) {
      const _id = `id_${rows.length}`;
      rows.push({ ...doc, _id });
      return _id;
    },
  };
}

describe("Req 11.1 — prompt-input safety classification", () => {
  it("drops memory beats that fail the safety classifier, keeps safe ones", () => {
    const beats = [
      "A locked door waits.",
      "The narration says your life is pointless.", // safe_end → not allowed
      "You find a brass key.",
    ];
    expect(guardMemoryBeats(beats, generationContext)).toEqual([
      "A locked door waits.",
      "You find a brass key.",
    ]);
  });

  it("passes empty beats through without classifying", () => {
    expect(guardMemoryBeats(["", "   "], generationContext)).toEqual(["", "   "]);
  });

  it("blanks a seed that fails the classifier and preserves a safe seed", () => {
    expect(guardSeedText("You deserve to suffer.", generationContext)).toBe("");
    expect(guardSeedText("A quiet harbor at dawn.", generationContext)).toBe(
      "A quiet harbor at dawn.",
    );
    expect(guardSeedText("", generationContext)).toBe("");
  });
});

describe("Req 14.4 — idempotent turn replay", () => {
  const now = 1_000_000;

  it("returns null when no record exists for the request", async () => {
    const ctx = { db: makeIdemDb() };
    expect(
      await readIdempotentTurnResult(ctx, "submitChoice", "req_1", "acct", "s1", now),
    ).toBeNull();
  });

  it("returns the stored result for a duplicate request within the TTL", async () => {
    const ctx = { db: makeIdemDb() };
    const result = { saveId: "s1", sceneId: "sc1", prose: "..." };
    await recordIdempotentTurnResult(ctx, {
      scope: "submitChoice",
      requestId: "req_1",
      accountId: "acct",
      saveId: "s1",
      result,
      now,
    });
    expect(
      await readIdempotentTurnResult(ctx, "submitChoice", "req_1", "acct", "s1", now + 5_000),
    ).toEqual(result);
  });

  it("does NOT replay a record belonging to a different account or save", async () => {
    const ctx = { db: makeIdemDb() };
    await recordIdempotentTurnResult(ctx, {
      scope: "submitChoice",
      requestId: "shared_req",
      accountId: "acctA",
      saveId: "sA",
      result: { leak: "A's scene" },
      now,
    });
    // Different account reusing the same requestId → miss (no cross-account leak).
    expect(
      await readIdempotentTurnResult(ctx, "submitChoice", "shared_req", "acctB", "sA", now + 1_000),
    ).toBeNull();
    // Same account, different save → miss (wrong-save scene not returned).
    expect(
      await readIdempotentTurnResult(ctx, "submitChoice", "shared_req", "acctA", "sB", now + 1_000),
    ).toBeNull();
    // Exact match → hit.
    expect(
      await readIdempotentTurnResult(ctx, "submitChoice", "shared_req", "acctA", "sA", now + 1_000),
    ).toEqual({ leak: "A's scene" });
  });

  it("ignores an expired record (past the 60s TTL)", async () => {
    const ctx = { db: makeIdemDb() };
    await recordIdempotentTurnResult(ctx, {
      scope: "submitChoice",
      requestId: "req_1",
      accountId: "acct",
      saveId: "s1",
      result: { ok: true },
      now,
    });
    // 61s later the record has expired.
    expect(
      await readIdempotentTurnResult(ctx, "submitChoice", "req_1", "acct", "s1", now + 61_000),
    ).toBeNull();
  });

  it("scopes records by (scope, requestId) so different mutations don't collide", async () => {
    const ctx = { db: makeIdemDb() };
    await recordIdempotentTurnResult(ctx, {
      scope: "submitChoice",
      requestId: "req_1",
      accountId: "acct",
      saveId: "s1",
      result: { from: "submitChoice" },
      now,
    });
    // Same requestId, different scope → no hit.
    expect(
      await readIdempotentTurnResult(
        ctx,
        "beginStreamingChoice",
        "req_1",
        "acct",
        "s1",
        now + 1_000,
      ),
    ).toBeNull();
    expect(
      await readIdempotentTurnResult(ctx, "submitChoice", "req_1", "acct", "s1", now + 1_000),
    ).toEqual({ from: "submitChoice" });
  });
});
