import { z } from "zod";

import {
  advanceActIfDue,
  applyClockAdvance,
  arcAllowsEnding,
  darkNightBeatIds,
  fireBeat,
  findArcBeat,
  nextTargetBeat,
  normalizeEndingId,
  tickClock,
} from "./arc";
import { processGatedChoices } from "./bible";
import type { RegistryEvent, RegistrySnapshot } from "./bible";
import { resolveDeath } from "./death";
import { popDueDelayedEffects, scheduleThread } from "./delayed";
import { unlockCurrentEnding } from "./endings";
import { getFlag, setFlag, unsetFlag } from "./flags";
import { addItem, hasItem, hasItemTolerant, recordEverGranted, removeItem } from "./inventory";
import { fireBondCrossings } from "./npcs";
import { cloneState } from "./state";
import {
  applyStatDelta,
  ensureFactionRepAttributes,
  getStat,
  normalizeFactionReps,
} from "./stats";
import type {
  Effect,
  EngineContext,
  EngineDiff,
  EngineEvent,
  EngineResult,
  NpcRole,
  NpcState,
  PlayerState,
  StoryArc,
  Story,
} from "./types";
import { NPC_DISPOSITION_MAX, NPC_DISPOSITION_MIN } from "./types";

// =============================================================================
// LLM scene contract: the LLM proposes prose + 2-4 choices + effects + an
// optional terminal marker. The engine is the deterministic validator. We
// clamp numeric deltas and reject shape violations rather than mutating the
// game state with whatever the model returns.
// =============================================================================

const STAT_DELTA_BOUND = 10;
const CURRENCY_DELTA_BOUND = 100;
const DELAYED_MAX_HORIZON = 12;
const MAX_EFFECTS_PER_CHOICE = 6;
/** A Chekhov thread bundles 1–3 leaf effects (Requirement 3.1). */
const MAX_DELAYED_LEAF_EFFECTS = 3;
/** ≤1 delayed thread may be scheduled per applied proposal (Requirement 3.1). */
const MAX_DELAYED_PER_PROPOSAL = 1;
/** Foreshadow line clamp on a `delayed` thread (Requirement 3.1). */
const THREAD_NOTE_MAX = 120;
/** 0–2 conditions per gated choice (Requirement 4.1). */
const MAX_CONDITIONS_PER_CHOICE = 2;
const LOCKED_HINT_MAX = 90;
const MAX_CHOICES = 4;
const MIN_CHOICES = 2;
// -- W2 (Requirements 7–9) ---------------------------------------------------
/** successNote / failNote clamp on a checked choice (Requirement 7.1). */
const CHECK_NOTE_MAX = 90;
/** Net disposition change per NPC per turn (Requirement 8.1). */
const NPC_LLM_DISPOSITION_BOUND = 15;
/** `npc_learn_fact` text clamp — tighter than the authored 200 (Requirement 8.1). */
const NPC_FACT_LLM_MAX = 120;
/** FIFO cap on facts per NPC (Requirement 8.1). */
const NPC_FACT_CAP = 12;
/** Roster ceiling — `npc_spawn` beyond this is dropped (Requirement 8.1). */
const NPC_ROSTER_CAP = 8;
const NPC_NAME_MAX = 48;
const NPC_DESC_MAX = 160;
/** `clock_advance.reason` clamp (Requirement 9.2). */
const CLOCK_REASON_MAX = 80;
/** ≤1 `clock_advance` per applied proposal (Requirement 9.2); extras dropped. */
const MAX_CLOCK_ADVANCE_PER_PROPOSAL = 1;
/** Codex entry cap (Requirement 11.1). */
const CODEX_CAP = 40;
// Non-terminal scenes always keep ≥2 available choices (Requirement 4.5) —
// the invariant now lives in bible.ts's processGatedChoices (story-bible R4),
// which evaluateLlmSceneChoices delegates to.
// Authoritative bound on the engine's scene prose. With `responseSchema`
// dropped from the Vertex provider (gemini-3-flash-preview ignores it),
// the Zod parser is the actual gate. The model self-paces well under
// this with only `responseMimeType: "application/json"` set — 11-trial
// test (2026-05-28) showed median ~1500 chars per turn. The 12K ceiling
// stays here as the hard upper bound for legacy compatibility.
const MAX_PROSE_CHARS = 12_000;

// Clamp-instead-of-reject string. Gemini's responseSchema soft-ignores
// `maxLength` constraints on strings — verified 2026-05-25 where the LLM
// produced a 380-char visualDescription despite `maxLength: 320`, and
// a tone string > 32 chars despite the bound. Rather than play whack-a-
// mole on every string field, every LLM-emitted string in this proposal
// schema uses `clampedString` so over-length values truncate at parse
// time instead of failing `llm_scene_invalid_shape` and sending the
// router into the deterministic fallback (which produces the broken
// "premise as prose" output the user saw repeatedly).
function clampedString(opts: { min?: number; max: number }) {
  const min = opts.min ?? 0;
  return z
    .string()
    .min(min)
    .transform((s) => (s.length > opts.max ? s.slice(0, opts.max) : s));
}

const itemSchema = z.object({
  id: clampedString({ min: 1, max: 64 }),
  label: clampedString({ min: 1, max: 120 }),
  description: clampedString({ max: 480 }).optional(),
});

// Effects the LLM may propose at the leaf — no nested delayed effects allowed
// from the model. The engine still supports authored delayed effects; the LLM
// surface is intentionally narrower because nested validation across an
// open-ended horizon is hard to reason about under untrusted input.
const leafEffectSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("stat"),
    statId: clampedString({ min: 1, max: 64 }),
    delta: z
      .number()
      .finite()
      .transform((value) => clampDelta(value, STAT_DELTA_BOUND)),
  }),
  z.object({
    kind: z.literal("currency"),
    delta: z
      .number()
      .finite()
      .transform((value) => clampDelta(value, CURRENCY_DELTA_BOUND)),
  }),
  z.object({ kind: z.literal("inventory_add"), item: itemSchema }),
  z.object({ kind: z.literal("inventory_remove"), itemId: clampedString({ min: 1, max: 64 }) }),
  z.object({
    kind: z.literal("flag_set"),
    flag: clampedString({ min: 1, max: 64 }),
    value: z.union([z.boolean(), z.number().finite(), clampedString({ max: 240 })]),
  }),
  z.object({ kind: z.literal("flag_unset"), flag: clampedString({ min: 1, max: 64 }) }),
]);

// Chekhov thread (Requirement 3): a delayed effect carrying a foreshadow
// `note`. Previously validated-then-dropped in `applyEffect`; now scheduled
// via the delayed store. Bundles 1–3 leaf effects that fire together after the
// horizon elapses.
const delayedEffectSchema = z.object({
  kind: z.literal("delayed"),
  delayNodes: z.number().int().positive().max(DELAYED_MAX_HORIZON),
  effects: z.array(leafEffectSchema).min(1).max(MAX_DELAYED_LEAF_EFFECTS),
  note: clampedString({ max: THREAD_NOTE_MAX }).optional(),
});

// W2 NPC + clock effects (Requirements 8, 9). These are now LLM-legal (the W1
// guard kept ALL npc_* dropped; W2 opens exactly spawn/disposition/fact — the
// other npc_* kinds stay out of the union and are still tolerant-dropped). Each
// is length/enum-clamped; the engine applies clamps/caps again at apply time.
const npcRoleSchema = z
  .enum(["companion", "ally", "rival", "neutral", "antagonist"])
  .catch("neutral");

const npcDispositionDeltaSchema = z.object({
  kind: z.literal("npc_disposition_delta"),
  npcId: clampedString({ min: 1, max: 64 }),
  delta: z
    .number()
    .finite()
    .transform((value) => clampDelta(value, NPC_LLM_DISPOSITION_BOUND)),
});

const npcLearnFactSchema = z.object({
  kind: z.literal("npc_learn_fact"),
  npcId: clampedString({ min: 1, max: 64 }),
  fact: clampedString({ min: 1, max: NPC_FACT_LLM_MAX }),
});

const npcSpawnSchema = z.object({
  kind: z.literal("npc_spawn"),
  id: clampedString({ min: 1, max: 64 }),
  name: clampedString({ min: 1, max: NPC_NAME_MAX }),
  role: npcRoleSchema,
  description: clampedString({ min: 1, max: NPC_DESC_MAX }).optional(),
});

const clockAdvanceSchema = z.object({
  kind: z.literal("clock_advance"),
  amount: z.union([z.literal(1), z.literal(2)]).catch(1),
  reason: clampedString({ min: 1, max: CLOCK_REASON_MAX }).optional(),
});

export const llmEffectSchema = z.union([
  leafEffectSchema,
  delayedEffectSchema,
  npcDispositionDeltaSchema,
  npcLearnFactSchema,
  npcSpawnSchema,
  clockAdvanceSchema,
]);

// Conditions the LLM may attach to a choice to gate it (Requirement 4.1). A
// strict subset of the engine `Condition` union PLUS `currency_at_least` (the
// engine's authored-story path has no currency predicate; the llm path adds
// it here without widening the shared `Condition` type). Each entry is
// tolerant-dropped individually at parse time, mirroring `effects`.
const llmChoiceConditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("stat_at_least"), statId: clampedString({ min: 1, max: 64 }), value: z.number().finite() }),
  z.object({ kind: z.literal("stat_at_most"), statId: clampedString({ min: 1, max: 64 }), value: z.number().finite() }),
  z.object({ kind: z.literal("has_item"), itemId: clampedString({ min: 1, max: 64 }) }),
  z.object({ kind: z.literal("missing_item"), itemId: clampedString({ min: 1, max: 64 }) }),
  z.object({
    kind: z.literal("flag_equals"),
    flag: clampedString({ min: 1, max: 64 }),
    value: z.union([z.boolean(), z.number().finite(), clampedString({ max: 240 })]),
  }),
  z.object({ kind: z.literal("currency_at_least"), value: z.number().finite() }),
]);

export type LlmChoiceCondition = z.infer<typeof llmChoiceConditionSchema>;

// Optional skill check on a choice (Requirement 7.1). The engine resolves it
// deterministically at submission (`resolveChoiceCheck` in stats.ts). Tolerant:
// a malformed check is dropped (`.catch(undefined)`) so the choice — and turn —
// survive. Mutual exclusivity with `conditions` and the ≤1-per-scene cap are
// enforced by the transforms below (design §1.3 / W2-E1).
const skillCheckSchema = z.object({
  statId: clampedString({ min: 1, max: 64 }),
  difficulty: z.enum(["easy", "risky", "desperate"]),
  successNote: clampedString({ min: 1, max: CHECK_NOTE_MAX }).optional(),
  failNote: clampedString({ min: 1, max: CHECK_NOTE_MAX }).optional(),
});

export type LlmSkillCheck = z.infer<typeof skillCheckSchema>;

const llmChoiceObject = z.object({
  id: clampedString({ min: 1, max: 64 }),
  label: clampedString({ min: 1, max: 240 }),
  tone: clampedString({ min: 1, max: 32 }).optional(),
  // Tolerant effects: an LLM occasionally emits an unrecognized effect `kind`
  // (or more than the per-choice cap). Rejecting the whole scene over one bad
  // effect throws away an otherwise-valid turn (good prose + choices) and
  // hard-fails the read loop with `llm_scene_invalid_shape`. The engine is
  // authoritative over effects anyway — it clamps deltas and strips strings
  // right here — so drop only the malformed/excess effects and keep the rest.
  // Valid effects still parse (and clamp) exactly as before. The convex parse
  // boundary logs what was dropped so model drift stays visible.
  effects: z
    .array(z.unknown())
    .transform((raw) =>
      raw.reduce<z.infer<typeof llmEffectSchema>[]>((kept, candidate) => {
        if (kept.length >= MAX_EFFECTS_PER_CHOICE) return kept;
        const parsed = llmEffectSchema.safeParse(candidate);
        if (parsed.success) kept.push(parsed.data);
        return kept;
      }, []),
    )
    .optional(),
  // Tolerant conditions (Requirement 4.1): 0–2 per choice, each entry
  // safeParse'd individually so a single malformed condition is dropped
  // rather than failing the turn (same pattern as `effects`). Server-side
  // visibility evaluation (`evaluateLlmChoiceVisibility`) turns surviving
  // conditions into `visible | locked`; the convex parse boundary logs drops.
  conditions: z
    .array(z.unknown())
    .transform((raw) =>
      raw.reduce<LlmChoiceCondition[]>((kept, candidate) => {
        if (kept.length >= MAX_CONDITIONS_PER_CHOICE) return kept;
        const parsed = llmChoiceConditionSchema.safeParse(candidate);
        if (parsed.success) kept.push(parsed.data);
        return kept;
      }, []),
    )
    .optional(),
  /** Caption shown on the 🔒 locked card (Requirement 4.1). */
  lockedHint: clampedString({ min: 1, max: LOCKED_HINT_MAX }).optional(),
  /**
   * Skill check gating this choice (Requirement 7.1). Tolerant-dropped when
   * malformed. Dropped entirely when the choice also carries `conditions`
   * (checks and locks are mutually exclusive — locks win, Requirement 7.5).
   */
  skillCheck: skillCheckSchema.optional().catch(undefined),
});

// Per-choice mutual exclusivity (Requirement 7.5): a choice may be locked OR
// checked, never both. Conditions win — the check is dropped. Applied as a
// transform so `LlmChoiceProposal` still exposes an optional `skillCheck`.
export const llmChoiceSchema = llmChoiceObject.transform((choice) => {
  if (choice.skillCheck && (choice.conditions?.length ?? 0) > 0) {
    return { ...choice, skillCheck: undefined };
  }
  return choice;
});

export const llmTerminalSchema = z.object({
  kind: z.enum(["death", "success", "safe"]),
  endingId: clampedString({ min: 1, max: 64 }),
  label: clampedString({ min: 1, max: 160 }).optional(),
});

// Keepsake earned at an ending (Requirement 12.1, W3). Only HONORED on terminal
// scenes — the scene-level transform below strips a keepsake proposed on a
// non-terminal scene. Length-clamped (`label ≤48`, `description ≤160`, id a
// bounded slug). Tolerant: a malformed keepsake is DROPPED (`.catch`) so the
// terminal scene — and the turn — still parses (BC5).
const keepsakeSchema = z.object({
  id: clampedString({ min: 1, max: 64 }),
  label: clampedString({ min: 1, max: 48 }),
  description: clampedString({ min: 1, max: 160 }),
});

export type LlmKeepsakeProposal = z.infer<typeof keepsakeSchema>;

// Loose turn-1 arc envelope (Requirement 1.1). The schema only shape-checks
// that the core string fields + arrays are present; full clamping/validation
// happens later via `validateProposedArc` (convex, turn 1 only). `.catch`
// tolerantly DROPS a malformed arc (→ undefined) so the scene still parses and
// the server falls back to `synthesizeFallbackArc` (BC5). Ignored on turns >1,
// mirroring the one-time `protagonistAnchor` pattern.
const rawStoryArcSchema = z
  .object({
    dramaticQuestion: z.string(),
    protagonistWant: z.string(),
    stakes: z.string(),
    act: z.unknown().optional(),
    beats: z.array(z.unknown()),
    candidateEndings: z.array(z.unknown()),
  })
  .passthrough();

export type LlmStoryArcProposal = z.infer<typeof rawStoryArcSchema>;

// Scene fields shared by BOTH the branching scene schema and the additive
// novel-mode sibling (R4.3 / RM2). Only `choices` differs between the two
// (min(MIN_CHOICES=2) for branching vs min(0).max(1) for novel), so `choices`
// is injected per-schema by `buildSceneOutputSchema` below rather than living
// here. Every OTHER field — prose / terminal / storyArc / beatFired /
// twistFired / keepsake / npcMentions / visualDescription / protagonist- and
// settingAnchor — is byte-identical across the two schemas by construction.
const sceneOutputFields = {
  prose: z.string().min(1).max(MAX_PROSE_CHARS),
  terminal: llmTerminalSchema.nullable().optional(),
  /**
   * Turn-1 story arc (Requirement 1.1). Validated later via
   * `validateProposedArc`; malformed arcs are dropped here (`.catch`) so the
   * scene survives and the server synthesizes a fallback. Ignored on turns
   * >1 (same one-time contract as `protagonistAnchor`).
   */
  storyArc: rawStoryArcSchema.optional().catch(undefined),
  /**
   * Beat id the model claims this scene landed (Requirement 1.4). The engine
   * marks it fired (idempotent; unknown/already-fired ids are no-ops). Clamped
   * to a bounded slug-ish string; tolerant — a stray value is simply not
   * matched against the arc.
   */
  beatFired: clampedString({ min: 1, max: 48 }).optional(),
  /**
   * Twist id the model claims this scene fired (story-bible twist loop —
   * exact mirror of `beatFired`). The convex turn integration slug-matches it
   * against the bible's PENDING twists and folds a `twist_fired` event so the
   * digest stops re-demanding an already-revealed twist. Clamped + tolerant:
   * an unknown / already-fired id is simply never matched (BC5). Ignored on
   * bible-less saves.
   */
  twistFired: clampedString({ min: 1, max: 48 }).optional(),
  /**
   * Keepsake earned at this ending (Requirement 12.1, W3). Honored ONLY on
   * terminal scenes — the transform below strips it when `terminal` is
   * absent/null so a non-terminal scene can never mint a keepsake (the engine
   * clamps it, per the W3 contract). Malformed keepsakes are dropped
   * (`.catch`) so the scene still parses (BC5). Persisted onto the
   * `endings_unlocked` row by `recordEndingUnlock` (convex), which derives a
   * default from the ending when this is absent.
   */
  keepsake: keepsakeSchema.optional().catch(undefined),
  /**
   * NPC ids the model believes were mentioned in this scene's prose.
   * Optional — the model is encouraged to populate this but legacy
   * proposals (and providers that don't yet honor the contract) simply
   * omit it. Persisted by `convex/game.ts` as `turn_history.mentionsExtracted`
   * so the next turn's prompt-builder can surface the relevant NPC sheets
   * without re-parsing prose (Requirement 31.3 / 31.4).
   *
   * Bounded at 10 to keep the recent-mentions window small enough that
   * `loadRecentNpcMentions` doesn't pull a runaway list back into the
   * prompt; the convex helper still de-dupes / orders by recency.
   */
  npcMentions: z.array(clampedString({ min: 1, max: 64 })).max(10).optional(),
  /**
   * Concrete scene description optimized for image and video generation.
   * One short sentence naming the subject, setting, key objects, and
   * composition — e.g. "Boeing 737 cockpit at dawn, captain slumped over
   * the yoke, snow blowing through a cracked windshield, wide shot from
   * the first officer's seat." When present, the convex media queue uses
   * this verbatim instead of truncating the prose. Bounded at 320 chars
   * so prompt-hash stability and Imagen/Veo token budgets both hold.
   *
   * Why this exists: prose truncation produces incoherent images (the
   * model that draws does not know what the model that wrote was thinking).
   * Asking the writer to articulate the visual closes that gap.
   */
  visualDescription: clampedString({ min: 8, max: 1000 }).optional(),
  /**
   * One-time character anchor written at scene 1. Describes the protagonist
   * for portrait generation: face/build/clothing/era. The image pipeline
   * uses this to generate the protagonist anchor that gets passed as a
   * reference image to every subsequent scene's image call.
   * Optional — only meaningful on the first turn; ignored thereafter.
   */
  protagonistAnchor: clampedString({ min: 8, max: 1000 }).optional(),
  /**
   * One-time setting anchor written at scene 1. Establishing shot of the
   * primary location (or the most defining one if the story has multiple).
   * Same purpose as protagonistAnchor — referenced in subsequent calls
   * to keep the world visually consistent.
   */
  settingAnchor: clampedString({ min: 8, max: 1000 }).optional(),
} as const;

// Duplicate-choice-id refinement + the ≤1-skill-check / terminal-only-keepsake
// transform, both shared verbatim by the branching and novel schemas so the two
// differ ONLY in choice cardinality. Factored into `buildSceneOutputSchema` so
// there is exactly one definition of the scene shape (RM2: the novel schema is
// an ADDITIVE sibling, not a divergent fork).
function buildSceneOutputSchema<C extends z.ZodTypeAny>(choices: C) {
  return z
    .object({ ...sceneOutputFields, choices })
    .superRefine((value, ctx) => {
      const ids = new Set<string>();
      (value.choices as LlmChoiceProposal[]).forEach((choice, index) => {
        if (ids.has(choice.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["choices", index, "id"],
            message: `duplicate_choice_id:${choice.id}`,
          });
        }
        ids.add(choice.id);
      });
    })
    // ≤1 checked choice per scene (Requirement 7.1): keep the first choice that
    // carries a `skillCheck` (array order), strip the check from any others.
    // W3 (Requirement 12.1): a `keepsake` is honored ONLY on terminal scenes — a
    // keepsake proposed on a non-terminal scene is clamped away here so it can
    // never be minted mid-run.
    .transform((scene) => {
      let checkSeen = false;
      const choices = (scene.choices as LlmChoiceProposal[]).map((choice) => {
        if (!choice.skillCheck) return choice;
        if (checkSeen) return { ...choice, skillCheck: undefined };
        checkSeen = true;
        return choice;
      });
      const { keepsake, ...base } = scene;
      const honoredKeepsake = base.terminal ? keepsake : undefined;
      return { ...base, choices, ...(honoredKeepsake ? { keepsake: honoredKeepsake } : {}) };
    });
}

// The branching scene contract (byte-identical to HEAD): 2–4 choices enforced
// by MIN_CHOICES/MAX_CHOICES. This is the real gate for every branching / legacy
// save (RM2). The wire `responseSchema.ts` gates nothing here — do not edit it.
export const llmSceneOutputSchema = buildSceneOutputSchema(
  z.array(llmChoiceSchema).min(MIN_CHOICES).max(MAX_CHOICES),
);

// R4.3 — the ADDITIVE novel-mode sibling. Identical to `llmSceneOutputSchema`
// in EVERY field EXCEPT `choices`, which relaxes to `max(1)` AND becomes
// optional with a `[]` default — a linear "Turn the page" scene omits `choices`
// entirely (the novel prompt emits prose+terminal only), so the field must
// tolerate being ABSENT, not merely empty. Without the `.default([])` the LLM's
// choice-less novel payload is rejected with `choices: Required` (invalid_type)
// and the turn fails. The server stamps the single synthetic `turn-page` choice
// after validation (R4.2/R4.4). Selected by `sceneSchemaFor` at the five parse
// sites ONLY when `readingMode === "novel"`; the branching schema stays untouched.
export const llmNovelSceneOutputSchema = buildSceneOutputSchema(
  z.array(llmChoiceSchema).max(1).default([]),
);

// The ONLY place the readingMode → scene-schema mapping lives (design §1.3). A
// pure, total selector: `"novel"` picks the relaxed novel sibling; everything
// else (`"branching"`, or absent on a legacy/authored save) picks the
// byte-identical branching schema. Keeping this in one function keeps the five
// parse sites honest — none of them re-derives the mapping.
export function sceneSchemaFor(
  readingMode: "branching" | "novel" | undefined,
): typeof llmSceneOutputSchema | typeof llmNovelSceneOutputSchema {
  return readingMode === "novel" ? llmNovelSceneOutputSchema : llmSceneOutputSchema;
}

// R4.9 / RM5 — pure, total resolver mirroring `computeMediaStrategy`'s shape: a
// seam so the founder's Pro gate on novel mode is a one-line change, not a
// threading job. Posture A (OQ1/OQ9 = LOCKED AT createSave): resolve the
// desired reading mode ONCE at create and keep it for the save's lifetime, so a
// lapsed Pro never has a prose-only prompt suddenly asked for 2–4 choices
// mid-read. `desired` absent ⇒ "branching" (every legacy/default save). A
// non-Pro reader who asked for "novel" degrades to "branching" HERE, at create
// only. Flipping to switchable (posture B) is the one-line change of dropping
// the `isPro` degrade.
export function resolveReadingMode(input: {
  desired?: "branching" | "novel";
  isPro: boolean;
}): "branching" | "novel" {
  const { desired, isPro } = input;
  if (desired !== "novel") return "branching";
  return isPro ? "novel" : "branching";
}

export type LlmEffect = z.infer<typeof llmEffectSchema>;
export type LlmChoiceProposal = z.infer<typeof llmChoiceSchema>;
export type LlmTerminalProposal = z.infer<typeof llmTerminalSchema>;
export type LlmSceneProposal = z.infer<typeof llmSceneOutputSchema>;
/**
 * R4.3 — the novel-mode proposal shape. Structurally identical to
 * `LlmSceneProposal` (same fields, same `LlmChoiceProposal[]` element type);
 * they differ only in runtime choice cardinality (0–1 vs 2–4), so a novel
 * proposal is assignable wherever a scene proposal is expected.
 */
export type LlmNovelSceneProposal = z.infer<typeof llmNovelSceneOutputSchema>;

/**
 * Instruction the terminal gate hands back to the prompt builder when it
 * strips or reshapes a proposed ending (Requirement 2). The server stores it
 * as `pendingDirective` on the save and clears it after the next prompt build.
 */
export type TerminalDirective =
  | "narrate_costly_survival"
  | `surface_beat:${string}`;

/** Per-choice visibility result on the llm path (Requirement 4). */
export type LlmChoiceVisibility = {
  visibility: "visible" | "locked";
  lockedHint?: string;
  /**
   * Near-miss band for a locked NUMERIC gate (stat/currency), where the failing
   * condition has value + threshold in hand: "near" when the reader is within
   * 1 point or 20% of the threshold, "far" otherwise. Absent on binary gates
   * (item/flag) and on visible choices. This is a BAND, never the numbers —
   * the projection forwards it as a phrase so raw thresholds stay server-side
   * (BC10, same discipline as the skill-check odds phrase).
   */
  nearness?: "near" | "far";
};

export type LlmSceneChoiceVisibility = LlmChoiceVisibility & { choiceId: string };

export type LlmSceneApplyResult = EngineResult & {
  proposal: LlmSceneProposal;
  terminal: LlmTerminalProposal | null;
  /**
   * The prompt directive produced by the terminal gate this turn (Requirement
   * 2), or null when the terminal was honored / no arc gate applied.
   */
  directive: TerminalDirective | null;
  /**
   * The choice the player just took (its effects were already applied).
   * Null when entering the opening scene of an LLM-driven story.
   */
  appliedChoiceId: string | null;
};

/**
 * Parse a raw LLM payload (either a JSON string or already-parsed value) into
 * a validated scene proposal. Throws when the shape is invalid; clamps deltas
 * to engine-safe ranges.
 */
export function parseLlmSceneProposal(input: unknown): LlmSceneProposal {
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed.startsWith("{")) throw new Error("llm_scene_not_json");
    try {
      return llmSceneOutputSchema.parse(JSON.parse(trimmed));
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error("llm_scene_invalid_json");
      throw error;
    }
  }
  return llmSceneOutputSchema.parse(input);
}

/**
 * Phase A of the llm-driven turn: apply the effects of the choice the player
 * just took (validated against the prior proposal) and stamp a synthetic node
 * id for the new scene. Returns the next state cursor that the LLM will write
 * prose against. Does not require — and does not validate — the next
 * proposal, which is still being generated when this runs.
 *
 * For the opening scene of an llm-driven story, pass `priorProposal: null`
 * and `choiceId: null`; nothing is applied and the cursor moves to
 * `<storyId>:llm:0`.
 */
export function advanceLlmTurnCursor(input: {
  state: PlayerState;
  story: Story;
  priorProposal: LlmSceneProposal | null;
  choiceId: string | null;
  ctx: EngineContext;
  /**
   * Free-form path: when true, advance the turn cursor and emit a
   * `choice_applied` event for the given `choiceId` without looking it up
   * in `priorProposal.choices`. No effects are applied (the reader typed
   * their own action — there were no LLM-proposed effects to honor). The
   * caller is responsible for persisting the user-typed label to
   * turn_history so the next-scene memory beat reads naturally.
   *
   * Requires `choiceId` to be non-null; ignored when false or when the
   * regular prior-proposal branch fires.
   */
  freeform?: boolean;
  /**
   * Whether the taken choice's OWN llm effects apply this turn (Requirement
   * 7.3, W2). Defaults true (legacy + unchecked choices). The server sets it
   * false when a `skillCheck` on the taken choice did NOT succeed — the check's
   * engine-authored cost is applied server-side instead. Threads still tick and
   * the turn still advances regardless.
   */
  applyChoiceEffects?: boolean;
}): EngineResult & { appliedChoiceId: string | null; nodeId: string } {
  const {
    state,
    story,
    priorProposal,
    choiceId,
    ctx,
    freeform = false,
    applyChoiceEffects = true,
  } = input;
  void ctx; // engine context is reserved for future-deterministic plumbing
  const next = cloneState(state);
  const diffs: EngineDiff[] = [];
  const events: EngineEvent[] = [];
  let appliedChoiceId: string | null = null;
  // Capture pre-turn clock expiry so we only fire the `clock_expired`
  // transition (dark_night auto-fire) once, on the turn it crosses the line.
  const clockWasExpired = next.clock?.expired ?? false;

  if (priorProposal && choiceId && !freeform) {
    const choice = priorProposal.choices.find((candidate) => candidate.id === choiceId);
    if (!choice) throw new Error(`llm_choice_not_found:${choiceId}`);
    // Tick pending Chekhov threads BEFORE applying the chosen choice's effects
    // (Requirement 3.2 / design §1.3 ordering): a thread planted last turn with
    // delayNodes=1 fires now, and its fired effects clamp identically to direct
    // effects.
    tickDelayedThreads(next, diffs, events);
    if (applyChoiceEffects) {
      // Faction reputation (Panel-2 W3): pre-register any `rep:<factionId>`
      // stat this choice touches as a HIDDEN signed attribute BEFORE the delta
      // applies, so it clamps into [−10, 10] and never leaks into the HUD (the
      // generic ensureLlmStatAttribute would register it VISIBLE 0..5).
      ensureFactionRepAttributes(next, choice.effects ?? []);
      applyEffects(next, choice.effects ?? [], diffs);
    }
    events.push({ kind: "choice_applied", choiceId });
    appliedChoiceId = choiceId;
    next.turnNumber += 1;
  } else if (freeform && choiceId) {
    // Free-form: caller bypasses the prior-proposal lookup. We still want a
    // `choice_applied` event so the memory-window plumbing sees a turn was
    // taken, and we still increment turnNumber so `llmNodeId` below advances
    // to the next slot. Threads still tick — a turn was taken.
    tickDelayedThreads(next, diffs, events);
    events.push({ kind: "choice_applied", choiceId });
    appliedChoiceId = choiceId;
    next.turnNumber += 1;
  }

  // Depth mechanics settle once per COMPLETED turn (Panel-2 W3), after every
  // effect + fired thread has landed this turn's disposition / stat changes:
  //   - normalizeFactionReps re-flags any `rep:*` stat first seen via a fired
  //     thread (which routes through the generic VISIBLE 0..5 path) back to the
  //     hidden signed bounds — the safety net for the pre-registration above.
  //   - fireBondCrossings fires the one-shot loyalty/betrayal crossing for any
  //     NPC whose disposition just reached +75 / −60, surfacing the payoff
  //     through the existing roster (knownFacts) + `fact_learned` diff channels.
  if (appliedChoiceId !== null) {
    normalizeFactionReps(next);
    fireBondCrossings(next, diffs);
  }

  // W2 clock (Requirement 9). A completed turn deterministically ticks the
  // clock (+1 every 3rd turn); an `clock_advance` effect above may also have
  // advanced it. Settle the expiry transition after both (dark_night auto-fire
  // + `clock_expired`).
  if (appliedChoiceId !== null && next.clock) {
    const beforeTick = next.clock;
    const ticked = tickClock(beforeTick, next.turnNumber);
    if (ticked.value !== beforeTick.value) {
      next.clock = ticked;
      diffs.push({
        kind: "clock_advanced",
        target: "clock",
        amount: ticked.value - beforeTick.value,
        reason: "the hours slip past",
        visibility: "visible",
      });
    }
  }
  if (next.clock && next.clock.expired && !clockWasExpired) {
    settleClockExpiry(next, diffs);
  }

  const llmNodeId = `${story.id}:llm:${next.turnNumber}`;
  next.currentNodeId = llmNodeId;
  next.path.push(llmNodeId);
  diffs.push({ kind: "node", target: llmNodeId, delta: 1 });
  events.push({ kind: "node_entered", nodeId: llmNodeId });

  // Death-by-vitality always wins. Authored deathNodeId still kicks in if a
  // designer ever mixes modes (training-room style + llm-driven seed).
  if (story.deathNodeId) {
    resolveDeath(next, story, diffs, events);
  }

  return { state: next, diffs, events, appliedChoiceId, nodeId: llmNodeId };
}

/**
 * Phase B of the llm-driven turn: validate the freshly-generated proposal and
 * record any terminal it carries against the engine state.
 */
export function recordLlmProposalTerminal(input: {
  state: PlayerState;
  story: Story;
  proposal: LlmSceneProposal;
  ctx: EngineContext;
}): EngineResult & { terminal: LlmTerminalProposal | null; directive: TerminalDirective | null } {
  const { state, story, proposal, ctx } = input;
  void ctx;
  const next = cloneState(state);
  const diffs: EngineDiff[] = [];
  const events: EngineEvent[] = [];

  // 1. Beat firing (Requirement 1.4). Only on arc saves; idempotent + tolerant.
  //    Emits `beat_fired` (and `act_advanced` when the act rolls over).
  if (next.arc && proposal.beatFired) {
    const beforeAct = next.arc.act;
    const target = findArcBeat(next.arc, proposal.beatFired);
    const { arc: firedArc, fired } = fireBeat(next.arc, proposal.beatFired, next.turnNumber);
    if (fired && target) {
      const advanced = advanceActIfDue(firedArc);
      next.arc = advanced;
      diffs.push({ kind: "beat_fired", target: target.id, label: target.label, visibility: "visible" });
      if (advanced.act !== beforeAct) {
        diffs.push({ kind: "act_advanced", target: "arc", act: advanced.act, visibility: "visible" });
      }
    }
  }

  // 2. Terminal gate (Requirement 2). Pure decision over the (possibly just
  //    beat-advanced) arc. Arc-less saves pass through untouched — the caller
  //    keeps `guardEarlyTerminal`. `directive` is surfaced for the prompt.
  const gate = gateTerminal(next.arc, proposal.terminal ?? null, next.turnNumber, next.vitality);
  let terminal: LlmTerminalProposal | null = gate.terminal;
  const directive: TerminalDirective | null = gate.directive;

  // Engine-forced death always wins (vitality 0) — the gate passes vitality-0
  // through so this override records the death terminal (Requirement 2.2).
  if (next.vitality <= 0) {
    terminal = {
      kind: "death",
      endingId: terminal?.endingId ?? "ending-death",
      label: terminal?.label ?? "Vitality fails.",
    };
  }

  if (terminal) {
    const endingId = terminal.endingId;
    if (!next.endingsUnlocked[endingId]) {
      next.endingsUnlocked[endingId] = {
        storyId: story.id,
        endingId,
        firstSeenTurn: next.turnNumber,
        mode: next.mode,
        path: [...next.path],
      };
      diffs.push({ kind: "ending", target: endingId, delta: 1 });
      events.push({ kind: "ending_unlocked", endingId });
    }
    if (terminal.kind === "death") {
      events.push({ kind: "death_triggered", nodeId: next.currentNodeId });
    }
  }

  unlockCurrentEnding(next, story, diffs, events);
  return { state: next, diffs, events, terminal, directive };
}

/**
 * Convenience: phase A + phase B combined into one call. Used by the
 * non-streaming `submitChoice` path and by tests, where the full proposal is
 * available up front.
 */
export function applyLlmSceneToState(input: {
  state: PlayerState;
  story: Story;
  priorProposal: LlmSceneProposal | null;
  choiceId: string | null;
  nextProposal: LlmSceneProposal;
  ctx: EngineContext;
  /**
   * Whether the taken choice's own llm effects apply (Requirement 7.3). Passed
   * through to `advanceLlmTurnCursor`; defaults true. The server sets it false
   * when a skill check on the taken choice did not succeed.
   */
  applyChoiceEffects?: boolean;
}): LlmSceneApplyResult {
  const phaseA = advanceLlmTurnCursor({
    state: input.state,
    story: input.story,
    priorProposal: input.priorProposal,
    choiceId: input.choiceId,
    ctx: input.ctx,
    ...(input.applyChoiceEffects !== undefined
      ? { applyChoiceEffects: input.applyChoiceEffects }
      : {}),
  });
  const phaseB = recordLlmProposalTerminal({
    state: phaseA.state,
    story: input.story,
    proposal: input.nextProposal,
    ctx: input.ctx,
  });

  return {
    state: phaseB.state,
    diffs: [...phaseA.diffs, ...phaseB.diffs],
    events: [...phaseA.events, ...phaseB.events],
    proposal: input.nextProposal,
    terminal: phaseB.terminal,
    directive: phaseB.directive,
    appliedChoiceId: phaseA.appliedChoiceId,
  };
}

function applyEffects(state: PlayerState, effects: LlmEffect[], diffs: EngineDiff[]): void {
  let delayedScheduled = 0;
  let clockAdvanced = 0;
  // Net disposition change per NPC across this proposal (Requirement 8.1 —
  // "±15/turn/NPC net clamp"): each additional delta on the same NPC is
  // trimmed so the cumulative applied change never exceeds ±15.
  const dispositionNet: Record<string, number> = {};
  for (const effect of effects) {
    switch (effect.kind) {
      case "delayed":
        // ≤1 delayed thread per applied proposal (Requirement 3.1); extras drop.
        if (delayedScheduled >= MAX_DELAYED_PER_PROPOSAL) continue;
        delayedScheduled += 1;
        applyEffect(state, effect, diffs);
        break;
      case "clock_advance":
        // ≤1 clock_advance per applied proposal (Requirement 9.2); extras drop.
        if (clockAdvanced >= MAX_CLOCK_ADVANCE_PER_PROPOSAL) continue;
        clockAdvanced += 1;
        applyLlmClockAdvance(state, effect, diffs);
        break;
      case "npc_disposition_delta":
        applyLlmDispositionDelta(state, effect, dispositionNet, diffs);
        break;
      case "npc_learn_fact":
        applyLlmLearnFact(state, effect, diffs);
        break;
      case "npc_spawn":
        applyLlmNpcSpawn(state, effect, diffs);
        break;
      default:
        applyEffect(state, effect, diffs);
    }
  }
}

/**
 * Tick pending Chekhov threads and fire the due ones (Requirement 3.2). Fired
 * effects are the same leaf shapes the LLM emits directly, so they route back
 * through `applyEffects` and clamp identically. Each fired thread emits a
 * `thread_fired` diff carrying its foreshadow note.
 */
function tickDelayedThreads(state: PlayerState, diffs: EngineDiff[], events: EngineEvent[]): void {
  const due = popDueDelayedEffects(state, events);
  for (const scheduled of due) {
    // Stored thread effects are leaf-only engine effects (a subset of
    // `LlmEffect`); apply them through the same clamped path.
    applyEffects(state, scheduled.effects as unknown as LlmEffect[], diffs);
    diffs.push({
      kind: "thread_fired",
      target: scheduled.id,
      note: scheduled.note ?? null,
      visibility: "visible",
    });
  }
}

function applyEffect(state: PlayerState, effect: LlmEffect, diffs: EngineDiff[]): void {
  switch (effect.kind) {
    case "stat":
      ensureLlmStatAttribute(state, effect.statId);
      applyStatDelta(state, effect.statId, effect.delta, diffs);
      return;
    case "currency": {
      const before = state.currency;
      state.currency = Math.max(0, before + effect.delta);
      diffs.push({
        kind: "currency",
        target: "currency",
        delta: effect.delta,
        before,
        after: state.currency,
      });
      return;
    }
    case "inventory_add": {
      // Strip undefined description so exactOptionalPropertyTypes is happy
      // when downstream callers rely on the InventoryItem narrowed shape.
      const item: { id: string; label: string; description?: string } = {
        id: effect.item.id,
        label: effect.item.label,
        ...(effect.item.description !== undefined ? { description: effect.item.description } : {}),
      };
      addItem(state, item, diffs);
      // itemsEverGranted ledger (story-bible R4.1): record EVERY llm-path
      // grant — even when addItem no-ops on a duplicate — so registry gate
      // enforcement can prove a key existed after it is consumed. Replace the
      // reference (never push in place): cloneState copies the array, and the
      // previous turn's snapshot must not see this turn's grants.
      state.itemsEverGranted = recordEverGranted(state.itemsEverGranted, item);
      return;
    }
    case "inventory_remove":
      removeItem(state, effect.itemId, diffs);
      return;
    case "flag_set":
      setFlag(state, effect.flag, effect.value, diffs);
      // Codex bookkeeping (Requirement 11.1): stamp the turn a string-valued
      // flag last landed so `deriveCodex` can order newest-first without a
      // diff replay. Replace the reference (never mutate in place) so the
      // previous turn's cloned snapshot is never aliased (cloneState shallow-
      // copies this optional map).
      if (typeof effect.value === "string") {
        state.flagSetTurns = { ...(state.flagSetTurns ?? {}), [effect.flag]: state.turnNumber };
      }
      return;
    case "flag_unset":
      unsetFlag(state, effect.flag, diffs);
      return;
    case "delayed":
      // Chekhov thread (Requirement 3.1). Schedule via the shared delayed store
      // carrying the foreshadow note; it ticks each subsequent turn and fires
      // through `tickDelayedThreads`. The bundled effects are leaf-only.
      scheduleThread(
        state,
        effect.delayNodes,
        effect.effects as unknown as Effect[],
        effect.note ?? null,
        diffs,
      );
      return;
  }
}

function clampDelta(value: number, bound: number): number {
  if (!Number.isFinite(value)) return 0;
  const integer = Math.trunc(value);
  if (integer > bound) return bound;
  if (integer < -bound) return -bound;
  return integer;
}

// =============================================================================
// W2 NPC effects (Requirement 8). Applied on the llm path with the W2-tier
// diffs (`disposition_shift`, `fact_learned`) — distinct from the authored
// `npcs.ts` appliers, which emit `npc_disposition` / `npc_learn_fact` for the
// authored reducer path. Unknown npcIds are tolerant-dropped (BC5).
// =============================================================================

function applyLlmDispositionDelta(
  state: PlayerState,
  effect: { npcId: string; delta: number },
  net: Record<string, number>,
  diffs: EngineDiff[],
): void {
  const npc = state.npcs[effect.npcId];
  if (!npc) return; // unknown npcId → drop
  const already = net[effect.npcId] ?? 0;
  // Net clamp to ±15 across the whole proposal.
  const targetNet = clampDelta(already + effect.delta, NPC_LLM_DISPOSITION_BOUND);
  const applied = targetNet - already;
  net[effect.npcId] = targetNet;
  if (applied === 0) return;
  const prev = npc.disposition;
  const after = clampNpcDisposition(prev + applied);
  if (after === prev) return;
  npc.disposition = after;
  diffs.push({
    kind: "disposition_shift",
    target: effect.npcId,
    prevDisposition: prev,
    delta: after - prev,
    visibility: "visible",
  });
}

function applyLlmLearnFact(
  state: PlayerState,
  effect: { npcId: string; fact: string },
  diffs: EngineDiff[],
): void {
  const npc = state.npcs[effect.npcId];
  if (!npc) return; // unknown npcId → drop
  if (npc.knownFacts.includes(effect.fact)) return; // dedupe exact
  let facts = [...npc.knownFacts, effect.fact];
  // FIFO cap: drop the oldest when over the per-NPC ceiling.
  if (facts.length > NPC_FACT_CAP) facts = facts.slice(facts.length - NPC_FACT_CAP);
  npc.knownFacts = facts;
  diffs.push({ kind: "fact_learned", target: effect.npcId, visibility: "visible" });
}

function applyLlmNpcSpawn(
  state: PlayerState,
  effect: { id: string; name: string; role: NpcRole; description?: string | undefined },
  diffs: EngineDiff[],
): void {
  if (state.npcs[effect.id]) return; // duplicate id → drop
  if (Object.keys(state.npcs).length >= NPC_ROSTER_CAP) return; // roster cap → drop
  const npc: NpcState = {
    id: effect.id,
    name: effect.name,
    role: effect.role,
    disposition: 0,
    attributes: {},
    knownFacts: [],
    flags: {},
    ...(effect.description !== undefined ? { description: effect.description } : {}),
  };
  state.npcs[effect.id] = npc;
  diffs.push({ kind: "npc_spawn", target: effect.id, delta: 1 });
}

function applyLlmClockAdvance(
  state: PlayerState,
  effect: { amount: number; reason?: string | undefined },
  diffs: EngineDiff[],
): void {
  if (!state.clock) return; // no clock (legacy/arc-less) → drop
  const before = state.clock;
  const after = applyClockAdvance(before, effect.amount);
  if (after.value === before.value) return;
  state.clock = after;
  diffs.push({
    kind: "clock_advanced",
    target: "clock",
    amount: after.value - before.value,
    reason: effect.reason ?? null,
    visibility: "visible",
  });
}

function clampNpcDisposition(value: number): number {
  const integer = Math.trunc(Number.isFinite(value) ? value : 0);
  if (integer < NPC_DISPOSITION_MIN) return NPC_DISPOSITION_MIN;
  if (integer > NPC_DISPOSITION_MAX) return NPC_DISPOSITION_MAX;
  return integer;
}

/**
 * Settle a clock crossing into expiry (Requirement 9.3): emit `clock_expired`
 * once and auto-fire every pending `dark_night` beat (idempotent via
 * `fireBeat`), advancing the act if that rolls it over. Called only on the turn
 * the clock first reaches max.
 */
function settleClockExpiry(state: PlayerState, diffs: EngineDiff[]): void {
  diffs.push({ kind: "clock_expired", target: "clock", visibility: "visible" });
  if (!state.arc) return;
  const startAct = state.arc.act;
  let arc = state.arc;
  for (const id of darkNightBeatIds(arc)) {
    const target = findArcBeat(arc, id);
    const { arc: fired, fired: didFire } = fireBeat(arc, id, state.turnNumber);
    arc = fired;
    if (didFire && target) {
      diffs.push({ kind: "beat_fired", target: target.id, label: target.label, visibility: "visible" });
    }
  }
  arc = advanceActIfDue(arc);
  if (arc.act !== startAct) {
    diffs.push({ kind: "act_advanced", target: "arc", act: arc.act, visibility: "visible" });
  }
  state.arc = arc;
}

/**
 * The Codex (Requirement 11.1): string-valued flags surfaced as recorded
 * world-truths, newest-first, capped at 40. `turnNumber` comes from the
 * record-at-set-time map `state.flagSetTurns` (written in the `flag_set` apply
 * path); flags without a stamp (e.g. authored seeds) default to turn 0 and
 * sort last. Ties break alphabetically for deterministic ordering. Boolean /
 * numeric flags stay invisible mechanics (Requirement 11.2).
 */
export function deriveCodex(
  state: PlayerState,
): Array<{ flag: string; text: string; turnNumber: number }> {
  const entries: Array<{ flag: string; text: string; turnNumber: number }> = [];
  for (const [flag, value] of Object.entries(state.flags)) {
    if (typeof value !== "string") continue;
    entries.push({ flag, text: value, turnNumber: state.flagSetTurns?.[flag] ?? 0 });
  }
  entries.sort((a, b) => {
    if (b.turnNumber !== a.turnNumber) return b.turnNumber - a.turnNumber;
    return a.flag < b.flag ? -1 : a.flag > b.flag ? 1 : 0;
  });
  return entries.slice(0, CODEX_CAP);
}

/**
 * The LLM is allowed to introduce brand-new stats (nerve, insight, etc.) on
 * the fly. The first time we see such a stat, register it as a visible
 * attribute with the engine-spec bounds (0–5 for non-vitality stats) and a
 * humanised label so the HUD picks it up and the projection clamps deltas
 * correctly on every subsequent turn.
 *
 * Vitality lives on `state.vitality` (top-level, bounds 0–10) and is handled
 * directly by `applyStatDelta`; we skip it here so we don't shadow it with a
 * spurious entry in `state.attributes`.
 *
 * Stats that were authored on the story (the seeded `resolve` on llm-driven
 * stubs, for example) keep whatever visibility / bounds the story author
 * declared — we only fill in the gap when the LLM names a stat that hasn't
 * been seen before. This preserves the "hidden authored stats stay hidden"
 * invariant while keeping LLM-proposed stats actually visible in the HUD.
 */
function ensureLlmStatAttribute(state: PlayerState, statId: string): void {
  if (statId === "vitality") return;
  if (state.attributes[statId]) return;
  state.attributes[statId] = {
    id: statId,
    label: humanizeStatLabel(statId),
    value: 0,
    visibility: "visible",
    min: 0,
    max: 5,
  };
}

function humanizeStatLabel(statId: string): string {
  const normalized = statId.replace(/[_-]+/g, " ").trim();
  if (normalized.length === 0) return statId;
  return normalized
    .split(/\s+/u)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

// =============================================================================
// Terminal gate (Requirement 2). Pure decision consumed by the server: it
// replaces the turn-count `guardEarlyTerminal` for arc saves, deciding whether
// a proposed ending is earned and, if not, what directive the next prompt
// should carry. Arc-less saves pass through untouched (legacy branch, BC9).
// =============================================================================

/** Turn ceiling above which any proposed terminal is honored (runaway guard). */
const HARD_CAP_TURN = 30;

export function gateTerminal(
  arc: StoryArc | undefined,
  terminal: LlmTerminalProposal | null,
  turnNumber: number,
  vitality: number,
): { terminal: LlmTerminalProposal | null; directive: TerminalDirective | null } {
  // Dying overrides the gate — the caller/engine forces a death terminal.
  if (vitality <= 0) return { terminal, directive: null };
  // Arc-less saves keep legacy behavior (caller retains guardEarlyTerminal).
  if (!arc) return { terminal, directive: null };
  // Nothing proposed → nothing to gate.
  if (!terminal) return { terminal: null, directive: null };

  const honored = (): { terminal: LlmTerminalProposal; directive: null } => ({
    terminal: { ...terminal, endingId: normalizeEndingId(arc, terminal.endingId) },
    directive: null,
  });

  // Runaway protection: any terminal is allowed at/after the hard cap.
  if (turnNumber >= HARD_CAP_TURN) return honored();

  if (terminal.kind === "death") {
    // Death before the midpoint is converted to a costly survival; after it,
    // death is a valid dramatic outcome (Requirement 2.2).
    return pastMidpoint(arc)
      ? honored()
      : { terminal: null, directive: "narrate_costly_survival" };
  }

  // success | safe: honored only once every required beat has fired.
  if (arcAllowsEnding(arc)) return honored();
  const beatId = firstUnfiredRequiredBeatId(arc) ?? nextTargetBeat(arc, turnNumber)?.id ?? "";
  return { terminal: null, directive: `surface_beat:${beatId}` };
}

function pastMidpoint(arc: StoryArc): boolean {
  const hasMidpoint = arc.beats.some((beat) => beat.kind === "midpoint");
  if (!hasMidpoint) return arc.act >= 2;
  return arc.beats.some((beat) => beat.kind === "midpoint" && beat.status === "fired");
}

function firstUnfiredRequiredBeatId(arc: StoryArc): string | undefined {
  return arc.beats.find((beat) => beat.requiredBeforeEnding && beat.status !== "fired")?.id;
}

// =============================================================================
// Conditional / locked choices on the llm path (Requirement 4). Self-contained
// predicate evaluation (the authored path's `visibility.ts` covers the engine
// `Condition` union; the llm path adds `currency_at_least` and evaluates its
// own tolerant condition set here without widening the shared type).
// =============================================================================

export function evaluateLlmChoiceVisibility(
  choice: LlmChoiceProposal,
  state: PlayerState,
): LlmChoiceVisibility {
  for (const condition of choice.conditions ?? []) {
    const outcome = evaluateLlmCondition(condition, state);
    // Unknown-referent conditions are dropped (choice stays available) —
    // same tolerant intent as effect drops (Requirement 4.2).
    if (outcome === "drop") continue;
    if (outcome === "fail") {
      // Near-miss legibility: on the first failing condition we still have the
      // value + threshold in hand, so band the miss here (numeric gates only).
      const nearness = conditionNearness(condition, state);
      return {
        visibility: "locked",
        ...(choice.lockedHint !== undefined ? { lockedHint: choice.lockedHint } : {}),
        ...(nearness !== undefined ? { nearness } : {}),
      };
    }
  }
  return { visibility: "visible" };
}

function evaluateLlmCondition(
  condition: LlmChoiceCondition,
  state: PlayerState,
): "pass" | "fail" | "drop" {
  switch (condition.kind) {
    case "stat_at_least": {
      // Unknown stat (the model hallucinated a stat the save never had) →
      // drop, so the choice is never permanently unsatisfiable.
      const stat = getStat(state, condition.statId);
      if (stat === undefined) return "drop";
      return stat.value >= condition.value ? "pass" : "fail";
    }
    case "stat_at_most": {
      const stat = getStat(state, condition.statId);
      if (stat === undefined) return "drop";
      return stat.value <= condition.value ? "pass" : "fail";
    }
    case "has_item":
      // Tolerant match: the LLM authored both the item and this condition, and
      // rarely spells the id identically across turns. See hasItemTolerant.
      return hasItemTolerant(state, condition.itemId) ? "pass" : "fail";
    case "missing_item":
      return hasItemTolerant(state, condition.itemId) ? "fail" : "pass";
    case "flag_equals":
      return getFlag(state, condition.flag) === condition.value ? "pass" : "fail";
    case "currency_at_least":
      return state.currency >= condition.value ? "pass" : "fail";
  }
}

/**
 * Band a FAILING numeric condition by how close the reader came. Only the
 * gates with a value + threshold participate (stat/currency); item and flag
 * gates are binary — there is no meaningful "almost holds the key" — so they
 * return undefined and the visibility result omits the band entirely.
 */
function conditionNearness(
  condition: LlmChoiceCondition,
  state: PlayerState,
): "near" | "far" | undefined {
  switch (condition.kind) {
    case "stat_at_least": {
      const value = getStat(state, condition.statId)?.value;
      // Unknown stats are tolerant-dropped before this runs; guard anyway.
      if (value === undefined) return undefined;
      return nearnessBand(condition.value - value, condition.value);
    }
    case "stat_at_most": {
      const value = getStat(state, condition.statId)?.value;
      if (value === undefined) return undefined;
      return nearnessBand(value - condition.value, condition.value);
    }
    case "currency_at_least":
      return nearnessBand(condition.value - state.currency, condition.value);
    case "has_item":
    case "missing_item":
    case "flag_equals":
      return undefined;
  }
}

/** "near" when the gap is within 1 point or 20% of the threshold, else "far". */
function nearnessBand(deficit: number, threshold: number): "near" | "far" {
  return deficit <= 1 || deficit <= Math.abs(threshold) * 0.2 ? "near" : "far";
}

/** Options for scene-level choice evaluation (story-bible R4). */
export type LlmSceneChoiceOpts = {
  terminal?: boolean;
  /**
   * Story-bible key-registry snapshot (R4.2–R4.5). Omitted or empty =
   * bible-less: a locked `has_item` choice whose id matches nothing (not
   * held, never granted, no sibling grant) auto-unlocks — phantom locks are
   * impossible by construction, including on legacy saves. When a registry is
   * present, unresolved gates are instead promised/adopted into the plan (the
   * engine reports the changes as RegistryEvents; the input is never mutated).
   */
  registry?: RegistrySnapshot;
  /** Turn stamped on registry events; defaults to `state.turnNumber`. */
  turnNumber?: number;
};

/**
 * Evaluate a whole scene's choices with the scene-level invariants enforced
 * (Requirements 4.4–4.5 + story-bible R4): registry gate resolution for
 * locked `has_item` choices (inventory/ledger → sibling grant → registry
 * promise → adopt → phantom unlock), at most ONE locked choice — keeping the
 * most ATTAINABLE lock (registry-backed key > smallest stat/currency deficit
 * > array order) — and, on non-terminal scenes, at least `MIN_VISIBLE_CHOICES`
 * available choices. Returns one entry per choice, in order. Callers that
 * need the registry events use {@link evaluateLlmSceneChoicesWithRegistry}.
 */
export function evaluateLlmSceneChoices(
  choices: LlmChoiceProposal[],
  state: PlayerState,
  opts?: LlmSceneChoiceOpts,
): LlmSceneChoiceVisibility[] {
  return evaluateLlmSceneChoicesWithRegistry(choices, state, opts).results;
}

/**
 * As {@link evaluateLlmSceneChoices}, but also surfaces the `RegistryEvent[]`
 * the gate processor emitted (promise / adopt / phantom_unlock / granted) so
 * the turn mutation can fold them into the bible row IN THE SAME MUTATION as
 * the state write (SB4/R2.1).
 */
export function evaluateLlmSceneChoicesWithRegistry(
  choices: LlmChoiceProposal[],
  state: PlayerState,
  opts?: LlmSceneChoiceOpts,
): { results: LlmSceneChoiceVisibility[]; registryEvents: RegistryEvent[] } {
  const results: LlmSceneChoiceVisibility[] = choices.map((choice) => ({
    choiceId: choice.id,
    ...evaluateLlmChoiceVisibility(choice, state),
  }));
  return processGatedChoices({
    choices,
    results,
    state,
    registry: opts?.registry ?? { keyRegistry: [] },
    turnNumber: opts?.turnNumber ?? state.turnNumber,
    ...(opts?.terminal !== undefined ? { terminal: opts.terminal } : {}),
  });
}
