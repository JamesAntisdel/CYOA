import { describe, expect, it } from "vitest";

import {
  adaptKeepsakes,
  adaptLibrarianRank,
  buildDowngradeModel,
  canStartMode,
  hasKeepsakes,
  HARDCORE_DOWNGRADE_CAVEAT,
  isKeepsakeItem,
  KEEPSAKE_TAG,
  librarianRankChipLabel,
  librarianRankProgressLine,
  selectedKeepsake,
  toggleKeepsakeSelection,
  whatMightHaveBeenCards,
  whatMightHaveBeenTeaser,
  WHAT_MIGHT_HAVE_BEEN_MAX,
} from "../storyEngagementW3";

const KEEPSAKES = [
  { id: "bone-key", label: "Bone Key", description: "It opened a door once." },
  { id: "iron-vow", label: "Iron Vow", description: "A promise you kept." },
];

describe("keepsakes — adapter + absent-when-empty", () => {
  it("maps null/absent to an empty list and drops malformed entries", () => {
    expect(adaptKeepsakes(null)).toEqual([]);
    expect(adaptKeepsakes(undefined)).toEqual([]);
    expect(adaptKeepsakes([{ id: "x" } as any, KEEPSAKES[0]!])).toEqual([KEEPSAKES[0]]);
  });

  it("hasKeepsakes is false for a keepsake-less account (picker absent)", () => {
    expect(hasKeepsakes(null)).toBe(false);
    expect(hasKeepsakes([])).toBe(false);
    expect(hasKeepsakes(KEEPSAKES)).toBe(true);
  });
});

describe("KeepsakePicker single-select (≤1)", () => {
  it("selects when nothing is chosen", () => {
    expect(toggleKeepsakeSelection(undefined, "bone-key")).toBe("bone-key");
  });

  it("deselects when the chosen keepsake is tapped again", () => {
    expect(toggleKeepsakeSelection("bone-key", "bone-key")).toBe(undefined);
  });

  it("replaces (never accumulates) when a different keepsake is tapped", () => {
    expect(toggleKeepsakeSelection("bone-key", "iron-vow")).toBe("iron-vow");
  });

  it("resolves the selected keepsake object, null when none/unknown", () => {
    expect(selectedKeepsake(KEEPSAKES, "iron-vow")).toEqual(KEEPSAKES[1]);
    expect(selectedKeepsake(KEEPSAKES, undefined)).toBe(null);
    expect(selectedKeepsake(KEEPSAKES, "ghost")).toBe(null);
  });
});

describe("keepsake inventory badge", () => {
  it("detects a keepsake-tagged item", () => {
    expect(isKeepsakeItem({ tags: [KEEPSAKE_TAG] })).toBe(true);
    expect(isKeepsakeItem({ tags: ["relic"] })).toBe(false);
    expect(isKeepsakeItem({})).toBe(false);
    expect(isKeepsakeItem(null)).toBe(false);
  });
});

describe("What-Might-Have-Been (terminal-only, UNREACHED, ≤2)", () => {
  const cards = [
    { label: "The Drowned Crown", hint: "Had you trusted the ferryman…" },
    { label: "The Iron Vow", hint: "Had you paid the toll…" },
    { label: "The Ashen Road", hint: "Had you walked away…" },
  ];

  it("renders nothing before the save is terminal (BC9/BC10)", () => {
    expect(whatMightHaveBeenCards(cards, { terminal: false })).toEqual([]);
  });

  it("renders nothing when the projection carries none", () => {
    expect(whatMightHaveBeenCards(null, { terminal: true })).toEqual([]);
    expect(whatMightHaveBeenCards([], { terminal: true })).toEqual([]);
  });

  it("caps to WHAT_MIGHT_HAVE_BEEN_MAX on terminal saves", () => {
    const out = whatMightHaveBeenCards(cards, { terminal: true });
    expect(out).toHaveLength(WHAT_MIGHT_HAVE_BEEN_MAX);
    expect(out.map((c) => c.label)).toEqual(["The Drowned Crown", "The Iron Vow"]);
  });

  it("drops malformed (label-less) entries", () => {
    const out = whatMightHaveBeenCards(
      [{ hint: "no label" } as any, cards[0]!],
      { terminal: true },
    );
    expect(out).toEqual([cards[0]]);
  });

  it("builds the fogged teaser without spoiling the ending prose", () => {
    expect(whatMightHaveBeenTeaser(cards[0]!)).toBe(
      "Had you trusted the ferryman… — The Drowned Crown",
    );
    expect(whatMightHaveBeenTeaser({ label: "The Nameless Gate", hint: "" })).toBe(
      "The Nameless Gate",
    );
  });
});

describe("Librarian Rank display model", () => {
  it("maps null/absent to undefined", () => {
    expect(adaptLibrarianRank(null)).toBe(undefined);
    expect(adaptLibrarianRank(undefined)).toBe(undefined);
  });

  it("normalizes counts and renders the chip + progress line", () => {
    const rank = adaptLibrarianRank({
      tier: "archivist",
      label: "Archivist",
      endings: 8,
      beats: 10,
      tales: 1,
    })!;
    expect(librarianRankChipLabel(rank)).toBe("Archivist");
    expect(librarianRankProgressLine(rank)).toBe("8 endings · 10 beats · 1 tale");
  });

  it("pluralizes units correctly", () => {
    const rank = adaptLibrarianRank({
      tier: "keeper",
      label: "Keeper",
      endings: 1,
      beats: 0,
      tales: 3,
    })!;
    expect(librarianRankProgressLine(rank)).toBe("1 ending · 0 beats · 3 tales");
  });
});

describe("Hardcore consent gate + downgrade caveat (R15)", () => {
  it("Story mode needs no consent; Hardcore requires it", () => {
    expect(canStartMode("story", false)).toBe(true);
    expect(canStartMode("hardcore", false)).toBe(false);
    expect(canStartMode("hardcore", true)).toBe(true);
  });

  it("offers downgrade only for a hardcore save and never a mid-run upgrade", () => {
    const hardcore = buildDowngradeModel("hardcore");
    expect(hardcore.canDowngrade).toBe(true);
    expect(hardcore.canUpgrade).toBe(false);
    expect(hardcore.caveat).toBe(HARDCORE_DOWNGRADE_CAVEAT);

    const story = buildDowngradeModel("story");
    expect(story.canDowngrade).toBe(false);
    expect(story.canUpgrade).toBe(false);
  });
});
