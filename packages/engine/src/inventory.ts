import type { EngineDiff, InventoryItem, PlayerState } from "./types";

export function hasItem(state: PlayerState, itemId: string): boolean {
  return state.inventory.some((item) => item.id === itemId);
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
