import { AppError } from "./lib/errors";

export type DailyTurnCounter = {
  accountId: string;
  dayKey: string;
  turnsUsed: number;
  resetAt: number;
  updatedAt: number;
};

export function consumeTurn(input: {
  counter: DailyTurnCounter | null;
  accountId: string;
  dayKey: string;
  now: number;
  resetAt: number;
  allowance: number | "unlimited";
}): DailyTurnCounter {
  if (input.allowance !== "unlimited" && (input.counter?.turnsUsed ?? 0) >= input.allowance) {
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
