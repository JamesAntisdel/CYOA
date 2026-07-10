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
