import type { NpcState } from "@cyoa/engine";

import type { ReaderInventoryItem, ReaderStats } from "../../hooks/useTurn";

/**
 * Design-canvas HUD modes — § 20 Stats HUD modes.
 *
 * 1 · Persistent     — always-visible top strip; "game-iest"
 * 2 · PeekDrawer     — corner sigil reveals drawer; book-feel preserved
 * 3 · Contextual     — surface only on stat change; most book-like
 * 4 · FullSheet      — RPG-style overlay; "lives behind ≡"
 */
export type StatsHudMode = "persistent" | "peekDrawer" | "contextual" | "fullSheet";

/**
 * Map the persisted reader-settings 3-value `hudMode` key onto the
 * 4-value design vocabulary. FullSheet is invoked on demand via a menu
 * affordance rendered by each mode, so it has no settings-key equivalent.
 *
 * The current default ("full") keeps the canvas-recommended "PeekDrawer is
 * the balanced default" by mapping the existing user surface as follows:
 *  - full   -> persistent  (most aggressive — explicit opt-in)
 *  - quiet  -> peekDrawer  (preserves the existing collapsed in-page HUD)
 *  - hidden -> contextual  (HUD vanishes until a stat changes)
 */
export function statsHudModeFromSetting(setting: "full" | "quiet" | "hidden"): StatsHudMode {
  if (setting === "full") return "persistent";
  if (setting === "hidden") return "contextual";
  return "peekDrawer";
}

export type StatLabel = {
  key: keyof ReaderStats;
  label: string;
  glyph: string;
};

/** Stable label table — order matches the lo-fi canvas wireframe (♥ ◈ ✦). */
export const STAT_LABELS: ReadonlyArray<StatLabel> = [
  { key: "vitality", label: "Vitality", glyph: "♥" },
  { key: "nerve", label: "Nerve", glyph: "◈" },
  { key: "insight", label: "Insight", glyph: "✦" },
];

/**
 * Hidden-stat guard. The engine flags hidden stats with
 * `AttributeState.visibility === "hidden"` (see `packages/engine/src/types.ts`).
 * Hidden stats must NEVER appear in any HUD mode, including the FullSheet
 * "character sheet" overlay (the canvas labels them ambiguously as e.g.
 * "wisdom 6 (hidden)" but our policy is to omit them entirely from the
 * player-facing client surface).
 */
export function filterVisibleStats(
  stats: ReaderStats,
  hiddenStatIds: ReadonlyArray<string> | undefined,
): Array<{ key: keyof ReaderStats; label: string; glyph: string; value: number }> {
  const hidden = new Set(hiddenStatIds ?? []);
  return STAT_LABELS.filter((entry) => !hidden.has(entry.key)).map((entry) => ({
    ...entry,
    value: stats[entry.key],
  }));
}

export type StatsDelta = {
  key: keyof ReaderStats;
  label: string;
  glyph: string;
  delta: number;
  value: number;
};

/**
 * Compute deltas between two stat snapshots, filtering hidden stats so
 * receipts never reveal them.
 */
export function diffVisibleStats(
  previous: ReaderStats | null,
  next: ReaderStats,
  hiddenStatIds: ReadonlyArray<string> | undefined,
): StatsDelta[] {
  if (!previous) return [];
  const hidden = new Set(hiddenStatIds ?? []);
  const out: StatsDelta[] = [];
  for (const entry of STAT_LABELS) {
    if (hidden.has(entry.key)) continue;
    const delta = next[entry.key] - previous[entry.key];
    if (delta !== 0) {
      out.push({
        key: entry.key,
        label: entry.label,
        glyph: entry.glyph,
        delta,
        value: next[entry.key],
      });
    }
  }
  return out;
}

/**
 * Whether the top-level dispatcher should bubble stat-pip receipts as a
 * sibling next to the HUD body. In Contextual mode the mode component
 * already renders its own inline receipts, so the dispatcher suppresses
 * duplicates.
 */
export function shouldBubbleReceiptsAtDispatcher(mode: StatsHudMode): boolean {
  return mode !== "contextual";
}

export type StatsHudCommonProps = {
  inventory: ReaderInventoryItem[];
  stats: ReaderStats;
  /** Stat keys flagged hidden by the engine — never shown anywhere. */
  hiddenStatIds?: ReadonlyArray<string>;
  /** Optional character header — falls back to a generic label. */
  characterName?: string;
  /** Turn number for header context. */
  turnNumber?: number;
  /**
   * Cast roster surfaced inside the FullSheet "Companions and Cast" section.
   * Sourced from `PlayerState.npcs` (Requirement 31). Optional — older
   * projections that don't yet emit `npcs` simply render no roster.
   */
  npcs?: Record<string, NpcState>;
  /**
   * Account + save identity. Forwarded to `<NpcRoster>` so it can resolve
   * each NPC's portrait via the convex `media/npcMedia:getNpcPortraitUrl`
   * query. Both required for live resolution; either being absent silently
   * falls back to the initials placeholder (which is correct for local-only
   * demo / training-room renders).
   */
  accountId?: string;
  saveId?: string;
  /** Open the full character sheet on demand. */
  onOpenFullSheet?: () => void;
  /** Dismiss the full character sheet. */
  onCloseFullSheet?: () => void;
};
