import { migrateSaveIfNeeded, type SaveMigrationPlan, type SaveRecord } from "./saves";

export type MigrationLogRecord = {
  saveId: string;
  fromEngineVersion: number;
  toEngineVersion: number;
  status: "pending" | "applied" | "failed";
  error?: string;
  createdAt: number;
  appliedAt?: number;
};

export function buildSaveMigrationPlan(
  save: SaveRecord & { _id: string },
  now: number,
): SaveMigrationPlan & { log?: MigrationLogRecord } {
  const before = save.engineVersion;
  const plan = migrateSaveIfNeeded(save);
  if (!plan.migrated) return plan;
  return {
    ...plan,
    log: {
      saveId: save._id,
      fromEngineVersion: before,
      toEngineVersion: plan.save.engineVersion,
      status: "applied",
      createdAt: now,
      appliedAt: now,
    },
  };
}
