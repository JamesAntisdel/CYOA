import { describe, expect, it } from "vitest";

import type { LibrarySave } from "../../../hooks/useLibrary";
import {
  isCompletedSave,
  PUBLISHABLE_SHELF_LIMIT,
  publishableStatusLabel,
  selectPublishableSaves,
  turnCountLabel,
} from "../publishableSaves";

function makeSave(overrides: Partial<LibrarySave> & { saveId: string }): LibrarySave {
  return {
    accountId: "acct_1",
    storyId: "open-canvas",
    title: `Tale ${overrides.saveId}`,
    mode: "story",
    status: "ended",
    turnNumber: 5,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

describe("selectPublishableSaves — eligibility", () => {
  it("drops saves with zero turns (server rejects them as tale_snapshot_empty)", () => {
    const result = selectPublishableSaves([
      makeSave({ saveId: "s1", turnNumber: 0, status: "ended" }),
      makeSave({ saveId: "s2", turnNumber: 1 }),
    ]);
    expect(result.map((s) => s.saveId)).toEqual(["s2"]);
  });

  it("returns an empty list for an empty library (guest / signed-out path)", () => {
    expect(selectPublishableSaves([])).toEqual([]);
  });

  it("includes in-progress saves that have at least one turn", () => {
    const result = selectPublishableSaves([
      makeSave({ saveId: "s1", status: "active", turnNumber: 3 }),
    ]);
    expect(result).toHaveLength(1);
  });
});

describe("selectPublishableSaves — ordering", () => {
  it("ranks completed runs ahead of in-progress ones", () => {
    const result = selectPublishableSaves([
      makeSave({ saveId: "active-new", status: "active", updatedAt: 9_000 }),
      makeSave({ saveId: "ended-old", status: "ended", updatedAt: 1_000 }),
    ]);
    expect(result.map((s) => s.saveId)).toEqual(["ended-old", "active-new"]);
  });

  it("treats death and safe-close endings as completed too", () => {
    const saves = [
      makeSave({ saveId: "dead", status: "dead", updatedAt: 3_000 }),
      makeSave({ saveId: "safe", status: "ended_safely", updatedAt: 2_000 }),
      makeSave({ saveId: "active", status: "active", updatedAt: 5_000 }),
    ];
    const result = selectPublishableSaves(saves);
    expect(result.map((s) => s.saveId)).toEqual(["dead", "safe", "active"]);
  });

  it("sorts newest-first within each group", () => {
    const result = selectPublishableSaves([
      makeSave({ saveId: "ended-old", status: "ended", updatedAt: 1_000 }),
      makeSave({ saveId: "ended-new", status: "ended", updatedAt: 4_000 }),
      makeSave({ saveId: "active-old", status: "active", updatedAt: 2_000 }),
      makeSave({ saveId: "active-new", status: "active", updatedAt: 3_000 }),
    ]);
    expect(result.map((s) => s.saveId)).toEqual([
      "ended-new",
      "ended-old",
      "active-new",
      "active-old",
    ]);
  });

  it("does not mutate the caller's array", () => {
    const saves = [
      makeSave({ saveId: "a", status: "active", updatedAt: 5_000 }),
      makeSave({ saveId: "b", status: "ended", updatedAt: 1_000 }),
    ];
    selectPublishableSaves(saves);
    expect(saves.map((s) => s.saveId)).toEqual(["a", "b"]);
  });
});

describe("selectPublishableSaves — cap", () => {
  it("caps the shelf at the default limit", () => {
    const saves = Array.from({ length: PUBLISHABLE_SHELF_LIMIT + 3 }, (_, i) =>
      makeSave({ saveId: `s${i}`, updatedAt: i }),
    );
    expect(selectPublishableSaves(saves)).toHaveLength(PUBLISHABLE_SHELF_LIMIT);
  });

  it("honors an explicit limit and clamps negative limits to zero", () => {
    const saves = [makeSave({ saveId: "a" }), makeSave({ saveId: "b" })];
    expect(selectPublishableSaves(saves, 1)).toHaveLength(1);
    expect(selectPublishableSaves(saves, -1)).toEqual([]);
  });
});

describe("labels", () => {
  it("classifies terminal statuses as completed", () => {
    expect(isCompletedSave(makeSave({ saveId: "a", status: "dead" }))).toBe(true);
    expect(isCompletedSave(makeSave({ saveId: "b", status: "ended" }))).toBe(true);
    expect(isCompletedSave(makeSave({ saveId: "c", status: "ended_safely" }))).toBe(true);
    expect(isCompletedSave(makeSave({ saveId: "d", status: "active" }))).toBe(false);
  });

  it("maps every status to a book-voice chip label", () => {
    expect(publishableStatusLabel("dead")).toBe("ended in death");
    expect(publishableStatusLabel("ended")).toBe("reached an ending");
    expect(publishableStatusLabel("ended_safely")).toBe("closed safely");
    expect(publishableStatusLabel("active")).toBe("still being written");
  });

  it("pluralizes turn counts", () => {
    expect(turnCountLabel(1)).toBe("1 turn");
    expect(turnCountLabel(12)).toBe("12 turns");
  });
});
