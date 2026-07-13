import { z } from "zod";

import { beatBandForTurn, normalizeEndingId, slugify } from "./arc";
import { getFlag } from "./flags";
import { hasItemTolerant, normalizeItemRef } from "./inventory";
import { getStat } from "./stats";
import type { Effect, InventoryItem, PlayerState, StoryArc } from "./types";
import type {
  LlmChoiceCondition,
  LlmChoiceProposal,
  LlmSceneChoiceVisibility,
} from "./llm";

// =============================================================================
// Story Bible engine module (story-bible spec, R1–R6). Pure — no `console`,
// no Date.now (BC6). Every function is total: malformed input returns
// null/fallback rather than throwing, so a bible failure is never a turn
// failure (BC5). The bible itself never reaches the client (R2.2) — these
// types exist server-side only; convex stores the JSON and passes snapshots
// back in.
// =============================================================================

// --- R1.2 bounds -------------------------------------------------------------
const SLUG_MAX = 48;
const LABEL_MAX = 80;
const HINT_MAX = 120;
const REQUIRES_MAX = 160;
const MOTIF_LEN_MAX = 40;
// --- protagonist bounds (design §1.3) ---------------------------------------
const GENDER_MAX = 40;
const APPEARANCE_MAX = 6;
const APPEARANCE_LEN_MAX = 60;
const KEYS_MAX = 12;
/** A bible salvageable to ≥4 registry keys is kept; anything less → null (R1.3). */
const KEYS_MIN_SALVAGE = 4;
const DOORS_MAX = 5;
const CAST_MAX = 5;
const TWISTS_MAX = 4;
const ENDING_HINTS_MAX = 4;
const MOTIFS_MAX = 6;

// --- R4 registry enforcement caps --------------------------------------------
/** Registry ceiling after adoption (R4.3): 6–12 at generation, ≤16 ever. */
export const BIBLE_REGISTRY_CAP = 16;
/** At most 2 keys `promised` simultaneously (R4.3); excess gates auto-unlock. */
export const BIBLE_PROMISED_CAP = 2;

// --- R3 digest caps -----------------------------------------------------------
const DIGEST_KEYS_MAX = 6;
const DIGEST_DOORS_MAX = 3;
const DIGEST_TWISTS_MAX = 2;
const DIGEST_OUTSTANDING_MAX = 2;

// --- R5 promise keeping --------------------------------------------------------
/** A promised key ungranted this many completed turns after its promise seeds (R5.1). */
const SEED_AFTER_TURNS = 3;
/** Re-offer window after a promised key lands (R5.2): next 2 scenes. */
const REOFFER_WINDOW_TURNS = 2;

// --- R6 refresh ----------------------------------------------------------------
/** An act-boundary refresh may add at most this many new registry keys (R6.1). */
const REFRESH_NEW_KEYS_MAX = 2;

/** Mirrors llm.ts THREAD_NOTE_MAX — the foreshadow-note clamp on a thread. */
const THREAD_NOTE_MAX = 120;
/** Mirrors llm.ts MIN_VISIBLE_CHOICES — non-terminal scenes keep ≥2 available. */
const MIN_VISIBLE_CHOICES = 2;

// =============================================================================
// Types (design §1.2)
// =============================================================================

/** Reuses the beatBandForTurn bands (early ≤4, mid 5–9, late ≥10). */
export type SurfaceBand = "early" | "mid" | "late";
export type KeyStatus = "planned" | "promised" | "granted" | "retired";

export type BibleKey = {
  id: string; // slug ≤48 (slugify, same as arc ids)
  label: string; // ≤80
  opensHint: string; // ≤120
  surfaceBand: SurfaceBand;
  status: KeyStatus;
  promisedAtTurn?: number;
  /** Turn the grant landed (folded from a `granted` event) — drives re-offer. */
  grantedAtTurn?: number;
  adopted?: true; // R4.3 registry-admission keys
  seeded?: true; // R5.1 engine-seeded via thread
};

export type BibleDoor = {
  id: string; // slug ≤48
  label: string; // ≤80
  keyId: string; // MUST reference a keyRegistry id
  gateBand: "mid" | "late";
  note: string; // ≤120
  status: "planned" | "opened" | "retired";
};

export type BibleCast = {
  id: string; // slug ≤48
  label: string; // ≤80
  want: string; // ≤120
  secret: string; // ≤120
  bondHint: string; // ≤120
  appearance: string; // ≤120 — what the reader SEES (build, hair, dress, age-look)
};

export type BibleTwist = {
  id: string; // slug ≤48
  label: string; // ≤80
  precondition: string; // ≤120
  status: "pending" | "fired" | "retired";
};

export type BibleEndingHint = {
  endingId: string; // slug ≤48, fuzzy-matched to the arc's candidateEndings
  requires: string; // ≤160
};

/**
 * The ONE person the reader plays. Fixed at bible generation and NEVER changed
 * over the whole story (immutable across act refresh — see `mergeBibleRefresh`).
 * The single load-bearing anchor against mid-story protagonist drift (gender
 * flips): re-injected verbatim into every scene/image prompt via the digest.
 */
export type BibleProtagonist = {
  name: string; // ≤80 (LABEL_MAX)
  gender: string; // ≤40, free text ("woman", "man", "nonbinary", …)
  pronouns: string; // ≤40 ("she/her")
  appearance: string[]; // 2–6 short descriptors, ≤60 each (hair, build, dress, age-look)
  voice: string; // ≤120 (HINT_MAX), speech register / demeanor
};

export type StoryBible = {
  keyRegistry: BibleKey[]; // 6–12 at generation; ≤16 after adoption
  lockPlan: BibleDoor[]; // 2–5
  cast: BibleCast[]; // 2–5
  twists: BibleTwist[]; // 2–4
  endingHints: BibleEndingHint[]; // 0–4 after arc fuzzy-match
  motifs: string[]; // 3–6, ≤40 each
  protagonist?: BibleProtagonist; // optional — legacy stored bibles have none
  source: "llm";
  version: 1;
};

// =============================================================================
// Loose LLM output envelope (spec task 2.1's engine half). Shape-check ONLY —
// hard validation is `validateProposedBible`'s job (BC5: the schema must never
// reject a payload the validator could salvage). Mirrors `rawStoryArcSchema`.
// =============================================================================

export const storyBibleOutputSchema = z
  .object({
    keyRegistry: z.array(z.unknown()),
    lockPlan: z.array(z.unknown()).optional(),
    cast: z.array(z.unknown()).optional(),
    twists: z.array(z.unknown()).optional(),
    endingHints: z.array(z.unknown()).optional(),
    motifs: z.array(z.unknown()).optional(),
    protagonist: z.unknown().optional(), // shape-check only; salvaged by validateProposedBible
  })
  .passthrough();

export type LlmStoryBibleProposal = z.infer<typeof storyBibleOutputSchema>;

// =============================================================================
// Validation (design §1.3, R1.2–R1.3) — mirror of validateProposedArc's
// clamp/slug/dedupe discipline (arc.ts).
// =============================================================================

const SURFACE_BANDS: readonly SurfaceBand[] = ["early", "mid", "late"];
const BAND_RANK: Record<SurfaceBand, number> = { early: 0, mid: 1, late: 2 };

function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** Same contract as arc.ts's private clampLen: trim, enforce min, truncate max. */
function clampLen(input: string, min: number, max: number): string | null {
  const trimmed = input.trim();
  if (trimmed.length < min) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function optionalText(value: unknown, max: number): string {
  return isString(value) ? clampLen(value, 0, max) ?? "" : "";
}

function asSurfaceBand(value: unknown): SurfaceBand {
  return isString(value) && (SURFACE_BANDS as readonly string[]).includes(value)
    ? (value as SurfaceBand)
    : "mid";
}

function asGateBand(value: unknown): "mid" | "late" {
  return value === "late" ? "late" : "mid";
}

/** id from an explicit `id` (preferred) or the label, sluggified + bounded. */
function entrySlug(obj: Record<string, unknown>, label: string): string {
  const raw = isString(obj.id) && obj.id.trim().length > 0 ? obj.id : label;
  return slugify(raw, SLUG_MAX);
}

/**
 * Validate + clamp a raw (LLM-proposed) bible into a canonical StoryBible, or
 * return null when it cannot be salvaged (fewer than 4 usable registry keys —
 * R1.3). Never throws. Guarantees on a non-null result: string clamps applied,
 * ids sluggified + de-duplicated per section, every `lockPlan` entry's `keyId`
 * resolves to a registry key whose `surfaceBand` is earlier-or-equal to the
 * door's `gateBand`, and all consumption state initialized (`planned` /
 * `pending`).
 */
export function validateProposedBible(raw: unknown): StoryBible | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  // -- keyRegistry (the salvage gate) -----------------------------------------
  const rawKeys = Array.isArray(obj.keyRegistry) ? obj.keyRegistry : [];
  const seenKeyIds = new Set<string>();
  const keyRegistry: BibleKey[] = [];
  for (const entry of rawKeys) {
    if (keyRegistry.length >= KEYS_MAX) break;
    if (typeof entry !== "object" || entry === null) continue;
    const key = entry as Record<string, unknown>;
    const label = isString(key.label) ? clampLen(key.label, 1, LABEL_MAX) : null;
    if (label === null) continue;
    const id = entrySlug(key, label);
    if (id.length === 0 || seenKeyIds.has(id)) continue;
    seenKeyIds.add(id);
    keyRegistry.push({
      id,
      label,
      opensHint: optionalText(key.opensHint, HINT_MAX),
      surfaceBand: asSurfaceBand(key.surfaceBand),
      status: "planned",
    });
  }
  if (keyRegistry.length < KEYS_MIN_SALVAGE) return null;

  // -- lockPlan (each door needs a resolving, earlier-or-equal key) ------------
  const rawDoors = Array.isArray(obj.lockPlan) ? obj.lockPlan : [];
  const seenDoorIds = new Set<string>();
  const lockPlan: BibleDoor[] = [];
  for (const entry of rawDoors) {
    if (lockPlan.length >= DOORS_MAX) break;
    if (typeof entry !== "object" || entry === null) continue;
    const door = entry as Record<string, unknown>;
    const label = isString(door.label) ? clampLen(door.label, 1, LABEL_MAX) : null;
    if (label === null) continue;
    const id = entrySlug(door, label);
    if (id.length === 0 || seenDoorIds.has(id)) continue;
    // keyId must reference a registry entry (slug-tolerant), and the key must
    // surface in an earlier-or-equal band than the door gates (R1.2/R1.3).
    const keyRef = isString(door.keyId) ? slugify(door.keyId, SLUG_MAX) : "";
    const key = keyRegistry.find((candidate) => candidate.id === keyRef);
    if (!key) continue;
    const gateBand = asGateBand(door.gateBand);
    if (BAND_RANK[key.surfaceBand] > BAND_RANK[gateBand]) continue;
    seenDoorIds.add(id);
    lockPlan.push({
      id,
      label,
      keyId: key.id,
      gateBand,
      note: optionalText(door.note, HINT_MAX),
      status: "planned",
    });
  }

  // -- cast ---------------------------------------------------------------------
  const rawCast = Array.isArray(obj.cast) ? obj.cast : [];
  const seenCastIds = new Set<string>();
  const cast: BibleCast[] = [];
  for (const entry of rawCast) {
    if (cast.length >= CAST_MAX) break;
    if (typeof entry !== "object" || entry === null) continue;
    const member = entry as Record<string, unknown>;
    const label = isString(member.label) ? clampLen(member.label, 1, LABEL_MAX) : null;
    if (label === null) continue;
    const id = entrySlug(member, label);
    if (id.length === 0 || seenCastIds.has(id)) continue;
    seenCastIds.add(id);
    cast.push({
      id,
      label,
      want: optionalText(member.want, HINT_MAX),
      secret: optionalText(member.secret, HINT_MAX),
      bondHint: optionalText(member.bondHint, HINT_MAX),
      appearance: optionalText(member.appearance, HINT_MAX),
    });
  }

  // -- twists ---------------------------------------------------------------------
  const rawTwists = Array.isArray(obj.twists) ? obj.twists : [];
  const seenTwistIds = new Set<string>();
  const twists: BibleTwist[] = [];
  for (const entry of rawTwists) {
    if (twists.length >= TWISTS_MAX) break;
    if (typeof entry !== "object" || entry === null) continue;
    const twist = entry as Record<string, unknown>;
    const label = isString(twist.label) ? clampLen(twist.label, 1, LABEL_MAX) : null;
    if (label === null) continue;
    const id = entrySlug(twist, label);
    if (id.length === 0 || seenTwistIds.has(id)) continue;
    seenTwistIds.add(id);
    twists.push({
      id,
      label,
      precondition: optionalText(twist.precondition, HINT_MAX),
      status: "pending",
    });
  }

  // -- endingHints (fuzzy-matched to the arc later via matchEndingHints) ----------
  const rawHints = Array.isArray(obj.endingHints) ? obj.endingHints : [];
  const seenHintIds = new Set<string>();
  const endingHints: BibleEndingHint[] = [];
  for (const entry of rawHints) {
    if (endingHints.length >= ENDING_HINTS_MAX) break;
    if (typeof entry !== "object" || entry === null) continue;
    const hint = entry as Record<string, unknown>;
    const endingId = isString(hint.endingId) ? slugify(hint.endingId, SLUG_MAX) : "";
    if (endingId.length === 0 || seenHintIds.has(endingId)) continue;
    seenHintIds.add(endingId);
    endingHints.push({ endingId, requires: optionalText(hint.requires, REQUIRES_MAX) });
  }

  // -- motifs ---------------------------------------------------------------------
  const rawMotifs = Array.isArray(obj.motifs) ? obj.motifs : [];
  const motifs: string[] = [];
  for (const entry of rawMotifs) {
    if (motifs.length >= MOTIFS_MAX) break;
    if (!isString(entry)) continue;
    const motif = clampLen(entry, 1, MOTIF_LEN_MAX);
    if (motif === null || motifs.includes(motif)) continue;
    motifs.push(motif);
  }

  const protagonist = validateProtagonist(obj.protagonist);
  return {
    keyRegistry,
    lockPlan,
    cast,
    twists,
    endingHints,
    motifs,
    ...(protagonist ? { protagonist } : {}),
    source: "llm",
    version: 1,
  };
}

/**
 * Salvage the protagonist identity (design §1.3, BC5 — never throws; malformed
 * sub-fields are tolerant-dropped, not rejected). Returns `undefined` when the
 * payload is not an object or has no usable name, so a bible with no
 * protagonist stays legacy-tolerant (the spread omits the field entirely).
 * `appearance` is clamped to 2–6 unique, non-empty descriptors; over-cap or
 * duplicate entries are dropped rather than failing the whole object.
 */
function validateProtagonist(raw: unknown): BibleProtagonist | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const p = raw as Record<string, unknown>;
  const name = isString(p.name) ? clampLen(p.name, 1, LABEL_MAX) : null;
  if (name === null) return undefined; // no name → no protagonist (tolerant)
  const appearance: string[] = [];
  const rawApp = Array.isArray(p.appearance) ? p.appearance : [];
  for (const d of rawApp) {
    if (appearance.length >= APPEARANCE_MAX) break;
    if (!isString(d)) continue;
    const t = clampLen(d, 1, APPEARANCE_LEN_MAX);
    if (t === null || appearance.includes(t)) continue;
    appearance.push(t);
  }
  return {
    name,
    gender: optionalText(p.gender, GENDER_MAX),
    pronouns: optionalText(p.pronouns, GENDER_MAX),
    appearance,
    voice: optionalText(p.voice, HINT_MAX),
  };
}

/**
 * Fuzzy-match `endingHints` to the turn-1 arc's candidate endings (R1.5),
 * reusing `normalizeEndingId` semantics; unmatched hints are dropped. Returns
 * a NEW bible — the input is never mutated. An arc-less save (legacy) attaches
 * with `endingHints: []` (design §7).
 */
export function matchEndingHints(bible: StoryBible, arc: StoryArc | undefined): StoryBible {
  if (!arc) return { ...bible, endingHints: [] };
  const seen = new Set<string>();
  const endingHints: BibleEndingHint[] = [];
  for (const hint of bible.endingHints) {
    const normalized = normalizeEndingId(arc, hint.endingId);
    if (!arc.candidateEndings.some((candidate) => candidate.id === normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    endingHints.push({ endingId: normalized, requires: hint.requires });
  }
  return { ...bible, endingHints };
}

// =============================================================================
// Registry enforcement (design §3, R4.2–R4.5). The engine is the source of
// truth for gate processing but cannot read the DB (SB4): convex passes a
// RegistrySnapshot in, and every change flows OUT as a RegistryEvent that
// convex folds into the bible row in the SAME mutation as the state write.
// The snapshot input is never mutated.
// =============================================================================

/**
 * The slice of the bible the gate processor needs. Bible-less saves (legacy,
 * failed call, authored) pass an EMPTY `keyRegistry` (R4.5): with no plan to
 * admit hallucinated keys into, a never-granted / never-adoptable `has_item`
 * gate auto-unlocks — phantom locks become impossible by construction.
 */
export type RegistrySnapshot = {
  keyRegistry: BibleKey[];
  lockPlan?: BibleDoor[];
};

export type RegistryEvent =
  | { kind: "promise"; keyId: string; turn: number }
  | { kind: "adopt"; key: BibleKey; turn: number }
  | { kind: "phantom_unlock"; itemId: string; choiceId: string; turn: number }
  | { kind: "granted"; keyId: string; turn: number }
  | { kind: "door_opened"; doorId: string; turn: number }
  | { kind: "seeded"; keyId: string; turn: number };

/**
 * Post-process a scene's locked-choice results against the key registry
 * (design §3). For each locked result whose failing condition is `has_item`,
 * resolve the id in order: inventory/`itemsEverGranted` ledger → sibling
 * grant in the same proposal → registry (promise) → adopt (caps: 2 promised /
 * 16 registry) → phantom unlock. Then the keep-rule (R4.4): among surviving
 * locked results keep the most ATTAINABLE (registry-backed key > smallest
 * stat/currency deficit > array order), and re-assert the ≥2-visible
 * invariant on non-terminal scenes. Pure: returns fresh result objects +
 * `registryEvents`; neither `results` nor `registry` inputs are mutated.
 */
export function processGatedChoices(input: {
  choices: LlmChoiceProposal[];
  results: LlmSceneChoiceVisibility[];
  state: PlayerState;
  registry: RegistrySnapshot;
  turnNumber: number;
  terminal?: boolean;
}): { results: LlmSceneChoiceVisibility[]; registryEvents: RegistryEvent[] } {
  const { choices, state, registry, turnNumber } = input;
  const results = input.results.map((result) => ({ ...result }));
  const registryEvents: RegistryEvent[] = [];
  const keys = registry.keyRegistry;
  const bibleAttached = keys.length > 0;
  const ledger = state.itemsEverGranted ?? [];
  const siblingGrants = collectSiblingGrantRefs(choices);

  // `granted` detection (idempotent — convex folds status; keys already marked
  // granted are skipped): a planned/promised key whose item is now held or in
  // the ledger closes the promise loop (RegistryEvent union, design §3).
  const grantedNow = new Set<string>();
  for (const key of keys) {
    if (key.status !== "planned" && key.status !== "promised") continue;
    if (keyEverGranted(key, state, ledger)) {
      grantedNow.add(key.id);
      registryEvents.push({ kind: "granted", keyId: key.id, turn: turnNumber });
    }
  }

  // Promise budget: keys already promised (and not granted this turn) count
  // against the simultaneous cap (R4.3).
  let promisedCount = keys.filter(
    (key) => key.status === "promised" && !grantedNow.has(key.id),
  ).length;
  let registrySize = keys.length;
  /** Keys adopted earlier in THIS proposal — later gates match them (dedupe). */
  const adoptedNow: BibleKey[] = [];

  /** Attainability rank per still-locked result index (keep-rule, R4.4). */
  const attainability = new Map<number, { tier: number; deficit: number }>();

  results.forEach((result, index) => {
    if (result.visibility !== "locked") return;
    const choice = choices.find((candidate) => candidate.id === result.choiceId);
    const failing = (choice?.conditions ?? []).filter((condition) =>
      conditionFails(condition, state),
    );
    const failingHasItem = failing.filter(
      (condition): condition is Extract<LlmChoiceCondition, { kind: "has_item" }> =>
        condition.kind === "has_item",
    );
    const deficits = failing
      .map((condition) => numericDeficit(condition, state))
      .filter((deficit): deficit is number => deficit !== null);
    // The binding numeric constraint on this choice (largest gap to clear).
    const deficit = deficits.length > 0 ? Math.max(...deficits) : Number.POSITIVE_INFINITY;

    if (failingHasItem.length === 0) {
      // Not a key gate (stat/currency/flag lock) — participates in the
      // keep-rule by deficit only.
      attainability.set(index, {
        tier: Number.isFinite(deficit) ? 1 : 2,
        deficit,
      });
      return;
    }

    let keyBacked = true;
    for (const condition of failingHasItem) {
      const ref = normalizeItemRef(condition.itemId);

      // 1. Ledger / sibling grant. (A current-inventory hit is impossible
      //    here — the condition would have passed — but the ledger catches
      //    granted-then-consumed keys, and a sibling `inventory_add` in this
      //    same proposal is a grant-on-A-gate-B tease, NOT a phantom.)
      if (ref.length > 0 && (ledger.includes(ref) || siblingGrants.has(ref))) continue;

      // 2. Registry (unretired, including keys adopted earlier this proposal):
      //    keep the choice locked; a planned key becomes promised while the
      //    simultaneous-promise budget holds (idempotent when already promised).
      const match = findRegistryKey([...keys, ...adoptedNow], condition.itemId);
      if (match) {
        if (
          match.status === "planned" &&
          !grantedNow.has(match.id) &&
          promisedCount < BIBLE_PROMISED_CAP
        ) {
          registryEvents.push({ kind: "promise", keyId: match.id, turn: turnNumber });
          promisedCount += 1;
        }
        continue;
      }

      // 3. Adopt (registry admission) when a bible exists and both caps hold;
      //    otherwise the gate is a phantom — auto-unlock (R4.3/R4.5).
      const slug = slugify(condition.itemId, SLUG_MAX);
      if (
        bibleAttached &&
        slug.length > 0 &&
        registrySize < BIBLE_REGISTRY_CAP &&
        promisedCount < BIBLE_PROMISED_CAP
      ) {
        const adopted = adoptKeyFromGate(condition.itemId, choice?.lockedHint, turnNumber);
        adoptedNow.push(adopted);
        registryEvents.push({ kind: "adopt", key: adopted, turn: turnNumber });
        registrySize += 1;
        promisedCount += 1;
        continue;
      }

      keyBacked = false;
      registryEvents.push({
        kind: "phantom_unlock",
        itemId: condition.itemId,
        choiceId: result.choiceId,
        turn: turnNumber,
      });
    }

    if (!keyBacked) {
      unlockResult(result);
      return;
    }
    // Every gated id resolved: the key exists, is imminent, or is now planned —
    // the most attainable tier in the keep-rule ordering.
    attainability.set(index, { tier: 0, deficit });
  });

  // Keep-rule (R4.4): ≤1 locked per scene, keeping the most attainable —
  // registry-backed key gate > smallest numeric deficit > array order.
  const lockedIndices: number[] = [];
  results.forEach((result, index) => {
    if (result.visibility === "locked") lockedIndices.push(index);
  });
  if (lockedIndices.length > 1) {
    const ranked = [...lockedIndices].sort((a, b) => {
      const rankA = attainability.get(a) ?? { tier: 2, deficit: Number.POSITIVE_INFINITY };
      const rankB = attainability.get(b) ?? { tier: 2, deficit: Number.POSITIVE_INFINITY };
      if (rankA.tier !== rankB.tier) return rankA.tier - rankB.tier;
      if (rankA.deficit !== rankB.deficit) return rankA.deficit - rankB.deficit;
      return a - b;
    });
    for (const index of ranked.slice(1)) {
      const result = results[index];
      if (result) unlockResult(result);
    }
  }

  // ≥2 available on non-terminal scenes (existing invariant, unchanged).
  if (input.terminal !== true) {
    for (const result of results) {
      if (countVisible(results) >= MIN_VISIBLE_CHOICES) break;
      if (result.visibility === "locked") unlockResult(result);
    }
  }

  return { results, registryEvents };
}

function unlockResult(result: LlmSceneChoiceVisibility): void {
  result.visibility = "visible";
  delete result.lockedHint;
}

function countVisible(results: LlmSceneChoiceVisibility[]): number {
  return results.reduce((n, result) => (result.visibility === "visible" ? n + 1 : n), 0);
}

/**
 * Mirror of llm.ts's private `evaluateLlmCondition`, reduced to "did this
 * condition fail?". Unknown-stat referents are tolerant-dropped (not failing),
 * matching the llm-path semantics exactly — keep the two in sync.
 */
function conditionFails(condition: LlmChoiceCondition, state: PlayerState): boolean {
  switch (condition.kind) {
    case "stat_at_least": {
      const stat = getStat(state, condition.statId);
      return stat !== undefined && stat.value < condition.value;
    }
    case "stat_at_most": {
      const stat = getStat(state, condition.statId);
      return stat !== undefined && stat.value > condition.value;
    }
    case "has_item":
      return !hasItemTolerant(state, condition.itemId);
    case "missing_item":
      return hasItemTolerant(state, condition.itemId);
    case "flag_equals":
      return getFlag(state, condition.flag) !== condition.value;
    case "currency_at_least":
      return state.currency < condition.value;
  }
}

/** Positive gap to clear on a failing numeric condition, else null. */
function numericDeficit(condition: LlmChoiceCondition, state: PlayerState): number | null {
  if (condition.kind === "stat_at_least") {
    const stat = getStat(state, condition.statId);
    if (stat === undefined) return null;
    const gap = condition.value - stat.value;
    return gap > 0 ? gap : null;
  }
  if (condition.kind === "currency_at_least") {
    const gap = condition.value - state.currency;
    return gap > 0 ? gap : null;
  }
  return null;
}

/** Normalized id/label refs of every `inventory_add` in the proposal (incl. inside delayed bundles). */
function collectSiblingGrantRefs(choices: LlmChoiceProposal[]): Set<string> {
  const refs = new Set<string>();
  const add = (item: { id: string; label: string }): void => {
    const id = normalizeItemRef(item.id);
    const label = normalizeItemRef(item.label);
    if (id.length > 0) refs.add(id);
    if (label.length > 0) refs.add(label);
  };
  for (const choice of choices) {
    for (const effect of choice.effects ?? []) {
      if (effect.kind === "inventory_add") add(effect.item);
      else if (effect.kind === "delayed") {
        for (const leaf of effect.effects) {
          if (leaf.kind === "inventory_add") add(leaf.item);
        }
      }
    }
  }
  return refs;
}

function keyEverGranted(key: BibleKey, state: PlayerState, ledger: string[]): boolean {
  if (hasItemTolerant(state, key.id) || hasItemTolerant(state, key.label)) return true;
  const id = normalizeItemRef(key.id);
  const label = normalizeItemRef(key.label);
  return (id.length > 0 && ledger.includes(id)) || (label.length > 0 && ledger.includes(label));
}

/** Tolerant registry lookup (normalized id OR label), skipping retired keys. */
function findRegistryKey(keys: BibleKey[], ref: string): BibleKey | undefined {
  const target = normalizeItemRef(ref);
  if (target.length === 0) return undefined;
  return keys.find(
    (key) =>
      key.status !== "retired" &&
      (normalizeItemRef(key.id) === target || normalizeItemRef(key.label) === target),
  );
}

/** Registry-admission key for a hallucinated gate id (design §3.3). */
function adoptKeyFromGate(
  itemId: string,
  lockedHint: string | undefined,
  turnNumber: number,
): BibleKey {
  return {
    id: slugify(itemId, SLUG_MAX),
    label: titleCaseRef(itemId),
    opensHint: lockedHint !== undefined ? clampLen(lockedHint, 0, HINT_MAX) ?? "" : "",
    surfaceBand: beatBandForTurn(turnNumber),
    status: "promised",
    promisedAtTurn: turnNumber,
    adopted: true,
  };
}

function titleCaseRef(ref: string): string {
  const normalized = ref.replace(/[_\-\s]+/g, " ").trim();
  if (normalized.length === 0) return ref;
  const titled = normalized
    .split(/\s+/u)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
  return titled.length > LABEL_MAX ? titled.slice(0, LABEL_MAX) : titled;
}

// =============================================================================
// Promise keeping (R5.1). The turn loop schedules each due seeding through the
// EXISTING delayed store (`scheduleThread`, delayed.ts) — no parallel store.
// =============================================================================

/**
 * Promised keys the engine must now seed deterministically: ungranted, not
 * already seeded, and ≥3 completed turns past their promise. The caller
 * schedules each via `scheduleThread(state, plan.delayNodes, plan.effects,
 * plan.note, diffs)` using {@link keySeedingPlan} and emits a `seeded` event.
 */
export function dueKeySeedings(registry: RegistrySnapshot, turnNumber: number): BibleKey[] {
  return registry.keyRegistry
    .filter(
      (key) =>
        key.status === "promised" &&
        key.seeded !== true &&
        typeof key.promisedAtTurn === "number" &&
        turnNumber - key.promisedAtTurn >= SEED_AFTER_TURNS,
    )
    .map((key) => ({ ...key }));
}

/**
 * The thread payload for a seeded key (R5.1): `delayNodes: 1`, an
 * `inventory_add` of the key, and a foreshadow note derived from
 * label/opensHint — so the key arrives narrated as a fired-thread callback,
 * indistinguishable from authored foreshadowing.
 */
export function keySeedingPlan(key: BibleKey): {
  delayNodes: 1;
  effects: Effect[];
  note: string;
} {
  const item: InventoryItem = {
    id: key.id,
    label: key.label,
    ...(key.opensHint.length > 0 ? { description: key.opensHint } : {}),
  };
  const raw = key.opensHint.length > 0 ? `${key.label} — ${key.opensHint}` : key.label;
  const note = clampLen(raw, 1, THREAD_NOTE_MAX) ?? key.id;
  return { delayNodes: 1, effects: [{ kind: "inventory_add", item }], note };
}

// =============================================================================
// Digest (design §4, R3.1). Band-filtered + capped, returned as a STRUCTURED
// object — the convex prompt layer renders the prose (the engine stays
// prose-free).
// =============================================================================

export type BibleDigestKey = {
  id: string;
  label: string;
  opensHint: string;
  surfaceBand: SurfaceBand;
  /** Band ≤ current turn band — renderable as "[due now]" vs "[surfaces later]". */
  due: boolean;
  promised: boolean;
};

export type BibleDigestDoor = {
  id: string;
  label: string;
  keyId: string;
  gateBand: "mid" | "late";
  note: string;
};

export type BibleDigestTwist = { id: string; label: string; precondition: string };

export type BibleDigestOutstanding =
  | { keyId: string; label: string; state: "promised"; promisedAtTurn: number }
  | { keyId: string; label: string; state: "reoffer"; grantedAtTurn: number };

export type BibleDigest = {
  keys: BibleDigestKey[]; // ≤6
  doors: BibleDigestDoor[]; // ≤3
  cast: BibleCast[];
  twists: BibleDigestTwist[]; // ≤2
  outstanding: BibleDigestOutstanding[]; // ≤2
  /** Verbatim identity — no band filtering; due every turn (design §1.4). */
  protagonist?: BibleProtagonist;
};

/**
 * Build the prompt digest for the current turn (R3.1): unconsumed registry
 * keys that are due (band ≤ current, via `beatBandForTurn`), promised, or
 * referenced by an included door; planned doors due or promise-backed; the
 * cast sheet; pending twists; and the OUTSTANDING KEYS lines (promised keys
 * awaiting surfacing, or freshly-granted keys whose locked door should be
 * re-offered within the next 2 scenes — R5.2). Caps: ≤6 keys, ≤3 doors, ≤2
 * twists, ≤2 outstanding. Pure; the input bible is never mutated.
 */
export function buildBibleDigest(bible: StoryBible, turnNumber: number): BibleDigest {
  const currentRank = BAND_RANK[beatBandForTurn(turnNumber)];
  const keyById = new Map(bible.keyRegistry.map((key) => [key.id, key]));

  const doors: BibleDigestDoor[] = bible.lockPlan
    .filter((door) => {
      if (door.status !== "planned") return false;
      if (BAND_RANK[door.gateBand] <= currentRank) return true;
      return keyById.get(door.keyId)?.status === "promised";
    })
    .slice(0, DIGEST_DOORS_MAX)
    .map(({ id, label, keyId, gateBand, note }) => ({ id, label, keyId, gateBand, note }));

  const doorKeyIds = new Set(doors.map((door) => door.keyId));

  // Key selection priority within the ≤6 cap: promised (outstanding work)
  // first, then due-by-band, then keys a listed door needs. Stable within a
  // priority tier (registry array order).
  const eligible = bible.keyRegistry
    .filter((key) => key.status === "planned" || key.status === "promised")
    .map((key) => ({
      key,
      due: BAND_RANK[key.surfaceBand] <= currentRank,
      promised: key.status === "promised",
    }))
    .filter((entry) => entry.due || entry.promised || doorKeyIds.has(entry.key.id));
  const priority = (entry: { due: boolean; promised: boolean }): number =>
    entry.promised ? 0 : entry.due ? 1 : 2;
  const keys: BibleDigestKey[] = eligible
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => priority(a.entry) - priority(b.entry) || a.index - b.index)
    .slice(0, DIGEST_KEYS_MAX)
    .map(({ entry }) => ({
      id: entry.key.id,
      label: entry.key.label,
      opensHint: entry.key.opensHint,
      surfaceBand: entry.key.surfaceBand,
      due: entry.due,
      promised: entry.promised,
    }));

  const twists: BibleDigestTwist[] = bible.twists
    .filter((twist) => twist.status === "pending")
    .slice(0, DIGEST_TWISTS_MAX)
    .map(({ id, label, precondition }) => ({ id, label, precondition }));

  // OUTSTANDING KEYS: re-offer lines are the more actionable state — they lead.
  const reoffers: BibleDigestOutstanding[] = [];
  const promises: BibleDigestOutstanding[] = [];
  for (const key of bible.keyRegistry) {
    if (
      key.status === "granted" &&
      typeof key.promisedAtTurn === "number" &&
      typeof key.grantedAtTurn === "number" &&
      turnNumber - key.grantedAtTurn <= REOFFER_WINDOW_TURNS
    ) {
      reoffers.push({
        keyId: key.id,
        label: key.label,
        state: "reoffer",
        grantedAtTurn: key.grantedAtTurn,
      });
    } else if (key.status === "promised" && typeof key.promisedAtTurn === "number") {
      promises.push({
        keyId: key.id,
        label: key.label,
        state: "promised",
        promisedAtTurn: key.promisedAtTurn,
      });
    }
  }
  const outstanding = [...reoffers, ...promises].slice(0, DIGEST_OUTSTANDING_MAX);

  return {
    keys,
    doors,
    cast: bible.cast.map((member) => ({ ...member })),
    twists,
    outstanding,
    // Identity is due EVERY turn — passed through verbatim, no band filtering.
    ...(bible.protagonist
      ? { protagonist: { ...bible.protagonist, appearance: [...bible.protagonist.appearance] } }
      : {}),
  };
}

// =============================================================================
// Act-boundary refresh merge (R6). The model may relocate or retire unconsumed
// entries and add ≤2 new registry keys; consumed/granted/promised entries are
// immutable, and no key a pending lock references is ever removed. Any
// unusable payload keeps the current bible silently.
// =============================================================================

export function mergeBibleRefresh(current: StoryBible, proposedRaw: unknown): StoryBible {
  const proposed = validateProposedBible(proposedRaw);
  if (proposed === null) return current;

  const proposedKeysById = new Map(proposed.keyRegistry.map((key) => [key.id, key]));
  // Keys a pending (planned) lock references are protected from removal (R6.2).
  const protectedKeyIds = new Set(
    current.lockPlan.filter((door) => door.status === "planned").map((door) => door.keyId),
  );

  const keyRegistry: BibleKey[] = current.keyRegistry.map((key) => {
    // promised / granted / retired entries are immutable (R6.1/R6.2).
    if (key.status !== "planned") return { ...key };
    const update = proposedKeysById.get(key.id);
    if (update) {
      // Relocation: band/label/hint may move; consumption state never does.
      return {
        ...key,
        label: update.label,
        opensHint: update.opensHint,
        surfaceBand: update.surfaceBand,
      };
    }
    if (protectedKeyIds.has(key.id)) return { ...key };
    return { ...key, status: "retired" };
  });

  const currentKeyIds = new Set(current.keyRegistry.map((key) => key.id));
  let added = 0;
  for (const candidate of proposed.keyRegistry) {
    if (added >= REFRESH_NEW_KEYS_MAX || keyRegistry.length >= BIBLE_REGISTRY_CAP) break;
    if (currentKeyIds.has(candidate.id)) continue;
    keyRegistry.push({ ...candidate });
    added += 1;
  }

  const keyById = new Map(keyRegistry.map((key) => [key.id, key]));
  const doorUsable = (keyId: string, gateBand: "mid" | "late"): boolean => {
    const key = keyById.get(keyId);
    return (
      key !== undefined &&
      key.status !== "retired" &&
      BAND_RANK[key.surfaceBand] <= BAND_RANK[gateBand]
    );
  };

  const proposedDoorsById = new Map(proposed.lockPlan.map((door) => [door.id, door]));
  const lockPlan: BibleDoor[] = current.lockPlan.map((door) => {
    if (door.status !== "planned") return { ...door }; // opened/retired immutable
    const update = proposedDoorsById.get(door.id);
    if (!update) return { ...door, status: "retired" };
    // A relocation that breaks key resolution / band ordering is ignored.
    if (!doorUsable(update.keyId, update.gateBand)) return { ...door };
    return {
      ...door,
      label: update.label,
      keyId: update.keyId,
      gateBand: update.gateBand,
      note: update.note,
    };
  });
  const currentDoorIds = new Set(current.lockPlan.map((door) => door.id));
  for (const candidate of proposed.lockPlan) {
    if (lockPlan.filter((door) => door.status === "planned").length >= DOORS_MAX) break;
    if (currentDoorIds.has(candidate.id)) continue;
    if (!doorUsable(candidate.keyId, candidate.gateBand)) continue;
    lockPlan.push({ ...candidate });
  }

  const proposedTwistsById = new Map(proposed.twists.map((twist) => [twist.id, twist]));
  const twists: BibleTwist[] = current.twists.map((twist) => {
    if (twist.status !== "pending") return { ...twist }; // fired/retired immutable
    const update = proposedTwistsById.get(twist.id);
    if (!update) return { ...twist, status: "retired" };
    return { ...twist, label: update.label, precondition: update.precondition };
  });
  const currentTwistIds = new Set(current.twists.map((twist) => twist.id));
  for (const candidate of proposed.twists) {
    if (twists.filter((twist) => twist.status === "pending").length >= TWISTS_MAX) break;
    if (currentTwistIds.has(candidate.id)) continue;
    twists.push({ ...candidate });
  }

  // cast / endingHints / motifs / protagonist stay as-attached: endingHints were
  // fuzzy-matched to the arc at attach time (a refresh payload is not arc-aware),
  // the cast/motif anchors keep the story's voice stable across acts, and the
  // protagonist identity is intentionally immutable — it must NEVER change
  // mid-story (it carries automatically through the `...current` spread).
  return { ...current, keyRegistry, lockPlan, twists };
}
