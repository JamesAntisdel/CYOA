import { describe, expect, it } from "vitest";

import type {
  RemoteArc,
  RemoteChoice,
  RemoteCodexEntry,
  RemoteRecentDiff,
} from "../gameApi";
import {
  adaptArc,
  adaptCodex,
  adaptRemoteChoice,
  candleBar,
  candleSegments,
  CANDLE_FLAME_THRESHOLD,
  checkBannerModel,
  checkChipLabel,
  checkOutcomeWord,
  checkResultFromDiffs,
  codexNewestFirst,
  diffToChip,
  dispositionBandWord,
  hasNewCodexTruth,
  npcTrendsFromDiffs,
  trendArrow,
} from "../storyEngagement";

// ---------------------------------------------------------------------------
// W2-C1 — CheckChip odds render + CheckBanner mapping.
// ---------------------------------------------------------------------------

describe("W2-C1 check chip + banner", () => {
  it("renders the odds phrase, never raw math (BC10)", () => {
    expect(
      checkChipLabel({ statId: "nerve", label: "Nerve", difficulty: "risky", odds: "risky" }),
    ).toBe("⚄ Nerve — risky");
    expect(
      checkChipLabel({ statId: "insight", label: "Insight", difficulty: "easy", odds: "likely" }),
    ).toBe("⚄ Insight — likely");
  });

  it("maps every outcome to a banner stamp + tone", () => {
    expect(checkBannerModel({ outcome: "success", statId: "nerve", margin: 3 })).toMatchObject({
      stamp: "Success",
      tone: "positive",
      phrase: "with room to spare",
    });
    expect(checkBannerModel({ outcome: "success", statId: "nerve", margin: 1 }).phrase).toBe(
      "by a hair",
    );
    expect(checkBannerModel({ outcome: "partial", statId: "nerve", margin: 0 })).toMatchObject({
      stamp: "Partial",
      tone: "neutral",
    });
    expect(checkBannerModel({ outcome: "fail", statId: "nerve", margin: -1 })).toMatchObject({
      stamp: "Failed",
      tone: "negative",
      phrase: "by a hair",
    });
    expect(checkBannerModel({ outcome: "fail", statId: "nerve", margin: -4 }).phrase).toBe(
      "outright",
    );
  });

  it("extracts a resolved-check record from the turn's diffs", () => {
    const diffs: RemoteRecentDiff[] = [
      { kind: "stat", statId: "nerve", label: "Nerve", delta: 1 },
      { kind: "check", outcome: "partial", statId: "nerve", margin: -1 },
    ];
    expect(checkResultFromDiffs(diffs)).toEqual({ outcome: "partial", statId: "nerve", margin: -1 });
    expect(checkResultFromDiffs([])).toBeNull();
    expect(checkResultFromDiffs(undefined)).toBeNull();
  });

  it("suppresses the check chip on a locked choice card", () => {
    const base = (over: Partial<RemoteChoice>): RemoteChoice => ({
      choice: { id: "c1", label: "Force the lock" },
      visibility: "visible",
      ...over,
    });
    const check = { statId: "nerve", label: "Nerve", difficulty: "risky" as const, odds: "risky" as const };
    expect(adaptRemoteChoice(base({ check })).check).toEqual(check);
    // A locked choice never advertises odds — the door isn't open.
    const locked = adaptRemoteChoice(base({ state: "locked", check }));
    expect(locked.locked).toBe(true);
    expect(locked).not.toHaveProperty("check");
  });

  it("has a word for each outcome", () => {
    expect(checkOutcomeWord("success")).toBe("cleared");
    expect(checkOutcomeWord("partial")).toBe("strained");
    expect(checkOutcomeWord("fail")).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// W2-C2 — Candle segment math.
// ---------------------------------------------------------------------------

describe("W2-C2 candle segment math", () => {
  it("computes filled/empty/pct and clamps", () => {
    expect(candleSegments(3, 4)).toMatchObject({ filled: 3, empty: 1, total: 4, pct: 0.75 });
    expect(candleSegments(0, 4)).toMatchObject({ filled: 0, empty: 4, pct: 0 });
    // value clamped to max, fired never negative
    expect(candleSegments(9, 4).filled).toBe(4);
    expect(candleSegments(-2, 4).filled).toBe(0);
  });

  it("never divides by zero on a zero/absent max", () => {
    const m = candleSegments(0, 0);
    expect(m).toMatchObject({ filled: 0, empty: 0, total: 0, pct: 0, flame: false });
  });

  it("lights the flame at ≥75% burned", () => {
    expect(candleSegments(2, 4).flame).toBe(false); // 50%
    expect(candleSegments(3, 4).flame).toBe(true); // 75%
    expect(candleSegments(4, 4).flame).toBe(true); // 100%
    expect(CANDLE_FLAME_THRESHOLD).toBe(0.75);
  });

  it("renders a burned/standing glyph bar", () => {
    expect(candleBar(3, 4)).toBe("▮▮▮▯");
    expect(candleBar(0, 3)).toBe("▯▯▯");
  });
});

// ---------------------------------------------------------------------------
// W2-C3 — NPC pip band mapping + roster trends.
// ---------------------------------------------------------------------------

describe("W2-C3 npc pips + trends", () => {
  it("maps a disposition band to a mood word + arrow", () => {
    expect(dispositionBandWord("up")).toBe("warmer");
    expect(dispositionBandWord("down")).toBe("cooler");
    expect(trendArrow("up")).toBe("▴");
    expect(trendArrow("down")).toBe("▾");
  });

  it("derives a per-NPC trend map from npc diffs (latest wins)", () => {
    const diffs: RemoteRecentDiff[] = [
      { kind: "npc", npcId: "mira", name: "Mira", deltaBand: "down", fact: null },
      { kind: "npc", npcId: "bram", name: "Bram", deltaBand: "up", fact: null },
      { kind: "npc", npcId: "mira", name: "Mira", deltaBand: "up", fact: null },
    ];
    expect(npcTrendsFromDiffs(diffs)).toEqual({ mira: "up", bram: "up" });
    expect(npcTrendsFromDiffs(undefined)).toEqual({});
  });

  it("renders a disposition-shift echo chip vs a fact-learned chip", () => {
    const shift = diffToChip({ kind: "npc", npcId: "mira", name: "Mira", deltaBand: "down", fact: null });
    expect(shift).toEqual({ text: "Mira ▾ cooler", tone: "negative" });
    const fact = diffToChip({
      kind: "npc",
      npcId: "mira",
      name: "Mira",
      deltaBand: "up",
      fact: "you lied about the key",
    });
    expect(fact).toEqual({ text: "Mira will remember that", tone: "neutral" });
  });
});

// ---------------------------------------------------------------------------
// W2 echo chips (clock / check) + codex.
// ---------------------------------------------------------------------------

describe("W2 clock + check echo chips", () => {
  it("shows the clock reason as the echo chip", () => {
    expect(diffToChip({ kind: "clock", amount: 2, reason: "the ritual nears its hour" })).toEqual({
      text: "🕯 the ritual nears its hour",
      tone: "negative",
    });
    // reason-less advance still narrates
    expect(diffToChip({ kind: "clock", amount: 1, reason: "" })).toEqual({
      text: "🕯 the hour presses on",
      tone: "negative",
    });
  });

  it("stamps the check outcome word", () => {
    expect(diffToChip({ kind: "check", outcome: "success", statId: "nerve", margin: 2 })).toEqual({
      text: "⚄ cleared",
      tone: "positive",
    });
    expect(diffToChip({ kind: "check", outcome: "fail", statId: "nerve", margin: -3 })).toEqual({
      text: "⚄ failed",
      tone: "negative",
    });
  });
});

describe("W2-C4 codex list model", () => {
  const codex: RemoteCodexEntry[] = [
    { flag: "knows_truth", text: "The abbot lied about the fire.", turnNumber: 4 },
    { flag: "found_key", text: "The bone key opens the crypt.", turnNumber: 2 },
    { flag: "made_vow", text: "You swore to return.", turnNumber: 4 },
  ];

  it("adapts null → undefined", () => {
    expect(adaptCodex(null)).toBeUndefined();
    expect(adaptCodex(undefined)).toBeUndefined();
    expect(adaptCodex(codex)).toBe(codex);
  });

  it("orders newest-first, stable within a turn", () => {
    const ordered = codexNewestFirst(codex);
    expect(ordered.map((e) => e.flag)).toEqual(["knows_truth", "made_vow", "found_key"]);
    expect(codexNewestFirst(undefined)).toEqual([]);
  });

  it("detects a truth recorded on the current turn (pip gate)", () => {
    expect(hasNewCodexTruth(codex, 4)).toBe(true);
    expect(hasNewCodexTruth(codex, 3)).toBe(false);
    expect(hasNewCodexTruth(codex, undefined)).toBe(false);
    expect(hasNewCodexTruth([], 4)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// W1 arc-drawer completion — want / stakes / fired-beats survive adaptation.
// ---------------------------------------------------------------------------

describe("W1 arc drawer field rendering", () => {
  it("preserves want / stakes / fired-beats through adaptArc", () => {
    const arc: RemoteArc = {
      dramaticQuestion: "Will you unmake the oath?",
      act: 2,
      actLabel: "The Reckoning",
      beatsFired: 2,
      beatsTotal: 4,
      threadsPending: 1,
      protagonistWant: "to be free of the vow",
      stakes: "your name struck from the tome",
      firedBeats: [
        { label: "The oath is spoken", turnNumber: 1 },
        { label: "The first crack", turnNumber: 5 },
      ],
      clock: { label: "The Vigil", value: 3, max: 4 },
    };
    const adapted = adaptArc(arc)!;
    expect(adapted.protagonistWant).toBe("to be free of the vow");
    expect(adapted.stakes).toBe("your name struck from the tome");
    expect(adapted.firedBeats).toHaveLength(2);
    expect(adapted.firedBeats![1]).toEqual({ label: "The first crack", turnNumber: 5 });
    // the drawer's candle reads its segments from this clock
    expect(candleSegments(adapted.clock!.value, adapted.clock!.max).flame).toBe(true);
  });
});
