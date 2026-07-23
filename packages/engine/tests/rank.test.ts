import { describe, expect, it } from "vitest";

// `librarianRank` reaches the barrel via the arc.ts W3 bridge re-export (see
// HANDOFF) — import through the package entry like the rest of the suite.
import { librarianRank } from "../src";
// `rankProgress` is a new export (act-mementos R3.1). Its barrel re-export is
// integrator-owned (arc.ts W3 bridge / index.ts, BC7) and not yet wired, so
// import it directly from the module under test.
import type { LibrarianRank } from "../src/rank";
import { rankProgress } from "../src/rank";

describe("librarianRank (W3-M4 threshold table)", () => {
  it("returns novice at zero and below any threshold", () => {
    expect(librarianRank({ endings: 0, beats: 0, tales: 0 }).tier).toBe("novice");
    expect(librarianRank({ endings: 2, beats: 50, tales: 50 }).tier).toBe("novice");
  });

  it("promotes to keeper at ≥3 endings", () => {
    expect(librarianRank({ endings: 3, beats: 0, tales: 0 }).tier).toBe("keeper");
    expect(librarianRank({ endings: 7, beats: 0, tales: 0 }).tier).toBe("keeper");
  });

  it("promotes to archivist only when ≥8 endings AND ≥10 beats", () => {
    expect(librarianRank({ endings: 8, beats: 10, tales: 0 }).tier).toBe("archivist");
    // 8 endings but only 9 beats → stays keeper (archivist beats threshold unmet).
    expect(librarianRank({ endings: 8, beats: 9, tales: 0 }).tier).toBe("keeper");
  });

  it("promotes to librarian at ≥15 endings AND ≥3 tales (beats irrelevant)", () => {
    // Meets librarian but not archivist (0 beats) — highest MET tier wins.
    expect(librarianRank({ endings: 15, beats: 0, tales: 3 }).tier).toBe("librarian");
    // 15 endings, 2 tales → not librarian; 10 beats → archivist instead.
    expect(librarianRank({ endings: 15, beats: 10, tales: 2 }).tier).toBe("archivist");
  });

  it("promotes to unwritten only when all three thresholds are met", () => {
    expect(librarianRank({ endings: 30, beats: 10, tales: 10 }).tier).toBe("unwritten");
    // 30 endings + 10 tales but only 9 beats → falls back to librarian.
    expect(librarianRank({ endings: 30, beats: 9, tales: 10 }).tier).toBe("librarian");
  });

  it("echoes floored, non-negative metrics and a display label", () => {
    const rank = librarianRank({ endings: 4.9, beats: -3, tales: Number.NaN });
    expect(rank).toMatchObject({ tier: "keeper", label: "Keeper", endings: 4, beats: 0, tales: 0 });
  });
});

describe("rankProgress (act-mementos R3.1 next-tier ticker)", () => {
  // Full adjacent-tier-pair walk. Each row sits AT the `from` tier and reports
  // its zero-floored deficits against the NEXT tier's OWN thresholds. Metrics
  // are chosen so `librarianRank` actually lands on `from` (parity with the
  // chip: rankProgress consumes exactly what librarianRank echoes back).
  const walk: Array<{
    from: string;
    metrics: { endings: number; beats: number; tales: number };
    nextTier: string;
    nextLabel: string;
    needsEndings: number;
    needsBeats: number;
    needsTales: number;
  }> = [
    // novice → keeper: only the endings gate stands between them.
    {
      from: "novice",
      metrics: { endings: 0, beats: 0, tales: 0 },
      nextTier: "keeper",
      nextLabel: "Keeper",
      needsEndings: 3,
      needsBeats: 0,
      needsTales: 0,
    },
    // novice → keeper, partway: 2 endings (still below keeper's 3), extra
    // beats/tales that keeper does not require floor to zero deficits.
    {
      from: "novice",
      metrics: { endings: 2, beats: 5, tales: 5 },
      nextTier: "keeper",
      nextLabel: "Keeper",
      needsEndings: 1,
      needsBeats: 0,
      needsTales: 0,
    },
    // keeper → archivist (NON-MONOTONIC): archivist introduces a beats gate the
    // keeper tier never had, so a fresh keeper owes the full 10 beats.
    {
      from: "keeper",
      metrics: { endings: 3, beats: 0, tales: 0 },
      nextTier: "archivist",
      nextLabel: "Archivist",
      needsEndings: 5,
      needsBeats: 10,
      needsTales: 0,
    },
    // keeper → archivist, partway on both new gates.
    {
      from: "keeper",
      metrics: { endings: 7, beats: 9, tales: 0 },
      nextTier: "archivist",
      nextLabel: "Archivist",
      needsEndings: 1,
      needsBeats: 1,
      needsTales: 0,
    },
    // archivist → librarian (NON-MONOTONIC): librarian's beats floor is 0, so an
    // archivist sitting on 10 beats owes NOTHING for beats even though it is the
    // higher tier — the ladder trades the beats gate for a tales gate.
    {
      from: "archivist",
      metrics: { endings: 8, beats: 10, tales: 0 },
      nextTier: "librarian",
      nextLabel: "Librarian",
      needsEndings: 7,
      needsBeats: 0,
      needsTales: 3,
    },
    // librarian → unwritten: the top rung re-imposes the beats gate and raises
    // all three.
    {
      from: "librarian",
      metrics: { endings: 15, beats: 0, tales: 3 },
      nextTier: "unwritten",
      nextLabel: "The Unwritten",
      needsEndings: 15,
      needsBeats: 10,
      needsTales: 7,
    },
  ];

  it.each(walk)(
    "$from → $nextTier: deficits against the next tier's own thresholds",
    ({ from, metrics, nextTier, nextLabel, needsEndings, needsBeats, needsTales }) => {
      const rank = librarianRank(metrics);
      // Sanity: the metrics really do land on the `from` tier (chip parity).
      expect(rank.tier).toBe(from);

      const progress = rankProgress(rank);
      expect(progress).toEqual({
        nextTier,
        nextLabel,
        needsEndings,
        needsBeats,
        needsTales,
      });
    },
  );

  it("returns null at the top tier — 'The Unwritten' has no next rung", () => {
    const rank = librarianRank({ endings: 30, beats: 10, tales: 10 });
    expect(rank.tier).toBe("unwritten");
    expect(rankProgress(rank)).toBeNull();
  });

  it("floors garbage metrics before computing deficits (never throws)", () => {
    // A hand-built keeper rank carrying non-integer / negative / non-finite
    // metrics; deficits toward archivist must use the floored values.
    const garbage: LibrarianRank = {
      tier: "keeper",
      label: "Keeper",
      endings: 3.9, // → 3, needs 5 for archivist's 8
      beats: -2, // → 0, needs the full 10
      tales: Number.POSITIVE_INFINITY, // → 0 (non-finite), archivist needs 0
    };
    expect(rankProgress(garbage)).toEqual({
      nextTier: "archivist",
      nextLabel: "Archivist",
      needsEndings: 5,
      needsBeats: 10,
      needsTales: 0,
    });
  });

  it("treats an unrecognized tier as the floor rather than throwing", () => {
    const bogus = {
      tier: "phantom",
      label: "Phantom",
      endings: 0,
      beats: 0,
      tales: 0,
    } as unknown as LibrarianRank;
    // Falls back to index 0 (novice), so the next rung is keeper.
    expect(rankProgress(bogus)).toMatchObject({ nextTier: "keeper", needsEndings: 3 });
  });
});
