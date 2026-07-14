import { slugify } from "./arc";
import { cloneNpc } from "./state";
import type {
  EngineDiff,
  NpcInventoryItem,
  NpcState,
  PlayerState,
} from "./types";
import {
  NPC_DISPOSITION_MAX,
  NPC_DISPOSITION_MIN,
  NPC_FACT_MAX_LENGTH,
} from "./types";

// =============================================================================
// NPC reducer helpers (Requirement 31).
//
// Each helper mirrors the player-state convention in `stats.ts`/`flags.ts`/
// `inventory.ts`: pure-ish mutation of the `state` arg with a corresponding
// EngineDiff appended. The reducer in `apply.ts` (and the LLM-flow reducer in
// `llm.ts`) dispatches `npc_*` Effect kinds to these functions.
//
// Invariants enforced here:
//   - Unknown npcId rejects with `npc_not_found:<id>` (mirrors the engine's
//     `node_not_found` / `choice_not_found` error style).
//   - Disposition is integer-clamped to [-100, 100] after every delta.
//   - Attribute deltas clamp to the per-attribute min/max bounds, same as
//     player attribute math in stats.ts.
//   - Idempotent operations (spawn/despawn, inventory add/remove, learn_fact)
//     skip diff emission when the state is already in the target shape so the
//     diff log reflects real changes only.
// =============================================================================

function requireNpc(state: PlayerState, npcId: string): NpcState {
  const npc = state.npcs[npcId];
  if (!npc) throw new Error(`npc_not_found:${npcId}`);
  return npc;
}

export function spawnNpc(
  state: PlayerState,
  npc: NpcState,
  diffs: EngineDiff[],
): void {
  if (state.npcs[npc.id]) return;
  // Clamp disposition on insertion so an authored NpcState that overshoots
  // ±100 cannot poison the roster — `npc_disposition_delta` would clamp later
  // anyway and we'd rather the invariant hold from t=0.
  const seeded = cloneNpc(npc);
  seeded.disposition = clampDisposition(seeded.disposition);
  state.npcs[npc.id] = seeded;
  diffs.push({ kind: "npc_spawn", target: npc.id, delta: 1 });
}

export function despawnNpc(
  state: PlayerState,
  npcId: string,
  diffs: EngineDiff[],
): void {
  if (!state.npcs[npcId]) return;
  delete state.npcs[npcId];
  diffs.push({ kind: "npc_despawn", target: npcId, delta: -1 });
}

export function relocateNpc(
  state: PlayerState,
  npcId: string,
  location: string | undefined,
  diffs: EngineDiff[],
): void {
  const npc = requireNpc(state, npcId);
  const before = npc.location;
  if (location === undefined) {
    delete npc.location;
  } else {
    npc.location = location;
  }
  diffs.push({
    kind: "npc_relocate",
    target: npcId,
    delta: null,
    ...(before !== undefined ? { before } : {}),
    ...(location !== undefined ? { after: location } : {}),
  });
}

export function applyDispositionDelta(
  state: PlayerState,
  npcId: string,
  delta: number,
  diffs: EngineDiff[],
): void {
  const npc = requireNpc(state, npcId);
  const before = npc.disposition;
  const after = clampDisposition(before + delta);
  npc.disposition = after;
  diffs.push({
    kind: "npc_disposition",
    target: npcId,
    delta,
    before,
    after,
  });
}

export function applyNpcAttributeDelta(
  state: PlayerState,
  npcId: string,
  attributeId: string,
  delta: number,
  diffs: EngineDiff[],
): void {
  const npc = requireNpc(state, npcId);
  const existing = npc.attributes[attributeId];
  if (!existing) throw new Error(`npc_attribute_not_found:${npcId}:${attributeId}`);
  const before = existing.value;
  const after = clampAttribute(before + delta, existing.min, existing.max);
  npc.attributes[attributeId] = { ...existing, value: after };
  diffs.push({
    kind: "npc_attribute",
    target: npcId,
    attributeId,
    delta,
    before,
    after,
  });
}

export function addNpcInventoryItem(
  state: PlayerState,
  npcId: string,
  item: NpcInventoryItem,
  diffs: EngineDiff[],
): void {
  const npc = requireNpc(state, npcId);
  const inventory = npc.inventory ?? [];
  if (inventory.some((existing) => existing.id === item.id)) return;
  npc.inventory = [...inventory, { ...item }];
  diffs.push({ kind: "npc_inventory_add", target: npcId, itemId: item.id, delta: 1 });
}

export function removeNpcInventoryItem(
  state: PlayerState,
  npcId: string,
  itemId: string,
  diffs: EngineDiff[],
): void {
  const npc = requireNpc(state, npcId);
  const inventory = npc.inventory;
  if (!inventory) return;
  const next = inventory.filter((item) => item.id !== itemId);
  if (next.length === inventory.length) return;
  npc.inventory = next;
  diffs.push({ kind: "npc_inventory_remove", target: npcId, itemId, delta: -1 });
}

export function setNpcFlag(
  state: PlayerState,
  npcId: string,
  flag: string,
  value: boolean | number,
  diffs: EngineDiff[],
): void {
  const npc = requireNpc(state, npcId);
  const before = npc.flags[flag];
  npc.flags[flag] = value;
  diffs.push({
    kind: "npc_flag_set",
    target: npcId,
    flag,
    delta: value,
    ...(before === undefined ? {} : { before }),
    after: value,
  });
}

export function learnNpcFact(
  state: PlayerState,
  npcId: string,
  rawFact: string,
  diffs: EngineDiff[],
): void {
  const npc = requireNpc(state, npcId);
  const trimmed = rawFact.slice(0, NPC_FACT_MAX_LENGTH);
  // Dedupe on exact match against existing facts — the LLM/prompt builder
  // would otherwise pile up identical "Mira is hungry" entries every time the
  // beat repeats.
  if (npc.knownFacts.includes(trimmed)) return;
  npc.knownFacts = [...npc.knownFacts, trimmed];
  diffs.push({ kind: "npc_learn_fact", target: npcId, fact: trimmed, delta: 1 });
}

function clampDisposition(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const integer = Math.trunc(value);
  if (integer < NPC_DISPOSITION_MIN) return NPC_DISPOSITION_MIN;
  if (integer > NPC_DISPOSITION_MAX) return NPC_DISPOSITION_MAX;
  return integer;
}

function clampAttribute(value: number, min?: number, max?: number): number {
  let next = value;
  if (min !== undefined) next = Math.max(min, next);
  if (max !== undefined) next = Math.min(max, next);
  return next;
}

// Note: skill-check resolution (Requirement 31.5) lives in `stats.ts` as
// `resolveSkillCheck` / `SkillCheckBreakdown`. It belongs alongside the rest
// of the stat machinery because it operates on the player's own attribute
// total — companion contributions are an additive layer, not a separate
// system. Keep this module focused on the NPC reducer surface.

// =============================================================================
// NPC loyalty / betrayal threshold arcs (Panel-2 Wave 3). Disposition already
// drifts ±15/turn on the llm path but nothing DRAMATIC ever happened when it
// crossed a threshold. These one-shot "bond" crossings give it a payoff: the
// first turn an NPC's disposition reaches +75 a loyalty bond CRYSTALLIZES, and
// the first turn it drops to −60 the bond BREAKS. Each fires exactly once per
// direction, stamped on the NPC so a re-cross doesn't re-fire (mirrors the arc
// `beat.status` one-shot). Surfacing is deliberately through EXISTING channels
// (no new diff/event kind): the crossing pushes a `fact_learned` diff (the same
// reader-visible echo an `npc_learn_fact` produces) and FRONT-INSERTS a payoff
// line into the NPC's `knownFacts` so the NEXT turn's NPC sheet (which renders
// the top-3 facts) carries it into the prompt for the narrator to pay off.
// Pure + total (no console/Date.now) — safe for the engine package.
// =============================================================================

/** Disposition at/above which a loyalty bond crystallizes (one-shot). */
export const BOND_CRYSTALLIZE_AT = 75;
/** Disposition at/below which a bond breaks (one-shot). */
export const BOND_BREAK_AT = -60;
/**
 * Reserved numeric NPC flag stamping the last-fired bond direction so a crossing
 * fires once: `1` after crystallize, `-1` after break, absent before either.
 * A break after a crystallize (or vice-versa) is a genuine transition and DOES
 * re-fire — only re-crossing the SAME threshold without leaving is suppressed.
 * Lives in `flags` (hidden — `projectNpcSheet` never surfaces NPC flags) so it
 * never leaks into the prompt or the client.
 */
export const BOND_STATE_FLAG = "__bondState";
/** Keep the bond payoff line inside a sane per-NPC fact budget (mirrors llm.ts). */
const BOND_FACT_CAP = 12;

/**
 * Scan the roster and fire any pending one-shot bond crossing (Panel-2 W3).
 * Called from the llm turn firing point AFTER this turn's disposition deltas
 * have applied. Mutates `state.npcs[*]` (stamps `BOND_STATE_FLAG`, front-inserts
 * a payoff `knownFact`) and appends a `fact_learned` diff per crossing. Pure +
 * deterministic; idempotent once stamped. Returns nothing — the diffs carry the
 * reader-visible echo and the fact carries the next-scene payoff.
 */
export function fireBondCrossings(state: PlayerState, diffs: EngineDiff[]): void {
  for (const npc of Object.values(state.npcs)) {
    const disposition = npc.disposition;
    if (typeof disposition !== "number" || !Number.isFinite(disposition)) continue;
    const stamped = npc.flags[BOND_STATE_FLAG];
    if (disposition >= BOND_CRYSTALLIZE_AT && stamped !== 1) {
      npc.flags = { ...npc.flags, [BOND_STATE_FLAG]: 1 };
      pushBondFact(npc, `trusts you completely now — a loyalty just forged`);
      diffs.push({ kind: "fact_learned", target: npc.id, visibility: "visible" });
    } else if (disposition <= BOND_BREAK_AT && stamped !== -1) {
      npc.flags = { ...npc.flags, [BOND_STATE_FLAG]: -1 };
      pushBondFact(npc, `no longer trusts you — a bond just broken`);
      diffs.push({ kind: "fact_learned", target: npc.id, visibility: "visible" });
    }
  }
}

/**
 * Front-insert a bond payoff line so the NPC sheet's top-3 `knownFacts` window
 * surfaces it next turn. Deduped (a re-fire in the same direction is already
 * suppressed by the flag, but guard anyway) and capped to the per-NPC budget.
 */
function pushBondFact(npc: NpcState, fact: string): void {
  const trimmed = fact.slice(0, NPC_FACT_MAX_LENGTH);
  const without = npc.knownFacts.filter((existing) => existing !== trimmed);
  npc.knownFacts = [trimmed, ...without].slice(0, BOND_FACT_CAP);
}

// =============================================================================
// Cast ↔ roster linking (Panel-2 W3). The bible's `cast` sheet and the live
// `npcs` roster are disjoint namespaces (SB4: the engine cannot read the bible
// at spawn time, so the link cannot be stamped inside `npc_spawn`). The
// integrator calls `linkCastIds` each turn with the bible's cast ids after
// reading the row; it stamps `castId` by slug once so the pairing is durable
// even if a later scene mis-spells the spawn id. Pure + total; idempotent
// (already-linked NPCs are skipped).
// =============================================================================

/**
 * Resolve the cast slug an NPC belongs to (Panel-2 W3): a direct id match
 * first (the prompt asks the model to reuse cast ids when spawning), then a
 * slug-of-name match as a fallback. Returns undefined when nothing matches.
 */
export function matchCastId(
  npc: Pick<NpcState, "id" | "name">,
  castIds: ReadonlyArray<string>,
): string | undefined {
  if (castIds.includes(npc.id)) return npc.id;
  const nameSlug = slugify(npc.name);
  if (nameSlug.length > 0 && castIds.includes(nameSlug)) return nameSlug;
  return undefined;
}

/**
 * Stamp `castId` on every unlinked NPC that resolves to a bible cast member
 * (Panel-2 W3). Mutates `npcs` in place; a no-op when `castIds` is empty
 * (bible-less save) or every NPC is already linked.
 */
export function linkCastIds(
  npcs: Record<string, NpcState>,
  castIds: ReadonlyArray<string>,
): void {
  if (castIds.length === 0) return;
  for (const npc of Object.values(npcs)) {
    if (npc.castId !== undefined) continue;
    const match = matchCastId(npc, castIds);
    if (match !== undefined) npc.castId = match;
  }
}
