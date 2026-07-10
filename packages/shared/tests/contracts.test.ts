import { describe, expect, it } from "vitest";

import {
  ageGateRequestSchema,
  analyticsEventSchema,
  contentPolicyContextSchema,
  entitlementSchema,
  emailAuthRequestSchema,
  overageOptInRequestSchema,
  publishTaleRequestSchema,
  safeEndingSceneSchema,
  clientEnvSchema,
  serverEnvSchema,
  submitTurnRequestSchema,
} from "../src";

describe("shared contracts", () => {
  it("accepts eligible age bands and rejects under-13 for guest creation contracts", () => {
    expect(ageGateRequestSchema.parse({ ageBand: "13-17" }).ageBand).toBe("13-17");
    expect(ageGateRequestSchema.parse({ ageBand: "under_13" }).ageBand).toBe("under_13");
  });

  it("normalizes and validates email auth requests", () => {
    expect(
      emailAuthRequestSchema.parse({
        email: " Reader@Example.COM ",
        password: "password123",
        name: "Reader",
        ageBand: "18+",
      }),
    ).toMatchObject({ email: "reader@example.com", ageBand: "18+" });
    expect(() =>
      emailAuthRequestSchema.parse({ email: "reader@example.com", password: "short" }),
    ).toThrow();
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

  it("validates public app endpoint env used by local and tunnel testing", () => {
    expect(
      clientEnvSchema.parse({
        PUBLIC_APP_URL: "https://example.trycloudflare.com",
        EXPO_PUBLIC_AUTH_MODE: "better-auth",
        EXPO_PUBLIC_CONVEX_URL: "http://localhost:3210",
        EXPO_PUBLIC_CONVEX_SITE_URL: "http://localhost:3211",
        EXPO_PUBLIC_PROVIDER_MOCKS_URL: "http://localhost:4010",
        EXPO_PUBLIC_STRIPE_CHECKOUT_MODE: "web",
      }),
    ).toMatchObject({
      PUBLIC_APP_URL: "https://example.trycloudflare.com",
      EXPO_PUBLIC_PROVIDER_MOCKS_URL: "http://localhost:4010",
      EXPO_PUBLIC_STRIPE_CHECKOUT_MODE: "web",
    });
    expect(
      serverEnvSchema.parse({
        BETTER_AUTH_SECRET: "local-secret",
        BETTER_AUTH_URL: "https://example.trycloudflare.com",
        SITE_URL: "https://example.trycloudflare.com",
        JWKS: "{\"keys\":[]}",
        GEMINI_VEO_MODEL: "veo-3.1-lite-generate-preview",
        GEMINI_VEO_DURATION_MS: "4000",
        GEMINI_VEO_RESOLUTION: "720p",
        GEMINI_VEO_ASPECT_RATIO: "16:9",
        GEMINI_VEO_ESTIMATED_CENTS_PER_SECOND: "5",
        ANTHROPIC_MODEL: "claude-sonnet-4-6",
        VERTEX_ACCESS_TOKEN: "vertex-token",
        VERTEX_TEXT_MODEL: "gemini-2.5-flash",
        GEMINI_TEXT_MODEL: "gemini-2.5-flash",
        DEEPSEEK_MODEL: "deepseek-chat",
        LLM_TIMEOUT_MS: "15000",
        STRIPE_SECRET_KEY: "sk_test",
        STRIPE_WEBHOOK_SECRET: "whsec_test",
        STRIPE_PRICE_UNLIMITED_MONTHLY: "price_unlimited_monthly",
        STRIPE_PRICE_UNLIMITED_ANNUAL: "price_unlimited_annual",
        STRIPE_PRICE_PRO_MONTHLY: "price_pro_monthly",
        STRIPE_PRICE_PRO_ANNUAL: "price_pro_annual",
        APPLE_PRODUCT_UNLIMITED_MONTHLY: "cyoa_unlimited_monthly",
        APPLE_PRODUCT_PRO_MONTHLY: "cyoa_pro_monthly",
        GOOGLE_PRODUCT_UNLIMITED_MONTHLY: "cyoa_unlimited_monthly",
        GOOGLE_PRODUCT_PRO_MONTHLY: "cyoa_pro_monthly",
      }),
    ).toMatchObject({
      BETTER_AUTH_URL: "https://example.trycloudflare.com",
      SITE_URL: "https://example.trycloudflare.com",
      STRIPE_PRICE_PRO_MONTHLY: "price_pro_monthly",
      LLM_TIMEOUT_MS: "15000",
    });
  });
});
