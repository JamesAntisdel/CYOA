import { describe, expect, it } from "vitest";

import type { RemoteArc, RemoteChoice, RemoteRecentDiff } from "../gameApi";
import {
  actStampFromDiffs,
  adaptArc,
  adaptRecentDiffs,
  adaptRemoteChoice,
  beatDots,
  deriveSignedEcho,
  diffToChip,
  HIDDEN_ONLY_ECHO,
  NEUTRAL_ECHO,
  romanAct,
  signed,
  threadFiredInDiffs,
} from "../storyEngagement";

const MINUS = "−";

describe("signed / romanAct / beatDots", () => {
  it("signs deltas with a typographic minus", () => {
    expect(signed(2)).toBe("+2");
    expect(signed(-1)).toBe(`${MINUS}1`);
    expect(signed(0)).toBe("0");
  });

  it("romanizes acts and clamps below 1", () => {
    expect(romanAct(1)).toBe("I");
    expect(romanAct(2)).toBe("II");
    expect(romanAct(3)).toBe("III");
    expect(romanAct(0)).toBe("I");
    expect(romanAct(9)).toBe("9");
  });

  it("renders filled/empty beat dots and clamps fired to total", () => {
    expect(beatDots(2, 4)).toBe("●●○○");
    expect(beatDots(0, 3)).toBe("○○○");
    expect(beatDots(5, 3)).toBe("●●●"); // fired clamped to total
    expect(beatDots(-1, 2)).toBe("○○");
  });
});

describe("diffToChip mapping table (design §4.1)", () => {
  const cases: Array<{ name: string; diff: RemoteRecentDiff; text: string; tone: string }> = [
    { name: "stat gain", diff: { kind: "stat", statId: "nerve", label: "Nerve", delta: 2 }, text: "+2 Nerve", tone: "positive" },
    { name: "stat loss", diff: { kind: "stat", statId: "insight", label: "Insight", delta: -1 }, text: `${MINUS}1 Insight`, tone: "negative" },
    { name: "vitality uses heart glyph", diff: { kind: "stat", statId: "vitality", label: "Vitality", delta: -1 }, text: `${MINUS}1 ♥`, tone: "negative" },
    { name: "currency", diff: { kind: "currency", delta: -15 }, text: `${MINUS}15 coin`, tone: "negative" },
    { name: "item add", diff: { kind: "item", op: "add", label: "Bone Key" }, text: "+ Bone Key", tone: "positive" },
    { name: "item remove", diff: { kind: "item", op: "remove", label: "Torch" }, text: `${MINUS} Torch`, tone: "negative" },
    { name: "thread set", diff: { kind: "thread", op: "set", note: null }, text: "🧵 thread set", tone: "neutral" },
    { name: "thread fired reveals note", diff: { kind: "thread", op: "fired", note: "the debt comes due" }, text: "🧵 the debt comes due", tone: "neutral" },
    { name: "beat", diff: { kind: "beat", label: "The oath is broken" }, text: "⭑ The oath is broken", tone: "positive" },
    { name: "act", diff: { kind: "act", act: 2 }, text: "Act II", tone: "positive" },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const chip = diffToChip(c.diff);
      expect(chip).not.toBeNull();
      expect(chip!.text).toBe(c.text);
      expect(chip!.tone).toBe(c.tone);
    });
  }
});

describe("deriveSignedEcho", () => {
  it("joins up to three signed chips with a middot", () => {
    const diffs: RemoteRecentDiff[] = [
      { kind: "stat", statId: "nerve", label: "Nerve", delta: 2 },
      { kind: "stat", statId: "vitality", label: "Vitality", delta: -1 },
      { kind: "item", op: "add", label: "Bone Key" },
    ];
    const echo = deriveSignedEcho(diffs);
    expect(echo.text).toBe(`+2 Nerve · ${MINUS}1 ♥ · + Bone Key`);
    // any negative present ⇒ aggregate negative
    expect(echo.tone).toBe("negative");
  });

  it("caps the echo at three chips", () => {
    const diffs: RemoteRecentDiff[] = [
      { kind: "beat", label: "A" },
      { kind: "beat", label: "B" },
      { kind: "beat", label: "C" },
      { kind: "beat", label: "D" },
    ];
    expect(deriveSignedEcho(diffs).text).toBe("⭑ A · ⭑ B · ⭑ C");
  });

  it("aggregates to positive when only gains occur", () => {
    const echo = deriveSignedEcho([{ kind: "stat", statId: "nerve", label: "Nerve", delta: 1 }]);
    expect(echo.tone).toBe("positive");
  });

  it("hidden-only turn (present-but-empty diffs) collapses to 'something shifted…'", () => {
    const echo = deriveSignedEcho([]);
    expect(echo.text).toBe(HIDDEN_ONLY_ECHO);
    expect(echo.tone).toBe("neutral");
  });

  it("unknown-only kinds also collapse to hidden-only", () => {
    // A diff whose kind produces no chip (simulate a future/redacted kind).
    const weird = [{ kind: "mystery" } as unknown as RemoteRecentDiff];
    expect(deriveSignedEcho(weird).text).toBe(HIDDEN_ONLY_ECHO);
  });

  it("old turns (undefined diffs) fall back to a visible-stat snapshot", () => {
    const echo = deriveSignedEcho(undefined, [
      { label: "Nerve", value: 3 },
      { label: "Insight", value: 2 },
      { label: "Grit", value: 9 },
    ]);
    // only first two stats, snapshot form, neutral tone
    expect(echo.text).toBe("Nerve: 3 · Insight: 2");
    expect(echo.tone).toBe("neutral");
  });

  it("old turns with no stats fall back to the neutral echo", () => {
    expect(deriveSignedEcho(undefined, []).text).toBe(NEUTRAL_ECHO);
    expect(deriveSignedEcho(null).text).toBe(NEUTRAL_ECHO);
  });
});

describe("adaptRemoteChoice (render-state model)", () => {
  const base = (over: Partial<RemoteChoice>): RemoteChoice => ({
    choice: { id: "c1", label: "Open the door" },
    visibility: "visible",
    ...over,
  });

  it("maps a visible choice to an unlocked model", () => {
    expect(adaptRemoteChoice(base({}))).toEqual({
      id: "c1",
      label: "Open the door",
      locked: false,
    });
  });

  it("maps a locked choice with its in-world hint", () => {
    const model = adaptRemoteChoice(base({ visibility: "locked", lockedHint: "the door is barred" }));
    expect(model.locked).toBe(true);
    expect(model.hint).toBe("the door is barred");
  });

  it("prefers the §7 `state` field over legacy `visibility`", () => {
    // Server sends both during a mixed-version rollout: state wins.
    const model = adaptRemoteChoice(base({ visibility: "visible", state: "locked" }));
    expect(model.locked).toBe(true);
  });

  it("treats null lockedHint as absent (BC2/BC4)", () => {
    const model = adaptRemoteChoice(base({ visibility: "locked", lockedHint: null }));
    expect(model.locked).toBe(true);
    expect(model).not.toHaveProperty("hint");
  });
});

describe("boundary adapters (null → optional)", () => {
  it("adaptArc maps null to undefined", () => {
    expect(adaptArc(null)).toBeUndefined();
    expect(adaptArc(undefined)).toBeUndefined();
    const arc: RemoteArc = {
      dramaticQuestion: "Will you burn the bridge?",
      act: 2,
      actLabel: "The Reckoning",
      beatsFired: 1,
      beatsTotal: 4,
      threadsPending: 2,
    };
    expect(adaptArc(arc)).toBe(arc);
  });

  it("adaptRecentDiffs maps null to undefined", () => {
    expect(adaptRecentDiffs(null)).toBeUndefined();
    expect(adaptRecentDiffs(undefined)).toBeUndefined();
    const diffs: RemoteRecentDiff[] = [{ kind: "beat", label: "x" }];
    expect(adaptRecentDiffs(diffs)).toBe(diffs);
  });
});

describe("threads + act-stamp logic (W1-C5)", () => {
  it("detects a fired thread in the diffs", () => {
    expect(threadFiredInDiffs([{ kind: "thread", op: "fired", note: "x" }])).toBe(true);
    expect(threadFiredInDiffs([{ kind: "thread", op: "set", note: null }])).toBe(false);
    expect(threadFiredInDiffs([{ kind: "beat", label: "y" }])).toBe(false);
    expect(threadFiredInDiffs(undefined)).toBe(false);
    expect(threadFiredInDiffs([])).toBe(false);
  });

  it("produces an act stamp only when an act_advanced diff is present", () => {
    const arc: RemoteArc = {
      dramaticQuestion: "q",
      act: 2,
      actLabel: "The Reckoning",
      beatsFired: 1,
      beatsTotal: 4,
      threadsPending: 0,
    };
    expect(actStampFromDiffs([{ kind: "act", act: 2 }], arc)).toEqual({
      actNumber: 2,
      actLabel: "The Reckoning",
    });
  });

  it("omits the label when the arc has none, and returns null without an act diff", () => {
    expect(actStampFromDiffs([{ kind: "act", act: 3 }], undefined)).toEqual({ actNumber: 3 });
    expect(actStampFromDiffs([{ kind: "beat", label: "z" }], undefined)).toBeNull();
    expect(actStampFromDiffs(undefined, undefined)).toBeNull();
  });
});
