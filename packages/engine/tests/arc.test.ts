import { describe, expect, it } from "vitest";

import {
  advanceActIfDue,
  arcAllowsEnding,
  beatBandForTurn,
  fireBeat,
  findArcBeat,
  nextTargetBeat,
  normalizeEndingId,
  slugify,
  synthesizeFallbackArc,
  validateProposedArc,
  type ArcBeat,
  type StoryArc,
} from "../src";

function beat(overrides: Partial<ArcBeat> & Pick<ArcBeat, "id" | "kind" | "priorityHint">): ArcBeat {
  return {
    label: overrides.label ?? `${overrides.id} label`,
    requiredBeforeEnding: overrides.requiredBeforeEnding ?? false,
    status: overrides.status ?? "pending",
    ...overrides,
  };
}

function arc(beats: ArcBeat[], overrides: Partial<StoryArc> = {}): StoryArc {
  return {
    dramaticQuestion: "Will you ring the bell before the tower falls?",
    protagonistWant: "To silence the bell.",
    stakes: "The city drowns if you fail.",
    act: 1,
    beats,
    candidateEndings: [
      { id: "bell-holds", label: "The Bell Holds", hint: "You endure." },
      { id: "bell-falls", label: "The Bell Falls", hint: "You do not." },
    ],
    source: "llm",
    ...overrides,
  };
}

const threeBeatArc = () =>
  arc([
    beat({ id: "inciting-call", kind: "inciting", priorityHint: "early" }),
    beat({ id: "midpoint-turn", kind: "midpoint", priorityHint: "mid" }),
    beat({ id: "climax-reckoning", kind: "climax", priorityHint: "late", requiredBeforeEnding: true }),
  ]);

describe("slugify + beatBandForTurn", () => {
  it("sluggifies to bounded ascii tokens", () => {
    expect(slugify("The Call! That Cannot Be Refused")).toBe("the-call-that-cannot-be-refused");
    expect(slugify("a".repeat(60)).length).toBeLessThanOrEqual(48);
  });

  it.each([
    [0, "early"],
    [4, "early"],
    [5, "mid"],
    [9, "mid"],
    [10, "late"],
    [30, "late"],
  ] as const)("turn %i is band %s", (turn, band) => {
    expect(beatBandForTurn(turn)).toBe(band);
  });
});

describe("validateProposedArc", () => {
  it("clamps + sluggifies a well-formed proposal", () => {
    const result = validateProposedArc({
      dramaticQuestion: "Q".repeat(200),
      protagonistWant: "I want to live",
      stakes: "Everything is lost otherwise",
      act: 2,
      beats: [
        { id: "The Start", label: "Start", kind: "inciting", priorityHint: "early" },
        { id: "middle", label: "Middle", kind: "midpoint", priorityHint: "mid" },
        { id: "end", label: "End", kind: "climax", priorityHint: "late", requiredBeforeEnding: true },
      ],
      candidateEndings: [
        { id: "A win", label: "Win", hint: "good" },
        { id: "b", label: "Lose", hint: "bad" },
      ],
    });
    expect(result).not.toBeNull();
    expect(result?.dramaticQuestion.length).toBe(160);
    expect(result?.act).toBe(2);
    expect(result?.beats.map((b) => b.id)).toEqual(["the-start", "middle", "end"]);
    expect(result?.beats.every((b) => b.status === "pending")).toBe(true);
    expect(result?.candidateEndings.map((c) => c.id)).toEqual(["a-win", "b"]);
    expect(result?.source).toBe("llm");
  });

  it.each([
    ["not an object", "nope"],
    ["null", null],
    ["number", 5],
    ["short question", { dramaticQuestion: "hi", protagonistWant: "aaaaaaaa", stakes: "bbbbbbbb", beats: [], candidateEndings: [] }],
    [
      "too few beats",
      {
        dramaticQuestion: "A real question here?",
        protagonistWant: "want something",
        stakes: "lose something big",
        beats: [{ id: "a", label: "A", kind: "climax", priorityHint: "late" }],
        candidateEndings: [{ id: "x", label: "X", hint: "h" }, { id: "y", label: "Y", hint: "h" }],
      },
    ],
    [
      "too few candidates",
      {
        dramaticQuestion: "A real question here?",
        protagonistWant: "want something",
        stakes: "lose something big",
        beats: [
          { id: "a", label: "A", kind: "inciting", priorityHint: "early" },
          { id: "b", label: "B", kind: "midpoint", priorityHint: "mid" },
          { id: "c", label: "C", kind: "climax", priorityHint: "late" },
        ],
        candidateEndings: [{ id: "x", label: "X", hint: "h" }],
      },
    ],
  ])("returns null for %s", (_label, input) => {
    expect(validateProposedArc(input)).toBeNull();
  });

  it("promotes a climax beat to required when none is flagged", () => {
    const result = validateProposedArc({
      dramaticQuestion: "A real question here?",
      protagonistWant: "want something",
      stakes: "lose something big",
      beats: [
        { id: "a", label: "A", kind: "inciting", priorityHint: "early" },
        { id: "b", label: "B", kind: "midpoint", priorityHint: "mid" },
        { id: "c", label: "C", kind: "climax", priorityHint: "late" },
      ],
      candidateEndings: [{ id: "x", label: "X", hint: "h" }, { id: "y", label: "Y", hint: "h" }],
    });
    const climax = result?.beats.find((b) => b.kind === "climax");
    expect(climax?.requiredBeforeEnding).toBe(true);
  });

  it("promotes the last beat when there is no climax", () => {
    const result = validateProposedArc({
      dramaticQuestion: "A real question here?",
      protagonistWant: "want something",
      stakes: "lose something big",
      beats: [
        { id: "a", label: "A", kind: "inciting", priorityHint: "early" },
        { id: "b", label: "B", kind: "custom", priorityHint: "mid" },
        { id: "c", label: "C", kind: "custom", priorityHint: "late" },
      ],
      candidateEndings: [{ id: "x", label: "X", hint: "h" }, { id: "y", label: "Y", hint: "h" }],
    });
    expect(result?.beats[result.beats.length - 1]?.requiredBeforeEnding).toBe(true);
  });

  it("truncates to 5 beats / 4 candidates and drops duplicate ids", () => {
    const result = validateProposedArc({
      dramaticQuestion: "A real question here?",
      protagonistWant: "want something",
      stakes: "lose something big",
      beats: [
        { id: "a", label: "A", kind: "inciting", priorityHint: "early" },
        { id: "a", label: "dup", kind: "custom", priorityHint: "early" },
        { id: "b", label: "B", kind: "midpoint", priorityHint: "mid" },
        { id: "c", label: "C", kind: "custom", priorityHint: "mid" },
        { id: "d", label: "D", kind: "custom", priorityHint: "late" },
        { id: "e", label: "E", kind: "climax", priorityHint: "late", requiredBeforeEnding: true },
        { id: "f", label: "F", kind: "custom", priorityHint: "late" },
      ],
      candidateEndings: [
        { id: "1", label: "One", hint: "h" },
        { id: "2", label: "Two", hint: "h" },
        { id: "3", label: "Three", hint: "h" },
        { id: "4", label: "Four", hint: "h" },
        { id: "5", label: "Five", hint: "h" },
      ],
    });
    expect(result?.beats.map((b) => b.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(result?.candidateEndings).toHaveLength(4);
  });

  it.each([[7, 1], [2, 2], [3, 3]] as const)("clamps act %i to %i", (input, expected) => {
    const result = validateProposedArc({
      dramaticQuestion: "A real question here?",
      protagonistWant: "want something",
      stakes: "lose something big",
      act: input,
      beats: [
        { id: "a", label: "A", kind: "inciting", priorityHint: "early" },
        { id: "b", label: "B", kind: "midpoint", priorityHint: "mid" },
        { id: "c", label: "C", kind: "climax", priorityHint: "late", requiredBeforeEnding: true },
      ],
      candidateEndings: [{ id: "x", label: "X", hint: "h" }, { id: "y", label: "Y", hint: "h" }],
    });
    expect(result?.act).toBe(expected);
  });
});

describe("synthesizeFallbackArc", () => {
  it("produces a valid minimal arc with one required climax", () => {
    const result = synthesizeFallbackArc("A drowned cathedral rings a bell no one can silence.");
    expect(result.source).toBe("synthesized");
    expect(result.beats).toHaveLength(3);
    expect(result.beats.filter((b) => b.requiredBeforeEnding)).toHaveLength(1);
    expect(result.beats.find((b) => b.requiredBeforeEnding)?.kind).toBe("climax");
    expect(result.candidateEndings.length).toBeGreaterThanOrEqual(2);
    expect(result.dramaticQuestion.length).toBeGreaterThanOrEqual(8);
    expect(result.dramaticQuestion.length).toBeLessThanOrEqual(160);
  });

  it("handles an empty premise without producing a too-short question", () => {
    const result = synthesizeFallbackArc("");
    expect(result.dramaticQuestion.length).toBeGreaterThanOrEqual(8);
  });
});

describe("nextTargetBeat", () => {
  it("returns null when every beat has fired", () => {
    const a = arc(threeBeatArc().beats.map((b) => ({ ...b, status: "fired" as const })));
    expect(nextTargetBeat(a, 3)).toBeNull();
  });

  it("steers to the early beat in the early band", () => {
    expect(nextTargetBeat(threeBeatArc(), 1)?.id).toBe("inciting-call");
  });

  it("advances to the next due beat once the early beat has fired", () => {
    const a = threeBeatArc();
    a.beats[0]!.status = "fired";
    expect(nextTargetBeat(a, 6)?.id).toBe("midpoint-turn");
  });

  it("returns an overdue early beat even in a later band", () => {
    expect(nextTargetBeat(threeBeatArc(), 12)?.id).toBe("inciting-call");
  });

  it("falls back to the earliest upcoming beat when nothing is due yet", () => {
    const a = threeBeatArc();
    a.beats[0]!.status = "fired"; // early done; at turn 1 only early is "due"
    expect(nextTargetBeat(a, 1)?.id).toBe("midpoint-turn");
  });
});

describe("fireBeat", () => {
  it("fires a pending beat without mutating the input", () => {
    const before = threeBeatArc();
    const { arc: after, fired } = fireBeat(before, "midpoint-turn", 7);
    expect(fired).toBe(true);
    expect(after.beats.find((b) => b.id === "midpoint-turn")?.status).toBe("fired");
    expect(after.beats.find((b) => b.id === "midpoint-turn")?.firedAtTurn).toBe(7);
    expect(before.beats.find((b) => b.id === "midpoint-turn")?.status).toBe("pending");
  });

  it("is idempotent — re-firing does not change firedAtTurn", () => {
    const { arc: once } = fireBeat(threeBeatArc(), "midpoint-turn", 7);
    const { arc: twice, fired } = fireBeat(once, "midpoint-turn", 99);
    expect(fired).toBe(false);
    expect(twice.beats.find((b) => b.id === "midpoint-turn")?.firedAtTurn).toBe(7);
  });

  it("returns fired:false for an unknown id", () => {
    expect(fireBeat(threeBeatArc(), "no-such-beat", 3).fired).toBe(false);
  });

  it("matches a raw (non-slug) beat id by sluggifying", () => {
    expect(fireBeat(threeBeatArc(), "Midpoint Turn", 4).fired).toBe(true);
    expect(findArcBeat(threeBeatArc(), "Inciting Call")?.id).toBe("inciting-call");
  });
});

describe("advanceActIfDue", () => {
  it("stays put and returns the same reference when nothing is due", () => {
    const a = threeBeatArc();
    expect(advanceActIfDue(a)).toBe(a);
  });

  it("advances 1→2 when the inciting beat fires", () => {
    const a = fireBeat(threeBeatArc(), "inciting-call", 2).arc;
    expect(advanceActIfDue(a).act).toBe(2);
    expect(advanceActIfDue(a).actLabel).toBeDefined();
  });

  it("advances 2→3 when the midpoint fires", () => {
    let a = fireBeat(threeBeatArc(), "inciting-call", 2).arc;
    a = advanceActIfDue(a); // act 2
    a = fireBeat(a, "midpoint-turn", 6).arc;
    expect(advanceActIfDue(a).act).toBe(3);
  });

  it("advances 2→3 when two mid-priority beats fire", () => {
    const a = arc([
      beat({ id: "b1", kind: "inciting", priorityHint: "early", status: "fired" }),
      beat({ id: "b2", kind: "custom", priorityHint: "mid", status: "fired" }),
      beat({ id: "b3", kind: "custom", priorityHint: "mid", status: "fired" }),
      beat({ id: "b4", kind: "climax", priorityHint: "late", requiredBeforeEnding: true }),
    ], { act: 2 });
    expect(advanceActIfDue(a).act).toBe(3);
  });

  it("jumps straight to act 3 when inciting + midpoint both fired", () => {
    let a = fireBeat(threeBeatArc(), "inciting-call", 2).arc;
    a = fireBeat(a, "midpoint-turn", 3).arc;
    expect(advanceActIfDue(a).act).toBe(3);
  });
});

describe("arcAllowsEnding", () => {
  it("is false while a required beat is unfired", () => {
    expect(arcAllowsEnding(threeBeatArc())).toBe(false);
  });

  it("is true once all required beats have fired", () => {
    const a = fireBeat(threeBeatArc(), "climax-reckoning", 12).arc;
    expect(arcAllowsEnding(a)).toBe(true);
  });
});

describe("normalizeEndingId", () => {
  it("maps an exact slug to the candidate id", () => {
    expect(normalizeEndingId(threeBeatArc(), "Bell Holds")).toBe("bell-holds");
  });

  it("maps a near-miss typo via edit distance", () => {
    expect(normalizeEndingId(threeBeatArc(), "bell-fell")).toBe("bell-falls");
  });

  it("maps by substring containment", () => {
    expect(normalizeEndingId(threeBeatArc(), "holds")).toBe("bell-holds");
  });

  it("keeps an unrelated freeform id", () => {
    expect(normalizeEndingId(threeBeatArc(), "a-completely-different-ending")).toBe(
      "a-completely-different-ending",
    );
  });

  it("returns the proposed id unchanged when it sluggifies to empty", () => {
    expect(normalizeEndingId(threeBeatArc(), "!!!")).toBe("!!!");
  });
});
