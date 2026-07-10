import { ENGINE_SCHEMA_VERSION } from "./state";
import type { PlayerState } from "./types";

export type MigrationResult = {
  state: PlayerState;
  migrated: boolean;
};

/**
 * Brings a stored `PlayerState` snapshot forward to
 * `ENGINE_SCHEMA_VERSION`. Stays additive — every legacy invariant is
 * preserved and the migrated shape is a superset. The cascade is:
 *
 *   v0 → v1: backfill `delayed: []` and `endingsUnlocked: {}` for snapshots
 *            that pre-date the delayed-effects + endings ledger features.
 *   v1 → v2: backfill `npcs: {}` for Requirement 31 (NPCs and Companions);
 *            saves created before the roster field shipped have no NPCs and
 *            land at the v2 baseline with an empty roster.
 *
 * Future-schema snapshots reject so a downgrade of the client never silently
 * corrupts a save written by a newer build.
 */
export function migrateEngineState(rawState: PlayerState): MigrationResult {
  if (rawState.schemaVersion === ENGINE_SCHEMA_VERSION) {
    return { state: rawState, migrated: false };
  }

  if (rawState.schemaVersion > ENGINE_SCHEMA_VERSION) {
    throw new Error("unsupported_future_engine_schema");
  }

  return {
    state: {
      ...rawState,
      schemaVersion: ENGINE_SCHEMA_VERSION,
      delayed: rawState.delayed ?? [],
      endingsUnlocked: rawState.endingsUnlocked ?? {},
      npcs: rawState.npcs ?? {},
    },
    migrated: true,
  };
}
