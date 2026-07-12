// Cost telemetry table + pricing (provider-and-credit design §1.3).

import { describe, expect, it } from "vitest";

import { COST_TABLE, costCentsForUsage, lookupModelCost, modelAllowsMature } from "../llm/modelCosts";
import { FIREWORKS_DEFAULT_MODELS } from "../llm/fireworks";

describe("COST_TABLE coverage", () => {
  it("covers the Fireworks trio at their default ids", () => {
    expect(COST_TABLE[FIREWORKS_DEFAULT_MODELS.cheap]).toEqual({
      inPerMTok: 0.14,
      outPerMTok: 0.28,
      allowsMature: false,
    });
    expect(COST_TABLE[FIREWORKS_DEFAULT_MODELS.mid]).toEqual({
      inPerMTok: 0.43,
      outPerMTok: 1.75,
      allowsMature: true,
    });
    expect(COST_TABLE[FIREWORKS_DEFAULT_MODELS.premium]).toEqual({
      inPerMTok: 1.4,
      outPerMTok: 4.4,
      allowsMature: true,
    });
  });

  it("covers Gemini, Sonnet 4.6 and Haiku 4.5", () => {
    expect(COST_TABLE["gemini-3-flash"]).toBeDefined();
    expect(COST_TABLE["claude-sonnet-4-6"]).toEqual({ inPerMTok: 3.0, outPerMTok: 15.0, allowsMature: true });
    expect(COST_TABLE["claude-haiku-4-5"]).toEqual({ inPerMTok: 1.0, outPerMTok: 5.0, allowsMature: true });
  });
});

describe("costCentsForUsage", () => {
  it("prices a generation in cents from per-MTok rates", () => {
    // 1,000,000 input @ $0.14/M = $0.14 = 14 cents; 500,000 output @ $0.28/M
    // = $0.14 = 14 cents; total 28 cents.
    expect(
      costCentsForUsage(FIREWORKS_DEFAULT_MODELS.cheap, { input: 1_000_000, output: 500_000 }),
    ).toBeCloseTo(28, 6);
  });

  it("prices the premium Fireworks model correctly", () => {
    // 100k in @ $1.40/M = $0.14 = 14¢; 100k out @ $4.40/M = $0.44 = 44¢ → 58¢.
    expect(
      costCentsForUsage(FIREWORKS_DEFAULT_MODELS.premium, { input: 100_000, output: 100_000 }),
    ).toBeCloseTo(58, 6);
  });

  it("tolerant-matches a -preview snapshot id to its base entry", () => {
    expect(lookupModelCost("gemini-3-flash-preview")).toEqual(lookupModelCost("gemini-3-flash"));
    expect(costCentsForUsage("gemini-3-flash-preview", { input: 1_000_000, output: 0 })).toBeCloseTo(30, 6);
  });

  it("prices an unknown model at 0 (unpriceable, never blocks the turn)", () => {
    expect(costCentsForUsage("no/such/model", { input: 10_000, output: 10_000 })).toBe(0);
  });

  it("clamps missing/negative token counts to 0", () => {
    expect(costCentsForUsage(FIREWORKS_DEFAULT_MODELS.cheap, {})).toBe(0);
    expect(costCentsForUsage(FIREWORKS_DEFAULT_MODELS.cheap, { input: -5, output: -5 })).toBe(0);
  });
});

describe("modelAllowsMature", () => {
  it("gates the cheap open model off but allows the mid/premium and quality models", () => {
    expect(modelAllowsMature(FIREWORKS_DEFAULT_MODELS.cheap)).toBe(false);
    expect(modelAllowsMature(FIREWORKS_DEFAULT_MODELS.mid)).toBe(true);
    expect(modelAllowsMature(FIREWORKS_DEFAULT_MODELS.premium)).toBe(true);
    expect(modelAllowsMature("claude-sonnet-4-6")).toBe(true);
  });

  it("defaults unknown models to permissive (true)", () => {
    expect(modelAllowsMature("no/such/model")).toBe(true);
  });
});
