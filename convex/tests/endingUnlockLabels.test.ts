// Panel review (real trophy labels): recordEndingUnlock persists a human
// `label` (the matched arc candidateEnding's, else a title-cased endingId)
// and a short `pathLabels` choice hint onto the endings_unlocked row. Both
// fields are optional — legacy rows keep rendering via the client fallback
// (apps/app/lib/endingLabels.ts).

import { describe, expect, it } from "vitest";

import type { UnlockedEnding } from "@cyoa/engine";

import { recordEndingUnlock, resolveEndingLabel } from "../game";

type Insert = { table: string; doc: Record<string, unknown> };

function fakeCtx(
  opts: {
    existing?: Record<string, unknown> | null;
    turnRows?: Array<Record<string, unknown>>;
  } = {},
) {
  const inserts: Insert[] = [];
  const ctx = {
    db: {
      query: (table: string) => {
        if (table === "endings_unlocked") {
          return {
            withIndex: () => ({ first: async () => opts.existing ?? null }),
          };
        }
        if (table === "turn_history") {
          return {
            withIndex: () => ({
              order: () => ({
                take: async (n: number) => (opts.turnRows ?? []).slice(0, n),
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
      insert: async (table: string, doc: Record<string, unknown>) => {
        inserts.push({ table, doc });
        return `${table}_1`;
      },
    },
  };
  return { ctx, inserts };
}

function endingInsert(inserts: Insert[]): Record<string, unknown> {
  const row = inserts.find((i) => i.table === "endings_unlocked");
  expect(row).toBeDefined();
  return row!.doc;
}

function unlock(endingId: string): UnlockedEnding {
  return {
    storyId: "open-canvas",
    endingId,
    firstSeenTurn: 9,
    mode: "story",
    path: ["start", "open-canvas:llm:1", "open-canvas:llm:2"],
  };
}

const ARC = {
  candidateEndings: [
    { id: "drowned-crown", label: "The Drowned Crown", hint: "the water wins" },
    { id: "risen-city", label: "The Risen City" },
  ],
};

// turn_history rows as the by_accountId desc read returns them: newest first.
// Blank labels and rows from a different save must be skipped; only the last
// three readable labels of the anchor save survive, oldest→newest.
const TURN_ROWS = [
  { saveId: "save_a", turnNumber: 9, choiceLabel: "Ring the last bell" },
  { saveId: "save_a", turnNumber: 8, choiceLabel: "   " },
  { saveId: "save_a", turnNumber: 7, choiceLabel: "Strike the bargain" },
  { saveId: "save_b", turnNumber: 12, choiceLabel: "A different save" },
  { saveId: "save_a", turnNumber: 6, choiceLabel: "Dive into the flooded nave" },
  { saveId: "save_a", turnNumber: 5, choiceLabel: "Too old to make the hint" },
];

describe("recordEndingUnlock label + pathLabels persistence (panel review)", () => {
  it("persists the matched candidateEnding label and the choice-label path hint", async () => {
    const { ctx, inserts } = fakeCtx({ turnRows: TURN_ROWS });
    await recordEndingUnlock(ctx, {
      accountId: "acct_1",
      unlock: unlock("drowned-crown"),
      safetyEnding: false,
      arc: ARC,
      storyId: "open-canvas",
      turnNumber: 9,
      now: 1,
    });
    const doc = endingInsert(inserts);
    expect(doc.endingId).toBe("drowned-crown");
    expect(doc.label).toBe("The Drowned Crown");
    expect(doc.pathLabels).toEqual([
      "Dive into the flooded nave",
      "Strike the bargain",
      "Ring the last bell",
    ]);
  });

  it("falls back to a title-cased endingId when no candidate matches", async () => {
    const { ctx, inserts } = fakeCtx({ turnRows: TURN_ROWS });
    await recordEndingUnlock(ctx, {
      accountId: "acct_1",
      unlock: unlock("grim-harvest"),
      safetyEnding: false,
      arc: ARC,
      now: 1,
    });
    expect(endingInsert(inserts).label).toBe("Grim Harvest");
  });

  it("omits label for machine-id endings with no candidate", async () => {
    const { ctx, inserts } = fakeCtx({ turnRows: TURN_ROWS });
    await recordEndingUnlock(ctx, {
      accountId: "acct_1",
      unlock: unlock("open-canvas:llm:7"),
      safetyEnding: false,
      arc: ARC,
      now: 1,
    });
    const doc = endingInsert(inserts);
    expect("label" in doc).toBe(false);
    // The choice-label hint still lands — it doesn't depend on the ending id.
    expect(doc.pathLabels).toEqual([
      "Dive into the flooded nave",
      "Strike the bargain",
      "Ring the last bell",
    ]);
  });

  it("omits label on safety-forced exits (fixed client-side title)", async () => {
    const { ctx, inserts } = fakeCtx({ turnRows: TURN_ROWS });
    await recordEndingUnlock(ctx, {
      accountId: "acct_1",
      unlock: unlock("ending-safe"),
      safetyEnding: true,
      now: 1,
    });
    const doc = endingInsert(inserts);
    expect("label" in doc).toBe(false);
    expect(doc.safetyEnding).toBe(true);
  });

  it("omits pathLabels when no turn history exists (legacy / opening deaths)", async () => {
    const { ctx, inserts } = fakeCtx({ turnRows: [] });
    await recordEndingUnlock(ctx, {
      accountId: "acct_1",
      unlock: unlock("grim-harvest"),
      safetyEnding: false,
      now: 1,
    });
    const doc = endingInsert(inserts);
    expect("pathLabels" in doc).toBe(false);
    expect(doc.label).toBe("Grim Harvest");
  });

  it("keeps the first-seen row intact — no insert when the ending already exists", async () => {
    const { ctx, inserts } = fakeCtx({
      existing: { endingId: "drowned-crown" },
      turnRows: TURN_ROWS,
    });
    await recordEndingUnlock(ctx, {
      accountId: "acct_1",
      unlock: unlock("drowned-crown"),
      safetyEnding: false,
      arc: ARC,
      now: 1,
    });
    expect(inserts).toHaveLength(0);
  });
});

describe("resolveEndingLabel", () => {
  it("trims and clamps the candidate label", () => {
    const label = resolveEndingLabel({
      endingId: "long-tail",
      safetyEnding: false,
      arc: { candidateEndings: [{ id: "long-tail", label: `  ${"x".repeat(200)}  ` }] },
    });
    expect(label).toBe("x".repeat(120));
  });

  it("keeps only the final readable segment of namespaced ids", () => {
    expect(
      resolveEndingLabel({ endingId: "bone-cathedral:last-rite", safetyEnding: false }),
    ).toBe("Last Rite");
  });
});
