import { describe, expect, it } from "vitest";

// `librarianRank` reaches the barrel via the arc.ts W3 bridge re-export (see
// HANDOFF) — import through the package entry like the rest of the suite.
import { librarianRank } from "../src";

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
