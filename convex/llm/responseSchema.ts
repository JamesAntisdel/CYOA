// Gemini structured-output schema (OpenAPI 3.0 subset) describing the
// LLM scene proposal contract. When passed as `generationConfig.responseSchema`
// the model is GRAMMAR-CONSTRAINED to produce valid JSON matching this
// shape — invalid output literally cannot be emitted. This is the
// difference between `responseMimeType: "application/json"` (soft hint:
// "wrap your output in JSON-ish characters") and `responseSchema` (hard
// guarantee: "every token you emit conforms to this schema").
//
// Why this matters for us:
//  - Without the schema, the model freely uses tokens however it wants,
//    doesn't know when to wrap up, and silently truncates if it overruns
//    `maxOutputTokens`. We saw exactly this: `prose_len=1221`, raw cut
//    off mid-word ("in my fi..."), proposal failed validation, scene
//    rendered as FAILED in the UI.
//  - With the schema, the model self-paces: it knows when to close braces,
//    where commas go, and stays within bounds. Output is guaranteed to
//    parse. The Zod parser becomes defense-in-depth instead of the
//    primary failure surface.
//  - We can also raise `maxOutputTokens` to model-max without worrying
//    about runaway output, because the schema bounds the structure.
//
// Maintenance: keep IN SYNC with `packages/engine/src/llm.ts:llmSceneOutputSchema`.
// The Zod schema is the runtime source of truth; this OpenAPI-ish copy
// drives the wire-side guarantee. A test pins both in `responseSchema.test.ts`
// so drift is caught at CI time.
//
// Gemini schema language reference:
//   https://ai.google.dev/api/generate-content#schema
//   - Type names are uppercase: STRING, NUMBER, INTEGER, BOOLEAN, ARRAY, OBJECT
//   - `anyOf` supports discriminated unions
//   - `nullable: true` makes a field optional (in addition to omitting from `required`)
//   - No recursive `$ref` — recursive types must be inlined or flattened
//   - `propertyOrdering` (optional) hints field emission order — useful for
//     keeping required fields up front so partial outputs are usable

// Mirror engine bounds: keep in sync with packages/engine/src/llm.ts.
// Reduced from 12_000 → 6_000 (≈1000 words) on 2026-05-28: with the
// previous bound, gemini-3-flash-preview was filling the prose field to
// ~12 KB on every turn, hitting maxOutputTokens=32K (≈95 KB JSON), getting
// truncated mid-string, and producing unparseable JSON. The router then
// fell to the deterministic provider and the reader saw the "page is blank
// for a moment" fallback panel. The chapter band's upper bound is 1100-1800
// words (see prompts/scene.ts:lengthInstruction) — 6 KB / ~1000 words is
// the right ceiling for the standard band; longer chapters self-truncate at
// the schema and the model self-paces accordingly.
const MAX_PROSE_CHARS = 6_000;
const MAX_CHOICES = 4;
const MIN_CHOICES = 2;
const MAX_EFFECTS_PER_CHOICE = 6;
const NPC_MENTIONS_MAX = 10;
const NPC_ID_MAX = 64;

// Each effect kind as a standalone schema. Composed into the choice
// effects array via `anyOf`. Recursive `delayed` effect inlines the leaf
// shapes (one level deep — the engine rejects nested delayed-in-delayed
// anyway, so we don't lose expressiveness).
const STAT_EFFECT = {
  type: "OBJECT",
  properties: {
    kind: { type: "STRING", enum: ["stat"] },
    statId: { type: "STRING", minLength: 1, maxLength: 64 },
    delta: { type: "NUMBER" },
  },
  required: ["kind", "statId", "delta"],
} as const;

const CURRENCY_EFFECT = {
  type: "OBJECT",
  properties: {
    kind: { type: "STRING", enum: ["currency"] },
    delta: { type: "NUMBER" },
  },
  required: ["kind", "delta"],
} as const;

// FLATTENED inventory_add. The engine's Zod schema (and existing
// downstream code) expects `{ kind: "inventory_add", item: { id, label,
// description? } }` — a nested OBJECT — but Gemini's responseSchema
// rejects nested-OBJECT-inside-anyOf-branch with HTTP 400 (verified
// against gemini-3-flash-preview, 2026-05-25). The flat shape here is
// re-nested by `normalizeFlatInventoryAdd` in `vertex.ts` before the
// proposal hits Zod, so the rest of the system sees the legacy shape
// unchanged. The `description` is omitted entirely (uncommon, rarely
// useful) to keep the wire shape minimal.
const INVENTORY_ADD_EFFECT = {
  type: "OBJECT",
  properties: {
    kind: { type: "STRING", enum: ["inventory_add"] },
    itemId: { type: "STRING", minLength: 1, maxLength: 64 },
    itemLabel: { type: "STRING", minLength: 1, maxLength: 120 },
  },
  required: ["kind", "itemId", "itemLabel"],
} as const;

const INVENTORY_REMOVE_EFFECT = {
  type: "OBJECT",
  properties: {
    kind: { type: "STRING", enum: ["inventory_remove"] },
    itemId: { type: "STRING", minLength: 1, maxLength: 64 },
  },
  required: ["kind", "itemId"],
} as const;

// flag_set's `value` is conceptually a union (boolean | number | string)
// in the engine's Zod schema, but Gemini's responseSchema rejects
// `anyOf` of primitive types as a property value with HTTP 400 (verified
// against gemini-3-flash-preview, 2026-05-25). We constrain to STRING
// only at the wire boundary; the LLM stringifies booleans/numbers when
// needed ("true", "1") and the engine accepts strings cleanly via the
// z.union branch. Trade-off: the LLM can't emit native JSON booleans/
// numbers for flag values, which is fine — flag values are state tags,
// not arithmetic operands, and the engine has the same downstream
// behavior regardless of the JS type.
const FLAG_SET_EFFECT = {
  type: "OBJECT",
  properties: {
    kind: { type: "STRING", enum: ["flag_set"] },
    flag: { type: "STRING", minLength: 1, maxLength: 64 },
    value: { type: "STRING", maxLength: 240 },
  },
  required: ["kind", "flag", "value"],
} as const;

const FLAG_UNSET_EFFECT = {
  type: "OBJECT",
  properties: {
    kind: { type: "STRING", enum: ["flag_unset"] },
    flag: { type: "STRING", minLength: 1, maxLength: 64 },
  },
  required: ["kind", "flag"],
} as const;

// DELAYED_EFFECT is intentionally OMITTED from the wire schema. It would
// require nested anyOf-inside-anyOf (the outer effects array's anyOf,
// then the inner delayed.effects array's anyOf of leaves), which Gemini
// rejects past one level of nesting in practice. The engine still
// SUPPORTS delayed effects from authored stories; the LLM just can't
// propose them. This is a v0 trade-off — almost no LLM-driven turns
// emit delayed effects, and authored seeds (training-room etc.) carry
// them directly without going through the proposal path.
const LEAF_EFFECTS = [
  STAT_EFFECT,
  CURRENCY_EFFECT,
  INVENTORY_ADD_EFFECT,
  INVENTORY_REMOVE_EFFECT,
  FLAG_SET_EFFECT,
  FLAG_UNSET_EFFECT,
] as const;

const ANY_EFFECT = {
  anyOf: [...LEAF_EFFECTS],
} as const;

const CHOICE_SCHEMA = {
  type: "OBJECT",
  properties: {
    id: { type: "STRING", minLength: 1, maxLength: 64 },
    label: { type: "STRING", minLength: 1, maxLength: 240 },
    tone: { type: "STRING", minLength: 1, maxLength: 32 },
    effects: {
      type: "ARRAY",
      maxItems: MAX_EFFECTS_PER_CHOICE,
      items: ANY_EFFECT,
    },
  },
  required: ["id", "label"],
} as const;

const TERMINAL_SCHEMA = {
  type: "OBJECT",
  nullable: true,
  properties: {
    kind: { type: "STRING", enum: ["death", "success", "safe"] },
    endingId: { type: "STRING", minLength: 1, maxLength: 64 },
    label: { type: "STRING", minLength: 1, maxLength: 160 },
  },
  required: ["kind", "endingId"],
} as const;

/** Full scene response schema — mirrors `llmSceneOutputSchema` in the engine. */
export const SCENE_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    // Required core. propertyOrdering puts these first so a truncated
    // response is still maximally useful (prose + choices = playable).
    prose: { type: "STRING", minLength: 1, maxLength: MAX_PROSE_CHARS },
    choices: {
      type: "ARRAY",
      minItems: MIN_CHOICES,
      maxItems: MAX_CHOICES,
      items: CHOICE_SCHEMA,
    },
    // Optional terminal — null means "scene continues, no ending".
    terminal: TERMINAL_SCHEMA,
    // Presentational metadata. Optional. Never mutate state.
    npcMentions: {
      type: "ARRAY",
      maxItems: NPC_MENTIONS_MAX,
      items: { type: "STRING", minLength: 1, maxLength: NPC_ID_MAX },
    },
    visualDescription: { type: "STRING", minLength: 8, maxLength: 320 },
    protagonistAnchor: { type: "STRING", minLength: 8, maxLength: 320 },
    settingAnchor: { type: "STRING", minLength: 8, maxLength: 320 },
  },
  required: ["prose", "choices"],
} as const;

/** Typed export of the schema so test snapshots can pin it. */
export type SceneResponseSchema = typeof SCENE_RESPONSE_SCHEMA;

// =============================================================================
// Story Bible response schema (story-bible R1.2, design §2). Wire mirror of
// the engine's loose `storyBibleOutputSchema` (packages/engine/src/bible.ts) —
// keep the two structurally in sync; `storyBibleResponseSchema.test.ts` pins
// both. Same philosophy as SCENE_RESPONSE_SCHEMA above: the wire schema
// grammar-constrains Gemini so output always parses; the engine's
// `validateProposedBible` remains the hard gate (clamps, slug/dedupe, lockPlan
// key resolution, ≥4-keys salvage rule) so this stays deliberately LOOSE
// (BC5) — bounds here are pacing hints, not validation.
// =============================================================================

// Mirror engine bounds (packages/engine/src/bible.ts R1.2 constants).
const BIBLE_SLUG_MAX = 48;
const BIBLE_LABEL_MAX = 80;
const BIBLE_HINT_MAX = 120;
const BIBLE_REQUIRES_MAX = 160;
const BIBLE_MOTIF_MAX = 40;

const BIBLE_KEY_ENTRY = {
  type: "OBJECT",
  properties: {
    id: { type: "STRING", minLength: 1, maxLength: BIBLE_SLUG_MAX },
    label: { type: "STRING", minLength: 1, maxLength: BIBLE_LABEL_MAX },
    opensHint: { type: "STRING", maxLength: BIBLE_HINT_MAX },
    surfaceBand: { type: "STRING", enum: ["early", "mid", "late"] },
  },
  required: ["id", "label", "opensHint", "surfaceBand"],
} as const;

const BIBLE_DOOR_ENTRY = {
  type: "OBJECT",
  properties: {
    id: { type: "STRING", minLength: 1, maxLength: BIBLE_SLUG_MAX },
    label: { type: "STRING", minLength: 1, maxLength: BIBLE_LABEL_MAX },
    keyId: { type: "STRING", minLength: 1, maxLength: BIBLE_SLUG_MAX },
    gateBand: { type: "STRING", enum: ["mid", "late"] },
    note: { type: "STRING", maxLength: BIBLE_HINT_MAX },
  },
  required: ["id", "label", "keyId", "gateBand"],
} as const;

const BIBLE_CAST_ENTRY = {
  type: "OBJECT",
  properties: {
    id: { type: "STRING", minLength: 1, maxLength: BIBLE_SLUG_MAX },
    label: { type: "STRING", minLength: 1, maxLength: BIBLE_LABEL_MAX },
    want: { type: "STRING", maxLength: BIBLE_HINT_MAX },
    secret: { type: "STRING", maxLength: BIBLE_HINT_MAX },
    bondHint: { type: "STRING", maxLength: BIBLE_HINT_MAX },
    // What the reader SEES — a stable descriptor the image path reuses so a
    // named NPC keeps ONE face across scenes (character-consistency §2).
    appearance: { type: "STRING", maxLength: BIBLE_HINT_MAX },
  },
  required: ["id", "label", "want", "secret", "appearance"],
} as const;

const BIBLE_TWIST_ENTRY = {
  type: "OBJECT",
  properties: {
    id: { type: "STRING", minLength: 1, maxLength: BIBLE_SLUG_MAX },
    label: { type: "STRING", minLength: 1, maxLength: BIBLE_LABEL_MAX },
    precondition: { type: "STRING", maxLength: BIBLE_HINT_MAX },
  },
  required: ["id", "label", "precondition"],
} as const;

const BIBLE_ENDING_HINT_ENTRY = {
  type: "OBJECT",
  properties: {
    endingId: { type: "STRING", minLength: 1, maxLength: BIBLE_SLUG_MAX },
    requires: { type: "STRING", maxLength: BIBLE_REQUIRES_MAX },
  },
  required: ["endingId", "requires"],
} as const;

// The ONE person the reader plays (character-consistency §1). Fixed at bible
// generation and re-injected verbatim into every scene/image prompt via the
// digest — the load-bearing anchor against mid-story gender/identity drift.
// `appearance` is an array of 2–6 short descriptors (minItems forces the model
// to commit specifics, not a single vague sentence).
const BIBLE_PROTAGONIST_ENTRY = {
  type: "OBJECT",
  properties: {
    name: { type: "STRING", minLength: 1, maxLength: BIBLE_LABEL_MAX },
    gender: { type: "STRING", maxLength: 40 },
    pronouns: { type: "STRING", maxLength: 40 },
    appearance: {
      type: "ARRAY",
      minItems: 2,
      maxItems: 6,
      items: { type: "STRING", minLength: 1, maxLength: 60 },
    },
    voice: { type: "STRING", maxLength: BIBLE_HINT_MAX },
  },
  required: ["name", "gender", "pronouns", "appearance"],
} as const;

/**
 * Full Story Bible response schema — mirrors `storyBibleOutputSchema` in the
 * engine. `keyRegistry` leads via propertyOrdering intent (required-first) so
 * a truncated response is still salvageable (the ≥4-keys rule is the only hard
 * gate).
 */
export const STORY_BIBLE_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    // Identity leads the object (propertyOrdering intent) so the model fixes
    // the protagonist before planning nouns.
    protagonist: BIBLE_PROTAGONIST_ENTRY,
    keyRegistry: {
      type: "ARRAY",
      minItems: 6,
      maxItems: 12,
      items: BIBLE_KEY_ENTRY,
    },
    lockPlan: { type: "ARRAY", maxItems: 5, items: BIBLE_DOOR_ENTRY },
    // `minItems: 2` + `cast` in `required` is the empty-cast fix: with cast
    // optional and no floor, the grammar-constrained model satisfied the schema
    // by emitting an empty array on nearly every save (character-consistency §2).
    cast: { type: "ARRAY", minItems: 2, maxItems: 5, items: BIBLE_CAST_ENTRY },
    twists: { type: "ARRAY", maxItems: 4, items: BIBLE_TWIST_ENTRY },
    endingHints: { type: "ARRAY", maxItems: 4, items: BIBLE_ENDING_HINT_ENTRY },
    motifs: {
      type: "ARRAY",
      maxItems: 6,
      items: { type: "STRING", minLength: 1, maxLength: BIBLE_MOTIF_MAX },
    },
  },
  required: ["keyRegistry", "protagonist", "cast"],
} as const;

/** Typed export so the pin test can snapshot the wire contract. */
export type StoryBibleResponseSchema = typeof STORY_BIBLE_RESPONSE_SCHEMA;
