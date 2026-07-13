// Pin test for the Story Bible response contract (story-bible R1.2, task
// SB-S1): the Gemini wire schema (`STORY_BIBLE_RESPONSE_SCHEMA`) must stay
// structurally in sync with the engine's loose Zod envelope
// (`storyBibleOutputSchema`), and both must stay TOLERANT — a garbage payload
// parses to a rejectable shape without throwing (BC5); hard validation is
// `validateProposedBible`'s job.

import { describe, expect, it } from "vitest";

import { storyBibleOutputSchema, validateProposedBible } from "@cyoa/engine";

import { STORY_BIBLE_RESPONSE_SCHEMA } from "../llm/responseSchema";

const wireProps = STORY_BIBLE_RESPONSE_SCHEMA.properties as Record<
  string,
  {
    type: string;
    minItems?: number;
    properties?: Record<string, unknown>;
    required?: readonly string[];
    items?: { properties?: Record<string, unknown>; required?: readonly string[] };
  }
>;

describe("STORY_BIBLE_RESPONSE_SCHEMA ↔ storyBibleOutputSchema sync", () => {
  it("covers exactly the engine envelope's sections", () => {
    // The engine envelope is `.passthrough()`, so its declared keys are the
    // canonical section list. Drift in either direction fails here.
    const engineSections = Object.keys(storyBibleOutputSchema.shape).sort();
    expect(Object.keys(wireProps).sort()).toEqual(engineSections);
    expect(engineSections).toEqual(
      ["cast", "endingHints", "keyRegistry", "lockPlan", "motifs", "protagonist", "twists"].sort(),
    );
  });

  it("requires keyRegistry + protagonist + cast (identity/cast are load-bearing)", () => {
    // protagonist is the anchor against mid-story drift; cast is `required`
    // + `minItems:2` to fix the empty-cast bug (character-consistency §1/§2).
    expect(STORY_BIBLE_RESPONSE_SCHEMA.required).toEqual([
      "keyRegistry",
      "protagonist",
      "cast",
    ]);
    expect(wireProps.cast?.minItems).toBe(2);
    // Engine side stays tolerant: keyRegistry alone parses the loose envelope
    // (the hard gate is validateProposedBible, not the wire `required`).
    expect(storyBibleOutputSchema.safeParse({ keyRegistry: [] }).success).toBe(true);
    expect(storyBibleOutputSchema.safeParse({}).success).toBe(false);
  });

  it("declares every ARRAY section as an ARRAY; protagonist is the lone OBJECT", () => {
    for (const [section, spec] of Object.entries(wireProps)) {
      const expected = section === "protagonist" ? "OBJECT" : "ARRAY";
      expect(spec.type, `${section} wire type`).toBe(expected);
    }
  });

  it("pins the R1.2 entry shapes on the wire", () => {
    expect(wireProps.keyRegistry?.items?.required).toEqual([
      "id",
      "label",
      "opensHint",
      "surfaceBand",
    ]);
    expect(wireProps.lockPlan?.items?.required).toEqual(["id", "label", "keyId", "gateBand"]);
    // Cast now carries a stable `appearance` descriptor (character-consistency §2).
    expect(wireProps.cast?.items?.required).toEqual([
      "id",
      "label",
      "want",
      "secret",
      "appearance",
    ]);
    expect(wireProps.cast?.items?.properties?.appearance).toBeDefined();
    expect(wireProps.twists?.items?.required).toEqual(["id", "label", "precondition"]);
    expect(wireProps.endingHints?.items?.required).toEqual(["endingId", "requires"]);
    // Band enums match the engine's SurfaceBand / gateBand unions.
    expect(
      (wireProps.keyRegistry?.items?.properties?.surfaceBand as { enum: string[] }).enum,
    ).toEqual(["early", "mid", "late"]);
    expect(
      (wireProps.lockPlan?.items?.properties?.gateBand as { enum: string[] }).enum,
    ).toEqual(["mid", "late"]);
  });

  it("pins the protagonist identity object (character-consistency §1)", () => {
    const protagonist = wireProps.protagonist;
    expect(protagonist?.type).toBe("OBJECT");
    // gender + pronouns REQUIRED so identity is never left implicit (the drift
    // root cause). appearance is an array with a floor so the model commits
    // specifics rather than one vague sentence.
    expect(protagonist?.required).toEqual(["name", "gender", "pronouns", "appearance"]);
    const appearance = protagonist?.properties?.appearance as {
      type: string;
      minItems: number;
      maxItems: number;
    };
    expect(appearance.type).toBe("ARRAY");
    expect(appearance.minItems).toBe(2);
    expect(appearance.maxItems).toBe(6);
    expect(protagonist?.properties?.name).toBeDefined();
    expect(protagonist?.properties?.voice).toBeDefined();
  });
});

describe("tolerance (BC5) — garbage never throws", () => {
  it("engine envelope accepts junk entries; validateProposedBible rejects them quietly", () => {
    const garbage = {
      keyRegistry: [42, null, { nonsense: true }, "a string"],
      lockPlan: "not-an-array-at-all",
      extraUnknownField: { deeply: { nested: [] } },
    };
    // Loose envelope: keyRegistry is an array of unknowns → parses; lockPlan
    // mis-typed → safeParse reports failure but never throws.
    expect(() => storyBibleOutputSchema.safeParse(garbage)).not.toThrow();
    // Hard validator: salvages nothing (no usable keys) → null, never throws.
    expect(validateProposedBible(garbage)).toBeNull();
    expect(validateProposedBible(null)).toBeNull();
    expect(validateProposedBible("💥")).toBeNull();
  });

  it("a schema-conformant payload passes the loose envelope AND the hard validator", () => {
    const payload = {
      keyRegistry: [
        { id: "bone-key", label: "the Bone Key", opensHint: "opens the crypt gate", surfaceBand: "early" },
        { id: "ferry-token", label: "a ferryman's token", opensHint: "passage across", surfaceBand: "mid" },
        { id: "salt-lamp", label: "a salt lamp", opensHint: "lights the under-stair", surfaceBand: "mid" },
        { id: "iron-writ", label: "the Iron Writ", opensHint: "commands the gate guard", surfaceBand: "late" },
      ],
      lockPlan: [
        { id: "crypt-gate", label: "the crypt gate", keyId: "bone-key", gateBand: "mid", note: "" },
      ],
      cast: [{ id: "mira", label: "Mira", want: "passage north", secret: "deserted the Iron Court", bondHint: "" }],
      twists: [{ id: "drowned-bell", label: "the Drowned Bell", precondition: "reader trusts the ferryman" }],
      endingHints: [{ endingId: "the-salt-throne", requires: "hold the Iron Writ at the gates" }],
      motifs: ["salt", "bells underwater", "rust"],
    };
    expect(storyBibleOutputSchema.safeParse(payload).success).toBe(true);
    const validated = validateProposedBible(payload);
    expect(validated).not.toBeNull();
    expect(validated?.keyRegistry).toHaveLength(4);
    expect(validated?.lockPlan[0]?.keyId).toBe("bone-key");
  });
});
