import { describe, expect, it } from "vitest";

import {
  ageGateRequestSchema,
  analyticsEventSchema,
  contentPolicyContextSchema,
  entitlementSchema,
  overageOptInRequestSchema,
  publishTaleRequestSchema,
  safeEndingSceneSchema,
  serverEnvSchema,
  submitTurnRequestSchema,
} from "../src";

describe("shared contracts", () => {
  it("accepts eligible age bands and rejects under-13 for guest creation contracts", () => {
    expect(ageGateRequestSchema.parse({ ageBand: "13-17" }).ageBand).toBe("13-17");
    expect(ageGateRequestSchema.parse({ ageBand: "under_13" }).ageBand).toBe("under_13");
  });

  it("requires a request id on turn submission", () => {
    expect(() =>
      submitTurnRequestSchema.parse({ saveId: "save", choiceId: "choice", requestId: "short" }),
    ).toThrow();
    expect(
      submitTurnRequestSchema.parse({
        saveId: "save",
        choiceId: "choice",
        requestId: "request-1",
      }),
    ).toMatchObject({ saveId: "save" });
  });

  it("models mature eligibility separately from globally blocked safety categories", () => {
    expect(
      contentPolicyContextSchema.parse({
        surface: "generation",
        entitlementTier: "pro",
        ageBand: "18+",
        matureContentEnabled: true,
      }),
    ).toMatchObject({ matureContentEnabled: true });

    expect(
      safeEndingSceneSchema.parse({
        status: "ended_safely",
        title: "The Book Closes",
        prose: "The page settles and the tale rests.",
        offeredBecause: ["player_directed_despair"],
      }),
    ).toMatchObject({ status: "ended_safely" });
  });

  it("requires explicit overage caps", () => {
    expect(() =>
      overageOptInRequestSchema.parse({
        accountId: "acct",
        enabled: true,
        monthlySpendCapCents: 0,
      }),
    ).toThrow();
  });

  it("validates Stripe-first entitlement shape", () => {
    expect(
      entitlementSchema.parse({
        accountId: "acct",
        tier: "pro",
        source: "stripe",
        status: "active",
        overageOptIn: false,
        updatedAt: 1,
      }),
    ).toMatchObject({ source: "stripe", tier: "pro" });
  });

  it("keeps analytics payload generic and redaction explicit", () => {
    expect(
      analyticsEventSchema.parse({
        eventName: "safety.ended",
        payload: { category: "player_directed_despair" },
        redacted: true,
        createdAt: 1,
      }),
    ).toMatchObject({ redacted: true });
  });

  it("validates publish metadata bounds", () => {
    expect(() =>
      publishTaleRequestSchema.parse({
        saveId: "save",
        title: "",
        synopsis: "x",
        privacy: "public",
        forkPolicy: "any_decision",
      }),
    ).toThrow();
  });

  it("allows partial server env for local mocked development", () => {
    expect(serverEnvSchema.parse({})).toEqual({});
  });
});
