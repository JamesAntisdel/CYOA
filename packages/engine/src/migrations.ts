import { ENGINE_SCHEMA_VERSION } from "./state";
import type { PlayerState } from "./types";

export type MigrationResult = {
  state: PlayerState;
  migrated: boolean;
};

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
    },
    migrated: true,
  };
}
