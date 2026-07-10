import { describe, expect, it, vi } from "vitest";

import {
  guardEarlyTerminal,
  lastSentencesExcerpt,
  loadMemoryWindow,
  memoryBeatFromHistory,
  MIN_TURN_BEFORE_TERMINAL,
  pickSceneProse,
} from "../game";
import type { LlmSceneProposal } from "@cyoa/engine";

function proposal(overrides: Partial<LlmSceneProposal> = {}): LlmSceneProposal {
  return {
    prose: "A door closes behind you.",
    choices: [
      { id: "look", label: "Look around" },
      { id: "wait", label: "Wait in silence" },
    ],
    terminal: null,
    ...overrides,
  } as LlmSceneProposal;
}

/**
 * Fake db harness for `loadMemoryWindow`. The function only uses two index
 * lookups: turn_history `by_save_turn` (order desc, take N) and scenes
 * `by_save_turn` (eq saveId + turnNumber). Both flows are mocked here so
 * the test exercises the join + excerpt logic without spinning up Convex.
 */
type Row = Record<string, unknown>;
function makeDb(input: { history: Row[]; scenes: Row[] }) {
  return {
    query(table: string) {
      const rows = table === "turn_history" ? input.history : input.scenes;
      // Track which equality filters were applied so we can match on
      // (saveId, turnNumber) for scenes and (saveId) for turn_history.
      const filters: Record<string, unknown> = {};
      const builder: any = {
        withIndex(_name: string, fn: (q: any) => any) {
          fn({
            eq(field: string, value: unknown) {
              filters[field] = value;
              return this;
            },
          });
          return builder;
        },
        order(_dir: "asc" | "desc") {
          return builder;
        },
        async take(n: number) {
          const matched = rows.filter((row) =>
            Object.entries(filters).every(([k, v]) => row[k] === v),
          );
          return matched
            .slice()
            .sort((a, b) => Number(b.turnNumber) - Number(a.turnNumber))
            .slice(0, n);
        },
        async first() {
          return (
            rows.find((row) =>
              Object.entries(filters).every(([k, v]) => row[k] === v),
            ) ?? null
          );
        },
      };
      return builder;
    },
  };
}

describe("guardEarlyTerminal (min-turns-before-terminal guard)", () => {
  it("drops a death terminal before the floor and logs the drop", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const guarded = guardEarlyTerminal(
      proposal({ terminal: { kind: "death", endingId: "ending-dust" } }),
      2,
    );
    expect(guarded.terminal).toBeNull();
    expect(log).toHaveBeenCalledWith(
      `[engine] dropped early terminal at turn 2, min is ${MIN_TURN_BEFORE_TERMINAL}`,
    );
    log.mockRestore();
  });

  it("drops a success terminal before the floor", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const guarded = guardEarlyTerminal(
      proposal({ terminal: { kind: "success", endingId: "ending-crown" } }),
      MIN_TURN_BEFORE_TERMINAL - 1,
    );
    expect(guarded.terminal).toBeNull();
    log.mockRestore();
  });

  it("permits a safety-driven terminal even on turn 1 (Requirement 11)", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const guarded = guardEarlyTerminal(
      proposal({ terminal: { kind: "safe", endingId: "ending-safe" } }),
      1,
    );
    expect(guarded.terminal).toEqual({ kind: "safe", endingId: "ending-safe" });
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("permits a non-safety terminal once the floor is reached", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const guarded = guardEarlyTerminal(
      proposal({ terminal: { kind: "death", endingId: "ending-dust" } }),
      MIN_TURN_BEFORE_TERMINAL,
    );
    expect(guarded.terminal).toEqual({ kind: "death", endingId: "ending-dust" });
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("passes through proposals without a terminal", () => {
    const p = proposal({ terminal: null });
    expect(guardEarlyTerminal(p, 1)).toBe(p);
  });
});

describe("lastSentencesExcerpt", () => {
  it("returns the input unchanged when below the cap", () => {
    expect(lastSentencesExcerpt("She opened the door.", 200)).toBe("She opened the door.");
  });

  it("returns empty for empty input", () => {
    expect(lastSentencesExcerpt("   ", 200)).toBe("");
  });

  it("keeps the last sentence(s) under the cap, preferring complete sentences", () => {
    const prose =
      "The lighthouse beam swept the cliffs. A foghorn answered from below. " +
      "She tightened her coat and stepped onto the path. The wind carried the smell of brine and burning kelp.";
    const out = lastSentencesExcerpt(prose, 80);
    // 80-char cap must keep at least one complete trailing sentence.
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out).toContain("The wind carried");
    // No mid-sentence cuts unless a single sentence overshoots.
    expect(out.endsWith(".") || out.endsWith("…")).toBe(true);
  });

  it("hard-trims with an ellipsis when prose has no sentence terminators", () => {
    const longFragment = "x".repeat(500);
    const out = lastSentencesExcerpt(longFragment, 50);
    expect(out).toMatch(/x+…$/);
    expect(out.length).toBeLessThanOrEqual(50);
  });

  it("hard-trims a single overshoot sentence with an ellipsis", () => {
    const prose = "x".repeat(220) + ".";
    const out = lastSentencesExcerpt(prose, 50);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(50);
  });
});

describe("pickSceneProse", () => {
  it("returns empty when the scene row is null", () => {
    expect(pickSceneProse(null)).toBe("");
  });

  it("prefers proposal.prose when present", () => {
    const out = pickSceneProse({
      prose: "fallback",
      proposal: { prose: "structured prose wins" },
    });
    expect(out).toBe("structured prose wins");
  });

  it("falls back to the top-level prose field when proposal.prose is absent", () => {
    expect(pickSceneProse({ prose: "deterministic prose" })).toBe("deterministic prose");
  });

  it("returns empty string for missing/wrong-typed prose fields", () => {
    expect(pickSceneProse({ prose: 42 })).toBe("");
    expect(pickSceneProse({})).toBe("");
    expect(pickSceneProse({ proposal: { prose: 5 }, prose: "ok" })).toBe("ok");
  });
});

describe("memoryBeatFromHistory (scene-prose excerpts)", () => {
  it("returns null when required fields are missing", () => {
    expect(memoryBeatFromHistory({}, null)).toBeNull();
    expect(memoryBeatFromHistory({ turnNumber: 1 }, null)).toBeNull();
  });

  it("includes a scene-prose excerpt and the choice label", () => {
    const beat = memoryBeatFromHistory(
      { turnNumber: 3, choiceId: "look", choiceLabel: "Look around" },
      { prose: "Rain hammered the deck. The captain swore under her breath." },
    );
    expect(beat).not.toBeNull();
    expect(beat!.turnNumber).toBe(3);
    expect(beat!.text).toContain("Turn 3:");
    expect(beat!.text).toContain("captain swore under her breath");
    expect(beat!.text).toContain('Chose "Look around"');
  });

  it("falls back to a choice-only beat when no scene prose is available", () => {
    const beat = memoryBeatFromHistory(
      { turnNumber: 1, choiceId: "wait", choiceLabel: "Wait" },
      null,
    );
    expect(beat!.text).toBe('Turn 1: chose "Wait".');
  });

  it("falls back to choiceId when choiceLabel is absent", () => {
    const beat = memoryBeatFromHistory(
      { turnNumber: 2, choiceId: "raw-choice-id" },
      { prose: "A short scene." },
    );
    expect(beat!.text).toContain('Chose "raw-choice-id"');
  });
});

describe("loadMemoryWindow (joins scene prose into beats)", () => {
  it("composes beats that carry the prior scene's prose, ordered oldest → newest with seed appended", async () => {
    const history: Row[] = [
      {
        _id: "h1",
        saveId: "save_x",
        turnNumber: 1,
        choiceId: "open",
        choiceLabel: "Open the door",
      },
      {
        _id: "h2",
        saveId: "save_x",
        turnNumber: 2,
        choiceId: "follow",
        choiceLabel: "Follow the voice",
      },
    ];
    const scenes: Row[] = [
      {
        saveId: "save_x",
        turnNumber: 1,
        prose: "The hinges shrieked. Cold air poured into the hallway.",
      },
      {
        saveId: "save_x",
        turnNumber: 2,
        proposal: {
          prose:
            "Footsteps echoed somewhere ahead. The voice came again — closer now, and angry.",
        },
      },
    ];
    const db = makeDb({ history, scenes });
    const window = await loadMemoryWindow({ db } as any, "save_x", "fresh seed", 6);
    // buildMemoryWindow selects the most-recent N beats, then emits them
    // oldest → newest so the narrator reads them chronologically, with the
    // current seed appended last.
    expect(window).toHaveLength(3);
    expect(window[0]).toContain("Turn 1:");
    expect(window[0]).toContain("Cold air poured into the hallway");
    expect(window[0]).toContain('Chose "Open the door"');
    expect(window[1]).toContain("Turn 2:");
    expect(window[1]).toContain("closer now, and angry");
    expect(window[1]).toContain('Chose "Follow the voice"');
    expect(window[2]).toBe("fresh seed");
  });

  it("tolerates rows whose scene record is missing without dropping the beat", async () => {
    const history: Row[] = [
      {
        _id: "h1",
        saveId: "save_y",
        turnNumber: 1,
        choiceId: "wait",
        choiceLabel: "Wait",
      },
    ];
    const db = makeDb({ history, scenes: [] });
    const window = await loadMemoryWindow({ db } as any, "save_y", "seed", 6);
    // Beat still produced, just without the scene excerpt.
    expect(window).toHaveLength(2);
    expect(window[0]).toBe('Turn 1: chose "Wait".');
    expect(window[1]).toBe("seed");
  });

  it("skips beats whose turn_history row lacks turnNumber", async () => {
    const history: Row[] = [
      { _id: "broken", saveId: "save_z", choiceId: "x" },
    ];
    const db = makeDb({ history, scenes: [] });
    const window = await loadMemoryWindow({ db } as any, "save_z", "seed", 6);
    // Only the seed comes through.
    expect(window).toEqual(["seed"]);
  });
});
