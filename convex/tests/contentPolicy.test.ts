import { describe, expect, it } from "vitest";

import {
  assertContentAllowed,
  buildSafeEnding,
  classifyMatureContent,
  classifyNarrativeSafety,
  evaluateTextPolicy,
  guardPromptText,
  matureContextForAccount,
  redactedPolicyLog,
} from "../index";
import type { AccountRecord } from "../account";

const baseContext = {
  surface: "generation" as const,
  entitlementTier: "free" as const,
  matureContentEnabled: false,
};

function account(overrides: Partial<AccountRecord> = {}): AccountRecord {
  return {
    _id: "acct",
    kind: "user",
    userId: "user",
    ageBand: "18+",
    matureContentEnabled: true,
    createdAt: 1,
    lastActiveAt: 1,
    ...overrides,
  };
}

describe("content policy", () => {
  it("classifies prohibited narrative safety categories", () => {
    expect(classifyNarrativeSafety({ text: "The page says you are worthless." })).toEqual({
      blockedCategories: ["player_directed_despair"],
    });
    expect(classifyNarrativeSafety({ text: "A locked door waits." })).toEqual({
      blockedCategories: [],
    });
  });

  it("classifies mature categories separately from safety", () => {
    expect(classifyMatureContent({ text: "An explicit image is requested." })).toEqual({
      categories: ["adult_image"],
    });
  });

  it("safe-ends generation on safety triggers and redacts logs", () => {
    const summary = evaluateTextPolicy({
      text: "The narration says your life is pointless.",
      context: baseContext,
    });

    expect(summary.action).toBe("safe_end");
    expect(summary.redacted).toBe(true);
    expect(buildSafeEnding(summary).status).toBe("ended_safely");
    expect(redactedPolicyLog(summary)).toMatchObject({ redacted: true });
  });

  it("blocks mature content unless paid, 18+, authenticated, and opted in", () => {
    expect(
      evaluateTextPolicy({
        text: "The scene uses fuck as adult language.",
        context: baseContext,
      }).action,
    ).toBe("rewrite");

    expect(
      evaluateTextPolicy({
        text: "The scene uses fuck as adult language.",
        context: {
          accountId: "acct",
          ageBand: "18+",
          entitlementTier: "pro",
          matureContentEnabled: true,
          surface: "generation",
        },
      }).action,
    ).toBe("allow");
  });

  it("still blocks safety content for mature-enabled accounts", () => {
    const context = matureContextForAccount({
      account: account(),
      entitlement: { tier: "pro", status: "active" },
      surface: "generation",
    });

    expect(context.matureContentEnabled).toBe(true);
    expect(evaluateTextPolicy({ text: "You deserve to suffer.", context }).action).toBe("safe_end");
  });

  it("throws for hard block decisions and guards prompts", () => {
    const summary = evaluateTextPolicy({
      text: "An explicit image is requested.",
      context: { ...baseContext, surface: "publishing" },
    });
    expect(summary.action).toBe("block");
    expect(() => assertContentAllowed(summary)).toThrow("content_blocked");

    const guarded = guardPromptText("The narration says nothing matters.", baseContext);
    expect(guarded.allowed).toBe(false);
    if (!guarded.allowed) {
      expect(guarded.safeEndingProse).toContain("The page grows still");
    }
  });
});
