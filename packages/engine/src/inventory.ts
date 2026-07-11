import type { EngineDiff, InventoryItem, PlayerState } from "./types";

export function hasItem(state: PlayerState, itemId: string): boolean {
  return state.inventory.some((item) => item.id === itemId);
}

/** Drop case, spaces, and punctuation so "Bone Key" ~ "bone_key" ~ "bonekey". */
function normalizeItemRef(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Tolerant item lookup for LLM-authored `has_item`/`missing_item` conditions.
 * The model grants an item with one id/label and, turns later, gates a choice
 * on a differently-spelled id — with exact `id ===` matching the door stays
 * locked forever even though the reader holds the key. Match by normalized id
 * OR normalized label. The authored-story path keeps the strict `hasItem`.
 */
export function hasItemTolerant(state: PlayerState, ref: string): boolean {
  const target = normalizeItemRef(ref);
  if (target.length === 0) return false;
  return state.inventory.some(
    (item) =>
      item.id === ref ||
      normalizeItemRef(item.id) === target ||
      normalizeItemRef(item.label) === target,
  );
}

export function addItem(
  state: PlayerState,
  item: InventoryItem,
  diffs: EngineDiff[],
): void {
  if (hasItem(state, item.id)) return;
  state.inventory.push({ ...item });
  diffs.push({ kind: "inventory_add", target: item.id, delta: 1 });
}

export function removeItem(
  state: PlayerState,
  itemId: string,
  diffs: EngineDiff[],
): void {
  const before = state.inventory.length;
  state.inventory = state.inventory.filter((item) => item.id !== itemId);
  if (state.inventory.length !== before) {
    diffs.push({ kind: "inventory_remove", target: itemId, delta: -1 });
  }
}
