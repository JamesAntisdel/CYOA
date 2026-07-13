import { describe, expect, it } from "vitest";

import {
  advanceLlmTurnCursor,
  buildBibleDigest,
  cloneState,
  createInitialState,
  dueKeySeedings,
  evaluateLlmSceneChoices,
  evaluateLlmSceneChoicesWithRegistry,
  keySeedingPlan,
  llmChoiceSchema,
  llmSceneOutputSchema,
  matchEndingHints,
  mergeBibleRefresh,
  processGatedChoices,
  recordEverGranted,
  storyBibleOutputSchema,
  validateProposedBible,
  type BibleKey,
  type PlayerState,
  type RegistrySnapshot,
  type Story,
  type StoryArc,
  type StoryBible,
} from "../src";

const ctx = { now: 1, rngSeed: "seed" };

function story(): Story {
  return {
    id: "bone-cathedral",
    version: 1,
    title: "Bone Cathedral",
    startNodeId: "start",
    initialState: {
      vitality: 10,
      currency: 20,
      attributes: {
        resolve: { id: "resolve", label: "Resolve", value: 1, visibility: "visible", min: 0, max: 9 },
      },
      inventory: [{ id: "bone-key", label: "Bone Key" }],
      flags: { bell_rung: true },
    },
    endings: {
      "bell-holds": { id: "bell-holds", label: "The Bell Holds", kind: "success" },
    },
    nodes: { start: { id: "start", seed: "seed", choices: [] } },
  };
}

function state(): PlayerState {
  return createInitialState(story(), "story", ctx.now, ctx.rngSeed);
}

function arc(): StoryArc {
  return {
    dramaticQuestion: "Will the bell hold?",
    protagonistWant: "To silence the tolling.",
    stakes: "The cathedral falls.",
    act: 1,
    beats: [
      {
        id: "inciting-call",
        label: "The call",
        kind: "inciting",
        priorityHint: "early",
        requiredBeforeEnding: false,
        status: "pending",
      },
      {
        id: "midpoint-turn",
        label: "The turn",
        kind: "midpoint",
        priorityHint: "mid",
        requiredBeforeEnding: false,
        status: "pending",
      },
      {
        id: "climax-reckoning",
        label: "The reckoning",
        kind: "climax",
        priorityHint: "late",
        requiredBeforeEnding: true,
        status: "pending",
      },
    ],
    candidateEndings: [
      { id: "bell-holds", label: "The Bell Holds", hint: "" },
      { id: "the-quiet-ruin", label: "The Quiet Ruin", hint: "" },
    ],
    source: "llm",
  };
}

/** Minimal raw key entry the validator accepts. */
function rawKey(id: string, band: string = "early"): Record<string, unknown> {
  return { id, label: `The ${id}`, opensHint: `opens the ${id} door`, surfaceBand: band };
}

function rawBible(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    keyRegistry: [rawKey("bone-key"), rawKey("iron-key", "mid"), rawKey("ferry-token", "mid"), rawKey("ash-charm", "late")],
    lockPlan: [
      { id: "crypt-gate", label: "The crypt gate", keyId: "bone-key", gateBand: "mid", note: "under the nave" },
    ],
    cast: [{ id: "mira", label: "Mira", want: "passage north", secret: "deserted", bondHint: "shared grief" }],
    twists: [{ id: "drowned-bell", label: "The drowned bell", precondition: "trusts the ferryman" }],
    endingHints: [{ endingId: "bell-holds", requires: "ring the bell thrice" }],
    motifs: ["salt", "verdigris", "candle smoke"],
    ...overrides,
  };
}

function validBible(): StoryBible {
  const bible = validateProposedBible(rawBible());
  if (bible === null) throw new Error("fixture bible failed validation");
  return bible;
}

function bibleKey(overrides: Partial<BibleKey> & { id: string }): BibleKey {
  return {
    label: overrides.id,
    opensHint: "",
    surfaceBand: "early",
    status: "planned",
    ...overrides,
  };
}

function registryOf(...keys: BibleKey[]): RegistrySnapshot {
  return { keyRegistry: keys };
}

// A snapshot with room to adopt: four unrelated planned keys, none promised.
function roomyRegistry(): RegistrySnapshot {
  return registryOf(
    bibleKey({ id: "moth-lantern" }),
    bibleKey({ id: "salt-ring" }),
    bibleKey({ id: "verger-seal" }),
    bibleKey({ id: "black-hymnal" }),
  );
}

const gated = (id: string, itemId: string, lockedHint?: string) =>
  llmChoiceSchema.parse({
    id,
    label: id,
    conditions: [{ kind: "has_item", itemId }],
    ...(lockedHint !== undefined ? { lockedHint } : {}),
  });
const statGated = (id: string, value: number) =>
  llmChoiceSchema.parse({
    id,
    label: id,
    conditions: [{ kind: "stat_at_least", statId: "resolve", value }],
  });
const currencyGated = (id: string, value: number) =>
  llmChoiceSchema.parse({ id, label: id, conditions: [{ kind: "currency_at_least", value }] });
const visible = (id: string) => llmChoiceSchema.parse({ id, label: id });
const granting = (id: string, itemId: string, label: string) =>
  llmChoiceSchema.parse({
    id,
    label: id,
    effects: [{ kind: "inventory_add", item: { id: itemId, label } }],
  });

// ===========================================================================
// validateProposedBible (SB-E1) — clamp/slug/dedupe/drop matrix
// ===========================================================================

describe("validateProposedBible", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["string", "not a bible"],
    ["number", 7],
    ["array", []],
    ["empty object", {}],
    ["keyRegistry not an array", { keyRegistry: "keys" }],
    ["three salvageable keys (under the 4 floor)", { keyRegistry: [rawKey("a"), rawKey("b"), rawKey("c")] }],
    [
      "garbage key entries do not count toward salvage",
      { keyRegistry: [rawKey("a"), rawKey("b"), rawKey("c"), null, 42, { label: "" }, { id: "!!!" }] },
    ],
  ])("returns null for %s", (_label, raw) => {
    expect(validateProposedBible(raw)).toBeNull();
  });

  it("keeps a salvageable bible and initializes consumption state", () => {
    const bible = validateProposedBible(rawBible());
    expect(bible).not.toBeNull();
    expect(bible?.keyRegistry).toHaveLength(4);
    expect(bible?.keyRegistry.every((key) => key.status === "planned")).toBe(true);
    expect(bible?.lockPlan[0]).toMatchObject({ keyId: "bone-key", status: "planned" });
    expect(bible?.twists[0]?.status).toBe("pending");
    expect(bible?.source).toBe("llm");
    expect(bible?.version).toBe(1);
  });

  it("sluggifies ids (falling back to the label) and dedupes them", () => {
    const bible = validateProposedBible(
      rawBible({
        keyRegistry: [
          { id: "Bone Key!", label: "the Bone Key" },
          { id: "bone-key", label: "duplicate id, dropped" },
          { label: "The Ferry Token" }, // id derived from label
          rawKey("ash-charm"),
          rawKey("salt-ring"),
        ],
      }),
    );
    expect(bible?.keyRegistry.map((key) => key.id)).toEqual([
      "bone-key",
      "the-ferry-token",
      "ash-charm",
      "salt-ring",
    ]);
  });

  it("clamps every string to its R1.2 bound", () => {
    const bible = validateProposedBible(
      rawBible({
        keyRegistry: [
          { id: "long", label: "L".repeat(200), opensHint: "H".repeat(200), surfaceBand: "early" },
          rawKey("b"),
          rawKey("c"),
          rawKey("d"),
        ],
        endingHints: [{ endingId: "bell-holds", requires: "R".repeat(300) }],
        motifs: ["M".repeat(80), "salt"],
      }),
    );
    expect(bible?.keyRegistry[0]?.label).toHaveLength(80);
    expect(bible?.keyRegistry[0]?.opensHint).toHaveLength(120);
    expect(bible?.endingHints[0]?.requires).toHaveLength(160);
    expect(bible?.motifs[0]).toHaveLength(40);
  });

  it("caps every section (12 keys, 5 doors, 5 cast, 4 twists, 4 hints, 6 motifs)", () => {
    const manyKeys = Array.from({ length: 20 }, (_, i) => rawKey(`key-${i}`));
    const manyDoors = Array.from({ length: 9 }, (_, i) => ({
      id: `door-${i}`,
      label: `Door ${i}`,
      keyId: "key-0",
      gateBand: "mid",
    }));
    const manyCast = Array.from({ length: 9 }, (_, i) => ({ id: `c-${i}`, label: `Cast ${i}` }));
    const manyTwists = Array.from({ length: 9 }, (_, i) => ({ id: `t-${i}`, label: `Twist ${i}` }));
    const manyHints = Array.from({ length: 9 }, (_, i) => ({ endingId: `e-${i}`, requires: "x" }));
    const manyMotifs = Array.from({ length: 12 }, (_, i) => `motif ${i}`);
    const bible = validateProposedBible(
      rawBible({
        keyRegistry: manyKeys,
        lockPlan: manyDoors,
        cast: manyCast,
        twists: manyTwists,
        endingHints: manyHints,
        motifs: manyMotifs,
      }),
    );
    expect(bible?.keyRegistry).toHaveLength(12);
    expect(bible?.lockPlan).toHaveLength(5);
    expect(bible?.cast).toHaveLength(5);
    expect(bible?.twists).toHaveLength(4);
    expect(bible?.endingHints).toHaveLength(4);
    expect(bible?.motifs).toHaveLength(6);
  });

  it("drops lockPlan entries whose keyId misses the registry", () => {
    const bible = validateProposedBible(
      rawBible({
        lockPlan: [
          { id: "ok", label: "resolves", keyId: "Bone Key", gateBand: "mid" }, // slug-tolerant
          { id: "orphan", label: "no such key", keyId: "unknown-key", gateBand: "mid" },
          { id: "no-key", label: "keyId missing entirely" },
        ],
      }),
    );
    expect(bible?.lockPlan.map((door) => door.id)).toEqual(["ok"]);
  });

  it("drops lockPlan entries whose gateBand precedes the key's surfaceBand", () => {
    const bible = validateProposedBible(
      rawBible({
        lockPlan: [
          { id: "too-early", label: "gate mid, key late", keyId: "ash-charm", gateBand: "mid" },
          { id: "fine", label: "gate late, key late", keyId: "ash-charm", gateBand: "late" },
        ],
      }),
    );
    expect(bible?.lockPlan.map((door) => door.id)).toEqual(["fine"]);
  });

  it("defaults malformed bands tolerantly (surfaceBand → mid, gateBand → mid)", () => {
    const bible = validateProposedBible(
      rawBible({
        keyRegistry: [
          { id: "weird", label: "Weird band", surfaceBand: "sometime" },
          rawKey("b"),
          rawKey("c"),
          rawKey("d"),
        ],
        lockPlan: [{ id: "d1", label: "door", keyId: "weird", gateBand: "whenever" }],
      }),
    );
    expect(bible?.keyRegistry[0]?.surfaceBand).toBe("mid");
    expect(bible?.lockPlan[0]?.gateBand).toBe("mid");
  });

  it("never throws on deeply malformed input", () => {
    const horror = {
      keyRegistry: [{ id: { nested: true }, label: 42 }, "x", [], rawKey("a"), rawKey("b"), rawKey("c"), rawKey("d")],
      lockPlan: { not: "an array" },
      cast: [null, { id: 9 }],
      twists: "twists",
      endingHints: [{ endingId: 12 }],
      motifs: [null, 3, { m: 1 }],
    };
    expect(() => validateProposedBible(horror)).not.toThrow();
    expect(validateProposedBible(horror)?.keyRegistry).toHaveLength(4);
  });

  // --- protagonist salvage (character-consistency §1.3) ---------------------

  it("salvages a well-formed protagonist verbatim (clamped)", () => {
    const bible = validateProposedBible(
      rawBible({
        protagonist: {
          name: "Ines Vega",
          gender: "woman",
          pronouns: "she/her",
          appearance: ["dark cropped hair", "wiry build", "salt-stained coat"],
          voice: "clipped and dry",
        },
      }),
    );
    expect(bible?.protagonist).toEqual({
      name: "Ines Vega",
      gender: "woman",
      pronouns: "she/her",
      appearance: ["dark cropped hair", "wiry build", "salt-stained coat"],
      voice: "clipped and dry",
    });
  });

  it("clamps protagonist strings to their bounds and appearance to ≤6 unique", () => {
    const bible = validateProposedBible(
      rawBible({
        protagonist: {
          name: "N".repeat(200),
          gender: "G".repeat(200),
          pronouns: "P".repeat(200),
          appearance: [
            "a".repeat(200),
            "b",
            "b", // duplicate — dropped
            "c",
            "d",
            "e",
            "f",
            "g", // 7th unique — over the 6 cap, dropped
          ],
          voice: "V".repeat(200),
        },
      }),
    );
    const p = bible?.protagonist;
    expect(p?.name).toHaveLength(80);
    expect(p?.gender).toHaveLength(40);
    expect(p?.pronouns).toHaveLength(40);
    expect(p?.voice).toHaveLength(120);
    expect(p?.appearance[0]).toHaveLength(60);
    expect(p?.appearance).toHaveLength(6);
    expect(p?.appearance).toEqual(["a".repeat(60), "b", "c", "d", "e", "f"]);
  });

  it("drops a protagonist with no usable name but still salvages the bible (BC5)", () => {
    const noName = validateProposedBible(rawBible({ protagonist: { gender: "man", appearance: ["tall"] } }));
    expect(noName?.protagonist).toBeUndefined();
    expect(noName?.keyRegistry).toHaveLength(4);

    const blankName = validateProposedBible(rawBible({ protagonist: { name: "   " } }));
    expect(blankName?.protagonist).toBeUndefined();
  });

  it("tolerant-drops malformed protagonist sub-fields without throwing", () => {
    const bible = validateProposedBible(
      rawBible({
        protagonist: {
          name: "Kell",
          gender: 42, // wrong type → ""
          pronouns: null, // wrong type → ""
          appearance: [null, 7, "  visible scar  ", {}], // only the string survives, trimmed
          voice: ["nope"], // wrong type → ""
        },
      }),
    );
    expect(bible?.protagonist).toEqual({
      name: "Kell",
      gender: "",
      pronouns: "",
      appearance: ["visible scar"],
      voice: "",
    });
  });

  it("omits protagonist entirely for a legacy bible (no field)", () => {
    const bible = validateProposedBible(rawBible());
    expect(bible).not.toBeNull();
    expect("protagonist" in (bible as object)).toBe(false);
  });

  // --- cast appearance (character-consistency §2) ---------------------------

  it("salvages a cast appearance descriptor (clamped ≤120) and defaults to empty", () => {
    const bible = validateProposedBible(
      rawBible({
        cast: [
          {
            id: "mira",
            label: "Mira",
            want: "passage north",
            secret: "deserted",
            bondHint: "shared grief",
            appearance: "A".repeat(200),
          },
          { id: "jonah", label: "Jonah" }, // no appearance → ""
        ],
      }),
    );
    expect(bible?.cast[0]?.appearance).toHaveLength(120);
    expect(bible?.cast[1]?.appearance).toBe("");
  });
});

describe("storyBibleOutputSchema (loose envelope)", () => {
  it("shape-checks tolerantly — garbage entries parse without throwing", () => {
    const parsed = storyBibleOutputSchema.safeParse({
      keyRegistry: [null, 42, "x"],
      extraField: "passthrough",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a payload with no keyRegistry array (rejectable, not a throw)", () => {
    expect(storyBibleOutputSchema.safeParse({ lockPlan: [] }).success).toBe(false);
    expect(storyBibleOutputSchema.safeParse("garbage").success).toBe(false);
  });
});

// ===========================================================================
// matchEndingHints (R1.5)
// ===========================================================================

describe("matchEndingHints", () => {
  it("keeps exact matches, normalizes fuzzy ones, drops unmatched", () => {
    const bible = validateProposedBible(
      rawBible({
        endingHints: [
          { endingId: "bell-holds", requires: "exact" },
          { endingId: "the quiet ruin", requires: "fuzzy" },
          { endingId: "utterly-unrelated-finale", requires: "dropped" },
        ],
      }),
    );
    const matched = matchEndingHints(bible!, arc());
    expect(matched.endingHints).toEqual([
      { endingId: "bell-holds", requires: "exact" },
      { endingId: "the-quiet-ruin", requires: "fuzzy" },
    ]);
  });

  it("dedupes hints that normalize to the same candidate", () => {
    const bible = validateProposedBible(
      rawBible({
        endingHints: [
          { endingId: "bell-holds", requires: "first" },
          { endingId: "bell holds!", requires: "second (dropped)" },
        ],
      }),
    );
    const matched = matchEndingHints(bible!, arc());
    expect(matched.endingHints).toEqual([{ endingId: "bell-holds", requires: "first" }]);
  });

  it("attaches with empty hints when the save has no arc (legacy)", () => {
    const bible = validBible();
    expect(matchEndingHints(bible, undefined).endingHints).toEqual([]);
  });

  it("never mutates the input bible", () => {
    const bible = validBible();
    const before = JSON.stringify(bible);
    matchEndingHints(bible, arc());
    expect(JSON.stringify(bible)).toBe(before);
  });
});

// ===========================================================================
// itemsEverGranted ledger (SB-E2, R4.1)
// ===========================================================================

describe("itemsEverGranted ledger", () => {
  const scene = (choices: unknown[]) => llmSceneOutputSchema.parse({ prose: "scene.", choices });

  it("appends normalized id + label on an llm-path inventory_add", () => {
    const prior = scene([
      {
        id: "take",
        label: "Take the charm.",
        effects: [{ kind: "inventory_add", item: { id: "item-042", label: "Ash Charm" } }],
      },
      { id: "leave", label: "Leave it." },
    ]);
    const result = advanceLlmTurnCursor({
      state: state(),
      story: story(),
      priorProposal: prior,
      choiceId: "take",
      ctx,
    });
    expect(result.state.itemsEverGranted).toEqual(["item042", "ashcharm"]);
  });

  it("dedupes: re-granting (and id ~ label collisions) add nothing", () => {
    const prior = scene([
      {
        id: "take",
        label: "Take the key.",
        effects: [
          { kind: "inventory_add", item: { id: "Iron_Key", label: "Iron Key" } },
          { kind: "inventory_add", item: { id: "iron-key", label: "IRON KEY" } },
        ],
      },
      { id: "leave", label: "Leave it." },
    ]);
    const result = advanceLlmTurnCursor({
      state: state(),
      story: story(),
      priorProposal: prior,
      choiceId: "take",
      ctx,
    });
    expect(result.state.itemsEverGranted).toEqual(["ironkey"]);
  });

  it("survives the item being removed later (that is the point of the ledger)", () => {
    const prior = scene([
      {
        id: "burn",
        label: "Use the key up.",
        effects: [
          { kind: "inventory_add", item: { id: "wax-seal", label: "Wax Seal" } },
          { kind: "inventory_remove", itemId: "wax-seal" },
        ],
      },
      { id: "leave", label: "Leave it." },
    ]);
    const result = advanceLlmTurnCursor({
      state: state(),
      story: story(),
      priorProposal: prior,
      choiceId: "burn",
      ctx,
    });
    expect(result.state.inventory.some((item) => item.id === "wax-seal")).toBe(false);
    expect(result.state.itemsEverGranted).toContain("waxseal");
  });

  it("legacy state without the field round-trips untouched when nothing is granted", () => {
    const prior = scene([
      { id: "walk", label: "Walk on." },
      { id: "wait", label: "Wait." },
    ]);
    const before = state();
    expect(before.itemsEverGranted).toBeUndefined();
    const result = advanceLlmTurnCursor({
      state: before,
      story: story(),
      priorProposal: prior,
      choiceId: "walk",
      ctx,
    });
    expect(result.state.itemsEverGranted).toBeUndefined();
    expect(before.itemsEverGranted).toBeUndefined();
  });

  it("cloneState copies the ledger without aliasing", () => {
    const source = { ...state(), itemsEverGranted: ["bonekey"] };
    const clone = cloneState(source);
    expect(clone.itemsEverGranted).toEqual(["bonekey"]);
    clone.itemsEverGranted?.push("intruder");
    expect(source.itemsEverGranted).toEqual(["bonekey"]);
  });

  it("cloneState keeps the field absent on legacy state", () => {
    expect("itemsEverGranted" in cloneState(state())).toBe(false);
  });

  it("recordEverGranted never mutates its input ledger", () => {
    const ledger = ["bonekey"];
    const next = recordEverGranted(ledger, { id: "salt-ring", label: "Salt Ring" });
    expect(ledger).toEqual(["bonekey"]);
    expect(next).toEqual(["bonekey", "saltring"]);
  });
});

// ===========================================================================
// processGatedChoices (SB-E3, R4.2–R4.5) — the §3 matrix
// ===========================================================================

describe("processGatedChoices resolution order", () => {
  it("held item: the condition passes, so nothing gates (baseline)", () => {
    const { results, registryEvents } = evaluateLlmSceneChoicesWithRegistry(
      [gated("open", "bone-key"), visible("walk")],
      state(),
      { registry: roomyRegistry() },
    );
    expect(results[0]?.visibility).toBe("visible");
    expect(registryEvents).toEqual([]);
  });

  it("ledger hit keeps the gate locked with no events — even bible-less", () => {
    const withLedger = { ...state(), itemsEverGranted: ["ironkey"] };
    const { results, registryEvents } = evaluateLlmSceneChoicesWithRegistry(
      [gated("unlock", "iron_key"), visible("a"), visible("b")],
      withLedger,
    );
    expect(results[0]?.visibility).toBe("locked");
    expect(registryEvents).toEqual([]);
  });

  it("sibling grant in the same proposal is NOT a phantom (grant-on-A-gate-B tease)", () => {
    const { results, registryEvents } = evaluateLlmSceneChoicesWithRegistry(
      [granting("steal", "iron-key", "Iron Key"), gated("unlock", "Iron_Key"), visible("walk")],
      state(),
    );
    expect(results[1]?.visibility).toBe("locked");
    expect(registryEvents).toEqual([]);
  });

  it("sibling grant nested in a delayed thread also counts", () => {
    const planter = llmChoiceSchema.parse({
      id: "plant",
      label: "plant",
      effects: [
        {
          kind: "delayed",
          delayNodes: 2,
          effects: [{ kind: "inventory_add", item: { id: "iron-key", label: "Iron Key" } }],
        },
      ],
    });
    const { results, registryEvents } = evaluateLlmSceneChoicesWithRegistry(
      [planter, gated("unlock", "iron-key"), visible("walk")],
      state(),
    );
    expect(results[1]?.visibility).toBe("locked");
    expect(registryEvents).toEqual([]);
  });

  it("registry hit: keeps the gate locked and promises the key", () => {
    const registry = registryOf(...roomyRegistry().keyRegistry, bibleKey({ id: "iron-key", label: "the Iron Key" }));
    const { results, registryEvents } = evaluateLlmSceneChoicesWithRegistry(
      [gated("unlock", "Iron Key"), visible("a"), visible("b")],
      state(),
      { registry, turnNumber: 4 },
    );
    expect(results[0]?.visibility).toBe("locked");
    expect(registryEvents).toEqual([{ kind: "promise", keyId: "iron-key", turn: 4 }]);
  });

  it("promise is idempotent: an already-promised key emits no second event", () => {
    const registry = registryOf(
      ...roomyRegistry().keyRegistry,
      bibleKey({ id: "iron-key", status: "promised", promisedAtTurn: 2 }),
    );
    const { results, registryEvents } = evaluateLlmSceneChoicesWithRegistry(
      [gated("unlock", "iron-key"), visible("a"), visible("b")],
      state(),
      { registry, turnNumber: 4 },
    );
    expect(results[0]?.visibility).toBe("locked");
    expect(registryEvents).toEqual([]);
  });

  it("promise cap: a planned registry key stays locked but unpromised at 2 outstanding", () => {
    const registry = registryOf(
      bibleKey({ id: "p1", status: "promised", promisedAtTurn: 1 }),
      bibleKey({ id: "p2", status: "promised", promisedAtTurn: 2 }),
      bibleKey({ id: "iron-key" }),
      bibleKey({ id: "salt-ring" }),
    );
    const { results, registryEvents } = evaluateLlmSceneChoicesWithRegistry(
      [gated("unlock", "iron-key"), visible("a"), visible("b")],
      state(),
      { registry, turnNumber: 5 },
    );
    expect(results[0]?.visibility).toBe("locked");
    expect(registryEvents).toEqual([]);
  });

  it("adopts an unknown gate id into the registry as a promised floating key", () => {
    const { results, registryEvents } = evaluateLlmSceneChoicesWithRegistry(
      [gated("unlock", "silver_sigil", "You need the sigil."), visible("a"), visible("b")],
      state(),
      { registry: roomyRegistry(), turnNumber: 6 },
    );
    expect(results[0]?.visibility).toBe("locked");
    expect(registryEvents).toEqual([
      {
        kind: "adopt",
        turn: 6,
        key: {
          id: "silver-sigil",
          label: "Silver Sigil",
          opensHint: "You need the sigil.",
          surfaceBand: "mid", // beatBandForTurn(6)
          status: "promised",
          promisedAtTurn: 6,
          adopted: true,
        },
      },
    ]);
  });

  it("adoption dedupes within a proposal: the second gate matches the just-adopted key", () => {
    const { registryEvents } = evaluateLlmSceneChoicesWithRegistry(
      [gated("a", "silver-sigil"), gated("b", "Silver Sigil"), visible("c"), visible("d")],
      state(),
      { registry: roomyRegistry(), turnNumber: 2 },
    );
    expect(registryEvents.filter((event) => event.kind === "adopt")).toHaveLength(1);
    expect(registryEvents.some((event) => event.kind === "phantom_unlock")).toBe(false);
  });

  it("registry cap (16) exhausted → phantom unlock", () => {
    const full = registryOf(
      ...Array.from({ length: 16 }, (_, i) => bibleKey({ id: `key-${i}` })),
    );
    const { results, registryEvents } = evaluateLlmSceneChoicesWithRegistry(
      [gated("unlock", "silver-sigil", "hint"), visible("a"), visible("b")],
      state(),
      { registry: full, turnNumber: 3 },
    );
    expect(results[0]?.visibility).toBe("visible");
    expect(results[0]?.lockedHint).toBeUndefined();
    expect(registryEvents).toEqual([
      { kind: "phantom_unlock", itemId: "silver-sigil", choiceId: "unlock", turn: 3 },
    ]);
  });

  it("promise cap blocks adoption → phantom unlock", () => {
    const registry = registryOf(
      bibleKey({ id: "p1", status: "promised", promisedAtTurn: 1 }),
      bibleKey({ id: "p2", status: "promised", promisedAtTurn: 1 }),
      bibleKey({ id: "salt-ring" }),
      bibleKey({ id: "moth-lantern" }),
    );
    const { results, registryEvents } = evaluateLlmSceneChoicesWithRegistry(
      [gated("unlock", "silver-sigil"), visible("a"), visible("b")],
      state(),
      { registry, turnNumber: 3 },
    );
    expect(results[0]?.visibility).toBe("visible");
    expect(registryEvents).toEqual([
      { kind: "phantom_unlock", itemId: "silver-sigil", choiceId: "unlock", turn: 3 },
    ]);
  });

  it("bible-less (empty registry): unmatched gates always phantom-unlock (R4.5)", () => {
    const { results, registryEvents } = evaluateLlmSceneChoicesWithRegistry(
      [gated("unlock", "silver-sigil", "hint"), visible("a"), visible("b")],
      state(),
      { turnNumber: 2 },
    );
    expect(results[0]?.visibility).toBe("visible");
    expect(registryEvents).toEqual([
      { kind: "phantom_unlock", itemId: "silver-sigil", choiceId: "unlock", turn: 2 },
    ]);
  });

  it("emits granted when a planned/promised key's item is held or in the ledger", () => {
    const registry = registryOf(
      bibleKey({ id: "bone-key", label: "the Bone Key", status: "promised", promisedAtTurn: 1 }), // in inventory
      bibleKey({ id: "ash-charm", status: "planned" }), // in ledger
      bibleKey({ id: "salt-ring" }), // neither
      bibleKey({ id: "granted-already", status: "granted" }), // idempotent skip
    );
    const withLedger = { ...state(), itemsEverGranted: ["ashcharm"] };
    const { registryEvents } = evaluateLlmSceneChoicesWithRegistry(
      [visible("a"), visible("b")],
      withLedger,
      { registry, turnNumber: 5 },
    );
    expect(registryEvents).toEqual([
      { kind: "granted", keyId: "bone-key", turn: 5 },
      { kind: "granted", keyId: "ash-charm", turn: 5 },
    ]);
  });

  it("a key granted this turn frees its promise slot for adoption", () => {
    const registry = registryOf(
      bibleKey({ id: "bone-key", label: "the Bone Key", status: "promised", promisedAtTurn: 1 }), // granted now
      bibleKey({ id: "p2", status: "promised", promisedAtTurn: 1 }),
      bibleKey({ id: "salt-ring" }),
      bibleKey({ id: "moth-lantern" }),
    );
    const { registryEvents } = evaluateLlmSceneChoicesWithRegistry(
      [gated("unlock", "silver-sigil"), visible("a"), visible("b")],
      state(),
      { registry, turnNumber: 4 },
    );
    expect(registryEvents.some((event) => event.kind === "granted")).toBe(true);
    expect(registryEvents.some((event) => event.kind === "adopt")).toBe(true);
  });

  it("never mutates the registry or the incoming results", () => {
    const registry = registryOf(
      bibleKey({ id: "iron-key" }),
      bibleKey({ id: "salt-ring" }),
      bibleKey({ id: "moth-lantern" }),
      bibleKey({ id: "verger-seal" }),
    );
    Object.freeze(registry);
    registry.keyRegistry.forEach((key) => Object.freeze(key));
    Object.freeze(registry.keyRegistry);
    const choices = [gated("unlock", "iron-key"), gated("mystery", "silver-sigil"), visible("a"), visible("b")];
    const results = choices.map((choice, i) => ({
      choiceId: choice.id,
      visibility: (i < 2 ? "locked" : "visible") as "locked" | "visible",
    }));
    const snapshot = JSON.stringify(results);
    expect(() =>
      processGatedChoices({ choices, results, state: state(), registry, turnNumber: 3 }),
    ).not.toThrow();
    expect(JSON.stringify(results)).toBe(snapshot);
  });
});

describe("processGatedChoices keep-rule (R4.4) + scene invariants", () => {
  it("prefers a registry-backed key gate over a stat-deficit lock", () => {
    const registry = registryOf(...roomyRegistry().keyRegistry, bibleKey({ id: "iron-key" }));
    const results = evaluateLlmSceneChoices(
      [statGated("grit", 9), gated("unlock", "iron-key"), visible("a"), visible("b")],
      state(),
      { registry, turnNumber: 3 },
    );
    expect(results.find((r) => r.choiceId === "unlock")?.visibility).toBe("locked");
    expect(results.find((r) => r.choiceId === "grit")?.visibility).toBe("visible");
  });

  it("prefers the smallest numeric deficit among stat/currency locks", () => {
    // resolve is 1 → deficit 8 vs 2; currency 20 → deficit 5.
    const results = evaluateLlmSceneChoices(
      [statGated("hard", 9), currencyGated("toll", 25), statGated("near", 3), visible("a"), visible("b")],
      state(),
    );
    expect(results.find((r) => r.choiceId === "near")?.visibility).toBe("locked");
    expect(results.find((r) => r.choiceId === "hard")?.visibility).toBe("visible");
    expect(results.find((r) => r.choiceId === "toll")?.visibility).toBe("visible");
  });

  it("falls back to array order on ties (legacy behavior preserved)", () => {
    const results = evaluateLlmSceneChoices(
      [visible("a"), statGated("b", 9), statGated("c", 9)],
      state(),
    );
    expect(results.find((r) => r.choiceId === "b")?.visibility).toBe("locked");
    expect(results.find((r) => r.choiceId === "c")?.visibility).toBe("visible");
  });

  it("keeps ≥2 visible on non-terminal scenes even for a registry-backed lock", () => {
    const registry = registryOf(...roomyRegistry().keyRegistry, bibleKey({ id: "iron-key" }));
    const results = evaluateLlmSceneChoices(
      [gated("unlock", "iron-key"), visible("a")],
      state(),
      { registry },
    );
    expect(results.filter((r) => r.visibility === "visible")).toHaveLength(2);
  });

  it("terminal scenes may keep the single locked choice", () => {
    const registry = registryOf(...roomyRegistry().keyRegistry, bibleKey({ id: "iron-key" }));
    const results = evaluateLlmSceneChoices(
      [gated("unlock", "iron-key"), visible("a")],
      state(),
      { registry, terminal: true },
    );
    expect(results.find((r) => r.choiceId === "unlock")?.visibility).toBe("locked");
  });

  it("a choice gated on has_item AND a failing non-key condition stays a key gate (tier 0)", () => {
    const registry = registryOf(...roomyRegistry().keyRegistry, bibleKey({ id: "iron-key" }));
    const combo = llmChoiceSchema.parse({
      id: "combo",
      label: "combo",
      conditions: [
        { kind: "has_item", itemId: "iron-key" },
        { kind: "stat_at_least", statId: "resolve", value: 9 },
      ],
    });
    const results = evaluateLlmSceneChoices(
      [statGated("near", 3), combo, visible("a"), visible("b")],
      state(),
      { registry },
    );
    expect(results.find((r) => r.choiceId === "combo")?.visibility).toBe("locked");
    expect(results.find((r) => r.choiceId === "near")?.visibility).toBe("visible");
  });

  it("missing_item / flag locks are not key gates and never phantom-unlock", () => {
    const flagLock = llmChoiceSchema.parse({
      id: "flag",
      label: "flag",
      conditions: [{ kind: "flag_equals", flag: "bell_rung", value: false }],
    });
    const { results, registryEvents } = evaluateLlmSceneChoicesWithRegistry(
      [flagLock, visible("a"), visible("b")],
      state(),
    );
    expect(results[0]?.visibility).toBe("locked");
    expect(registryEvents).toEqual([]);
  });
});

// ===========================================================================
// dueKeySeedings + keySeedingPlan (SB-E4, R5.1)
// ===========================================================================

describe("dueKeySeedings", () => {
  it.each([
    ["exactly 3 turns after the promise", 2, 5, true],
    ["more than 3 turns after", 2, 9, true],
    ["only 2 turns after", 2, 4, false],
    ["same turn as the promise", 5, 5, false],
  ])("%s → due=%s", (_label, promisedAtTurn, turnNumber, due) => {
    const registry = registryOf(bibleKey({ id: "iron-key", status: "promised", promisedAtTurn }));
    expect(dueKeySeedings(registry, turnNumber).map((key) => key.id)).toEqual(
      due ? ["iron-key"] : [],
    );
  });

  it("skips granted, retired, planned, already-seeded, and unstamped keys", () => {
    const registry = registryOf(
      bibleKey({ id: "granted", status: "granted", promisedAtTurn: 1 }),
      bibleKey({ id: "retired", status: "retired", promisedAtTurn: 1 }),
      bibleKey({ id: "planned", status: "planned" }),
      bibleKey({ id: "seeded", status: "promised", promisedAtTurn: 1, seeded: true }),
      bibleKey({ id: "unstamped", status: "promised" }),
      bibleKey({ id: "due", status: "promised", promisedAtTurn: 1 }),
    );
    expect(dueKeySeedings(registry, 8).map((key) => key.id)).toEqual(["due"]);
  });

  it("returns copies, never the registry's own objects", () => {
    const key = bibleKey({ id: "due", status: "promised", promisedAtTurn: 1 });
    const [copy] = dueKeySeedings(registryOf(key), 8);
    expect(copy).toEqual(key);
    expect(copy).not.toBe(key);
  });
});

describe("keySeedingPlan", () => {
  it("builds a 1-node thread granting the key with a label/opensHint note", () => {
    const plan = keySeedingPlan(
      bibleKey({ id: "iron-key", label: "the Iron Key", opensHint: "opens the vestry", status: "promised" }),
    );
    expect(plan.delayNodes).toBe(1);
    expect(plan.effects).toEqual([
      {
        kind: "inventory_add",
        item: { id: "iron-key", label: "the Iron Key", description: "opens the vestry" },
      },
    ]);
    expect(plan.note).toBe("the Iron Key — opens the vestry");
  });

  it("clamps the note to the thread bound (120) and tolerates an empty hint", () => {
    const long = keySeedingPlan(
      bibleKey({ id: "k", label: "L".repeat(80), opensHint: "H".repeat(120), status: "promised" }),
    );
    expect(long.note.length).toBeLessThanOrEqual(120);
    const bare = keySeedingPlan(bibleKey({ id: "k", label: "the Key", status: "promised" }));
    expect(bare.note).toBe("the Key");
    expect(bare.effects[0]).toEqual({ kind: "inventory_add", item: { id: "k", label: "the Key" } });
  });
});

// ===========================================================================
// buildBibleDigest (SB-E4, R3.1, R5.2) — band filter + caps
// ===========================================================================

function digestBible(): StoryBible {
  return {
    ...validBible(),
    keyRegistry: [
      bibleKey({ id: "e1", surfaceBand: "early" }),
      bibleKey({ id: "e2", surfaceBand: "early" }),
      bibleKey({ id: "m1", surfaceBand: "mid" }),
      bibleKey({ id: "l1", surfaceBand: "late" }),
      bibleKey({ id: "l2-promised", surfaceBand: "late", status: "promised", promisedAtTurn: 2 }),
      bibleKey({ id: "gone", surfaceBand: "early", status: "granted" }),
      bibleKey({ id: "dead", surfaceBand: "early", status: "retired" }),
    ],
    lockPlan: [
      { id: "d-mid", label: "Mid door", keyId: "m1", gateBand: "mid", note: "", status: "planned" },
      { id: "d-late", label: "Late door", keyId: "l1", gateBand: "late", note: "", status: "planned" },
      { id: "d-open", label: "Opened", keyId: "e1", gateBand: "mid", note: "", status: "opened" },
    ],
    twists: [
      { id: "t1", label: "Twist 1", precondition: "", status: "pending" },
      { id: "t2", label: "Twist 2", precondition: "", status: "fired" },
      { id: "t3", label: "Twist 3", precondition: "", status: "pending" },
      { id: "t4", label: "Twist 4", precondition: "", status: "pending" },
    ],
  };
}

describe("buildBibleDigest", () => {
  it("turn 2 (early): due early keys + promised keys only; mid doors not yet due", () => {
    const digest = buildBibleDigest(digestBible(), 2);
    expect(digest.keys.map((key) => key.id)).toEqual(["l2-promised", "e1", "e2"]);
    expect(digest.keys[0]).toMatchObject({ promised: true, due: false });
    expect(digest.keys[1]).toMatchObject({ promised: false, due: true });
    expect(digest.doors).toEqual([]);
    // granted/retired keys never appear
    expect(digest.keys.some((key) => key.id === "gone" || key.id === "dead")).toBe(false);
  });

  it("turn 6 (mid): mid keys and mid doors become due; opened doors excluded", () => {
    const digest = buildBibleDigest(digestBible(), 6);
    expect(digest.keys.map((key) => key.id)).toEqual(["l2-promised", "e1", "e2", "m1"]);
    expect(digest.doors.map((door) => door.id)).toEqual(["d-mid"]);
  });

  it("a not-yet-due door whose key is promised is included (promise pulls it in)", () => {
    const bible = digestBible();
    bible.keyRegistry = bible.keyRegistry.map((key) =>
      key.id === "l1" ? { ...key, status: "promised" as const, promisedAtTurn: 3 } : key,
    );
    const digest = buildBibleDigest(bible, 6);
    expect(digest.doors.map((door) => door.id)).toEqual(["d-mid", "d-late"]);
    // and the late key rides in as promised despite its band
    expect(digest.keys.some((key) => key.id === "l1" && key.promised)).toBe(true);
  });

  it("caps keys at 6 (promised first), doors at 3, twists at 2", () => {
    const bible = digestBible();
    bible.keyRegistry = [
      ...Array.from({ length: 8 }, (_, i) => bibleKey({ id: `due-${i}`, surfaceBand: "early" })),
      bibleKey({ id: "late-promised", surfaceBand: "late", status: "promised", promisedAtTurn: 1 }),
    ];
    bible.lockPlan = Array.from({ length: 5 }, (_, i) => ({
      id: `door-${i}`,
      label: `Door ${i}`,
      keyId: "due-0",
      gateBand: "mid" as const,
      note: "",
      status: "planned" as const,
    }));
    const digest = buildBibleDigest(bible, 6);
    expect(digest.keys).toHaveLength(6);
    expect(digest.keys[0]?.id).toBe("late-promised"); // promised outranks due
    expect(digest.doors).toHaveLength(3);
    expect(digest.twists.map((twist) => twist.id)).toEqual(["t1", "t3"]);
  });

  it("OUTSTANDING KEYS: promised → promised line; fresh grant → reoffer line; stale grant → none", () => {
    const bible = digestBible();
    bible.keyRegistry = [
      bibleKey({ id: "waiting", status: "promised", promisedAtTurn: 4 }),
      bibleKey({ id: "fresh", status: "granted", promisedAtTurn: 2, grantedAtTurn: 7 }),
      bibleKey({ id: "stale", status: "granted", promisedAtTurn: 1, grantedAtTurn: 3 }),
      bibleKey({ id: "never-promised", status: "granted", grantedAtTurn: 7 }),
    ];
    const digest = buildBibleDigest(bible, 8);
    expect(digest.outstanding).toEqual([
      { keyId: "fresh", label: "fresh", state: "reoffer", grantedAtTurn: 7 },
      { keyId: "waiting", label: "waiting", state: "promised", promisedAtTurn: 4 },
    ]);
  });

  it("caps outstanding at 2, re-offers leading", () => {
    const bible = digestBible();
    bible.keyRegistry = [
      bibleKey({ id: "w1", status: "promised", promisedAtTurn: 4 }),
      bibleKey({ id: "w2", status: "promised", promisedAtTurn: 5 }),
      bibleKey({ id: "r1", status: "granted", promisedAtTurn: 2, grantedAtTurn: 8 }),
    ];
    const digest = buildBibleDigest(bible, 8);
    expect(digest.outstanding.map((line) => line.keyId)).toEqual(["r1", "w1"]);
  });

  it("carries the full cast sheet and never mutates the bible", () => {
    const bible = digestBible();
    const before = JSON.stringify(bible);
    const digest = buildBibleDigest(bible, 6);
    expect(digest.cast).toEqual(bible.cast);
    expect(digest.cast[0]).not.toBe(bible.cast[0]);
    expect(JSON.stringify(bible)).toBe(before);
  });

  it("carries the cast appearance descriptor into the digest", () => {
    const bible: StoryBible = {
      ...digestBible(),
      cast: [
        { id: "mira", label: "Mira", want: "", secret: "", bondHint: "", appearance: "wiry, ash-blond, patched coat" },
      ],
    };
    expect(buildBibleDigest(bible, 6).cast[0]?.appearance).toBe("wiry, ash-blond, patched coat");
  });

  it("passes the protagonist through verbatim (deep-copied, every turn)", () => {
    const protagonist = {
      name: "Ines Vega",
      gender: "woman",
      pronouns: "she/her",
      appearance: ["dark cropped hair", "wiry build"],
      voice: "clipped and dry",
    };
    const bible: StoryBible = { ...digestBible(), protagonist };
    // Identity is due regardless of turn band — assert on an early AND a late turn.
    for (const turn of [1, 12]) {
      const digest = buildBibleDigest(bible, turn);
      expect(digest.protagonist).toEqual(protagonist);
      expect(digest.protagonist).not.toBe(protagonist);
      expect(digest.protagonist?.appearance).not.toBe(protagonist.appearance);
    }
  });

  it("omits protagonist from the digest for a legacy bible", () => {
    const digest = buildBibleDigest(digestBible(), 6);
    expect(digest.protagonist).toBeUndefined();
    expect("protagonist" in digest).toBe(false);
  });
});

// ===========================================================================
// mergeBibleRefresh (SB-E4, R6) — immutability rules
// ===========================================================================

describe("mergeBibleRefresh", () => {
  function current(): StoryBible {
    return {
      ...validBible(),
      keyRegistry: [
        bibleKey({ id: "bone-key", surfaceBand: "early" }),
        bibleKey({ id: "iron-key", surfaceBand: "mid", status: "promised", promisedAtTurn: 3 }),
        bibleKey({ id: "ash-charm", surfaceBand: "late", status: "granted" }),
        bibleKey({ id: "salt-ring", surfaceBand: "mid" }),
        bibleKey({ id: "moth-lantern", surfaceBand: "mid" }),
      ],
      lockPlan: [
        { id: "crypt-gate", label: "Crypt gate", keyId: "bone-key", gateBand: "mid", note: "", status: "planned" },
        { id: "old-door", label: "Old door", keyId: "ash-charm", gateBand: "late", note: "", status: "opened" },
      ],
      twists: [
        { id: "t-pending", label: "Pending twist", precondition: "", status: "pending" },
        { id: "t-fired", label: "Fired twist", precondition: "", status: "fired" },
      ],
    };
  }

  /** A refresh proposal that re-lists (some of) the current keys plus extras. */
  function refreshRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      keyRegistry: [
        rawKey("bone-key", "mid"), // relocation early → mid
        rawKey("iron-key", "late"), // relocation attempt on a PROMISED key
        rawKey("salt-ring", "mid"),
        rawKey("moth-lantern", "mid"),
      ],
      lockPlan: [
        { id: "crypt-gate", label: "Crypt gate, moved", keyId: "bone-key", gateBand: "late", note: "moved" },
      ],
      twists: [{ id: "t-pending", label: "Pending twist, sharpened", precondition: "later" }],
      ...overrides,
    };
  }

  it("keeps the current bible on an unsalvageable proposal", () => {
    const bible = current();
    expect(mergeBibleRefresh(bible, null)).toBe(bible);
    expect(mergeBibleRefresh(bible, { keyRegistry: [rawKey("only-one")] })).toBe(bible);
  });

  it("relocates planned keys; promised/granted keys are immutable", () => {
    const merged = mergeBibleRefresh(current(), refreshRaw());
    const byId = new Map(merged.keyRegistry.map((key) => [key.id, key]));
    expect(byId.get("bone-key")).toMatchObject({ surfaceBand: "mid", status: "planned" });
    expect(byId.get("iron-key")).toMatchObject({
      surfaceBand: "mid", // relocation ignored
      status: "promised",
      promisedAtTurn: 3,
    });
    expect(byId.get("ash-charm")?.status).toBe("granted");
  });

  it("retires planned keys the proposal dropped — unless a pending lock references them", () => {
    // Proposal drops salt-ring (retirable) and bone-key... but bone-key is
    // referenced by the planned crypt-gate, so it survives.
    const merged = mergeBibleRefresh(
      current(),
      refreshRaw({
        keyRegistry: [rawKey("iron-key", "mid"), rawKey("moth-lantern", "mid"), rawKey("new-a"), rawKey("new-b")],
      }),
    );
    const byId = new Map(merged.keyRegistry.map((key) => [key.id, key]));
    expect(byId.get("salt-ring")?.status).toBe("retired");
    expect(byId.get("bone-key")?.status).toBe("planned");
  });

  it("adds at most 2 new keys", () => {
    const merged = mergeBibleRefresh(
      current(),
      refreshRaw({
        keyRegistry: [
          rawKey("bone-key"),
          rawKey("salt-ring", "mid"),
          rawKey("new-a"),
          rawKey("new-b"),
          rawKey("new-c"),
        ],
      }),
    );
    const newIds = merged.keyRegistry.map((key) => key.id).filter((id) => id.startsWith("new-"));
    expect(newIds).toEqual(["new-a", "new-b"]);
  });

  it("updates planned doors, keeps opened doors, retires dropped doors", () => {
    const merged = mergeBibleRefresh(current(), refreshRaw());
    const crypt = merged.lockPlan.find((door) => door.id === "crypt-gate");
    expect(crypt).toMatchObject({ gateBand: "late", note: "moved", status: "planned" });
    expect(merged.lockPlan.find((door) => door.id === "old-door")?.status).toBe("opened");

    const dropped = mergeBibleRefresh(current(), refreshRaw({ lockPlan: [] }));
    expect(dropped.lockPlan.find((door) => door.id === "crypt-gate")?.status).toBe("retired");
  });

  it("ignores a door relocation that breaks the key/band ordering", () => {
    // bone-key stays early in this proposal; door tries to gate... fine. Make
    // the door point at a LATE key with a mid gate instead — unusable.
    const merged = mergeBibleRefresh(
      current(),
      refreshRaw({
        keyRegistry: [rawKey("bone-key"), rawKey("salt-ring", "mid"), rawKey("late-key", "late"), rawKey("moth-lantern", "mid")],
        lockPlan: [{ id: "crypt-gate", label: "Bad move", keyId: "late-key", gateBand: "late", note: "x" }],
      }),
    );
    // proposal door IS usable (late/late) — assert the update landed…
    expect(merged.lockPlan.find((door) => door.id === "crypt-gate")?.keyId).toBe("late-key");
    // …and an unusable one (validator drops mid-gate-on-late-key doors before
    // the merge even sees them) keeps the current door untouched.
    const unusable = mergeBibleRefresh(
      current(),
      refreshRaw({
        keyRegistry: [rawKey("bone-key"), rawKey("salt-ring", "mid"), rawKey("late-key", "late"), rawKey("moth-lantern", "mid")],
        lockPlan: [{ id: "crypt-gate", label: "Bad move", keyId: "late-key", gateBand: "mid", note: "x" }],
      }),
    );
    expect(unusable.lockPlan.find((door) => door.id === "crypt-gate")).toMatchObject({
      keyId: "bone-key",
      status: "retired", // validator dropped the proposal door → treated as absent
    });
  });

  it("twists: pending updatable/retire-on-drop, fired immutable, new appended", () => {
    const merged = mergeBibleRefresh(
      current(),
      refreshRaw({
        twists: [
          { id: "t-pending", label: "Sharpened", precondition: "later" },
          { id: "t-new", label: "New twist", precondition: "" },
        ],
      }),
    );
    expect(merged.twists.find((twist) => twist.id === "t-pending")).toMatchObject({
      label: "Sharpened",
      status: "pending",
    });
    expect(merged.twists.find((twist) => twist.id === "t-fired")?.status).toBe("fired");
    expect(merged.twists.find((twist) => twist.id === "t-new")?.status).toBe("pending");

    const dropped = mergeBibleRefresh(current(), refreshRaw({ twists: [] }));
    expect(dropped.twists.find((twist) => twist.id === "t-pending")?.status).toBe("retired");
  });

  it("never mutates the current bible and preserves cast/endingHints/motifs", () => {
    const bible = current();
    const before = JSON.stringify(bible);
    const merged = mergeBibleRefresh(bible, refreshRaw());
    expect(JSON.stringify(bible)).toBe(before);
    expect(merged.cast).toEqual(bible.cast);
    expect(merged.endingHints).toEqual(bible.endingHints);
    expect(merged.motifs).toEqual(bible.motifs);
  });

  it("preserves the protagonist identity unchanged across an act refresh", () => {
    const protagonist = {
      name: "Ines Vega",
      gender: "woman",
      pronouns: "she/her",
      appearance: ["dark cropped hair", "wiry build"],
      voice: "clipped and dry",
    };
    const bible: StoryBible = { ...current(), protagonist };
    // Even a refresh payload proposing a DIFFERENT protagonist must not change it.
    const merged = mergeBibleRefresh(
      bible,
      refreshRaw({ protagonist: { name: "Someone Else", gender: "man", pronouns: "he/him" } }),
    );
    expect(merged.protagonist).toEqual(protagonist);
  });
});
