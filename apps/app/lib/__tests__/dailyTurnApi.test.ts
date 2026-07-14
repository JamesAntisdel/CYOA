import { describe, expect, it } from "vitest";

import {
  adaptDailyTurnState,
  candleBurnModel,
  CANDLE_METER_THRESHOLD,
  DAILY_TURN_STATE_PATH,
  type RemoteDailyTurnState,
} from "../dailyTurnApi";

describe("BC1 — daily turn-state path is the full registered path", () => {
  it("includes the module prefix (dailyTurns:getDailyTurnState)", () => {
    expect(DAILY_TURN_STATE_PATH).toBe("dailyTurns:getDailyTurnState");
  });
});

describe("adaptDailyTurnState (BC2 null-mapping)", () => {
  it("returns null for a missing/garbage payload (fail-open)", () => {
    expect(adaptDailyTurnState(null)).toBe(null);
    expect(adaptDailyTurnState(undefined)).toBe(null);
    expect(adaptDailyTurnState("nope" as never)).toBe(null);
  });

  it("maps a capped free tier", () => {
    const state = adaptDailyTurnState({
      turnsUsedToday: 4,
      allowance: 10,
      resetsAtUtc: 1_000,
    });
    expect(state).toEqual({
      turnsUsed: 4,
      turnsAllowed: 10,
      resetsAtUtc: 1_000,
      unlimited: false,
    });
  });

  it("treats the 'unlimited' literal or a non-positive allowance as no cap", () => {
    expect(adaptDailyTurnState({ turnsUsedToday: 99, allowance: "unlimited", resetsAtUtc: 0 }))
      .toMatchObject({ turnsAllowed: 0, unlimited: true });
    expect(adaptDailyTurnState({ turnsUsedToday: 3, allowance: null, resetsAtUtc: 0 }))
      .toMatchObject({ turnsAllowed: 0, unlimited: true });
    expect(adaptDailyTurnState({ turnsUsedToday: 3, allowance: 0, resetsAtUtc: 0 }))
      .toMatchObject({ unlimited: true });
  });

  it("floors garbage turnsUsed to a safe non-negative default", () => {
    expect(adaptDailyTurnState({ turnsUsedToday: -5, allowance: 10, resetsAtUtc: 0 }))
      .toMatchObject({ turnsUsed: 0 });
    expect(adaptDailyTurnState({ turnsUsedToday: null, allowance: 10, resetsAtUtc: 0 }))
      .toMatchObject({ turnsUsed: 0 });
  });
});

describe("candleBurnModel — meter / gutter gates (Principle 7)", () => {
  const cap = (turnsUsed: number, turnsAllowed = 10): RemoteDailyTurnState => ({
    turnsUsed,
    turnsAllowed,
    resetsAtUtc: 0,
    unlimited: false,
  });

  it("never burns for unlimited / null state", () => {
    expect(candleBurnModel(null, 0).showMeter).toBe(false);
    expect(candleBurnModel(null, 0).guttered).toBe(false);
    const unlimited: RemoteDailyTurnState = { turnsUsed: 99, turnsAllowed: 0, resetsAtUtc: 0, unlimited: true };
    expect(candleBurnModel(unlimited, 0).guttered).toBe(false);
    expect(candleBurnModel(unlimited, 0).showMeter).toBe(false);
  });

  it("hides the meter below 50% burn", () => {
    expect(candleBurnModel(cap(4), 0).showMeter).toBe(false);
  });

  it("shows the meter from exactly 50% burn", () => {
    expect(CANDLE_METER_THRESHOLD).toBe(0.5);
    const m = candleBurnModel(cap(5), 0);
    expect(m.showMeter).toBe(true);
    expect(m.guttered).toBe(false);
    expect(m.remaining).toBe(5);
  });

  it("gutters at the cap and stops showing the meter", () => {
    const m = candleBurnModel(cap(10), 0);
    expect(m.guttered).toBe(true);
    expect(m.showMeter).toBe(false);
    expect(m.remaining).toBe(0);
  });

  it("gutters past the cap too (defensive)", () => {
    expect(candleBurnModel(cap(12), 0).guttered).toBe(true);
  });

  it("formats the reset countdown from resetsAtUtc", () => {
    const state: RemoteDailyTurnState = { turnsUsed: 10, turnsAllowed: 10, resetsAtUtc: 3_600_000, unlimited: false };
    // 1h from now(=0) → "1h 00m"
    expect(candleBurnModel(state, 0).resetsInLabel).toBe("1h 00m");
  });
});
