import { AppError } from "./lib/errors";

export type DailyTurnCounter = {
  accountId: string;
  dayKey: string;
  turnsUsed: number;
  resetAt: number;
  updatedAt: number;
};

// Dev-only escape hatch matching the CYOA_DEV_FORCE_PRO_MEDIA pattern used
// for media gating. When CYOA_DEV_UNLIMITED_TURNS=1 the daily-turn cap is
// ignored so iterating on prompt/UI changes doesn't burn through the
// 10-turn free-tier allowance every dev session. Production deploys never
// set this env var.
function devUnlimitedTurns(): boolean {
  return process.env.CYOA_DEV_UNLIMITED_TURNS === "1";
}

export function consumeTurn(input: {
  counter: DailyTurnCounter | null;
  accountId: string;
  dayKey: string;
  now: number;
  resetAt: number;
  allowance: number | "unlimited";
}): DailyTurnCounter {
  const effectiveAllowance = devUnlimitedTurns() ? "unlimited" : input.allowance;
  if (effectiveAllowance !== "unlimited" && (input.counter?.turnsUsed ?? 0) >= effectiveAllowance) {
    throw new AppError("daily_turns_exhausted");
  }

  return {
    accountId: input.accountId,
    dayKey: input.dayKey,
    turnsUsed: (input.counter?.turnsUsed ?? 0) + 1,
    resetAt: input.resetAt,
    updatedAt: input.now,
  };
}
