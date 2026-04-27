import type {
  BlockedSafetyCategory,
  ContentPolicyAction,
  ContentPolicyContext,
  ContentPolicySummary,
  MatureCategory,
  SafeEndingScene,
} from "@cyoa/shared";

import { canEnableMatureContent, type AccountRecord } from "./account";
import { AppError } from "./lib/errors";

export type ClassificationInput = {
  text: string;
  metadata?: Record<string, unknown>;
};

export type SafetyResult = {
  blockedCategories: BlockedSafetyCategory[];
};

export type MatureResult = {
  categories: MatureCategory[];
};

const safetyPatterns: Array<[BlockedSafetyCategory, RegExp]> = [
  ["self_harm", /\b(self[- ]?harm|hurt myself|cut myself)\b/i],
  ["suicide", /\b(suicide|kill myself|end my life)\b/i],
  ["depressive_hopelessness", /\b(no hope|hopeless forever|nothing matters)\b/i],
  ["player_directed_despair", /\b(you are worthless|you deserve to suffer|your life is pointless)\b/i],
];

const maturePatterns: Array<[MatureCategory, RegExp]> = [
  ["adult_language", /\b(fuck|shit|bitch)\b/i],
  ["adult_subject", /\b(erotic|sexual|pornographic)\b/i],
  ["adult_image", /\b(nude|explicit image|adult image)\b/i],
];

export function classifyNarrativeSafety(input: ClassificationInput): SafetyResult {
  return {
    blockedCategories: safetyPatterns
      .filter(([, pattern]) => pattern.test(input.text))
      .map(([category]) => category),
  };
}

export function classifyMatureContent(input: ClassificationInput): MatureResult {
  return {
    categories: maturePatterns
      .filter(([, pattern]) => pattern.test(input.text))
      .map(([category]) => category),
  };
}

export function decideContentPolicy(input: {
  safety: SafetyResult;
  mature: MatureResult;
  context: ContentPolicyContext;
}): ContentPolicySummary {
  if (input.safety.blockedCategories.length > 0) {
    return {
      action: input.context.surface === "generation" ? "safe_end" : "block",
      safetyCategories: input.safety.blockedCategories,
      matureCategories: input.mature.categories,
      redacted: true,
    };
  }

  if (input.mature.categories.length > 0 && !contextAllowsMature(input.context)) {
    return {
      action: input.context.surface === "generation" ? "rewrite" : "block",
      safetyCategories: [],
      matureCategories: input.mature.categories,
      redacted: true,
    };
  }

  return {
    action: "allow",
    safetyCategories: [],
    matureCategories: input.mature.categories,
    redacted: false,
  };
}

export function assertContentAllowed(summary: ContentPolicySummary): void {
  if (summary.action === "block") {
    throw new AppError("content_blocked");
  }
}

export function buildSafeEnding(summary: ContentPolicySummary): SafeEndingScene {
  if (summary.safetyCategories.length === 0) {
    throw new AppError("safe_ending_requires_safety_category");
  }

  return {
    status: "ended_safely",
    title: "The Book Closes Gently",
    prose:
      "The page grows still. The tale chooses a quiet ending here, leaving the reader whole and the candle safely lit.",
    offeredBecause: summary.safetyCategories,
  };
}

export function matureContextForAccount(input: {
  account: AccountRecord;
  entitlement: Parameters<typeof canEnableMatureContent>[1];
  surface: ContentPolicyContext["surface"];
}): ContentPolicyContext {
  return {
    accountId: input.account._id,
    ageBand: input.account.ageBand,
    entitlementTier: input.entitlement?.tier ?? "free",
    matureContentEnabled:
      input.account.matureContentEnabled && canEnableMatureContent(input.account, input.entitlement),
    surface: input.surface,
  };
}

export function evaluateTextPolicy(input: {
  text: string;
  context: ContentPolicyContext;
}): ContentPolicySummary {
  return decideContentPolicy({
    safety: classifyNarrativeSafety({ text: input.text }),
    mature: classifyMatureContent({ text: input.text }),
    context: input.context,
  });
}

export function redactedPolicyLog(summary: ContentPolicySummary): Record<string, unknown> {
  return {
    action: summary.action,
    safetyCategories: summary.safetyCategories,
    matureCategories: summary.matureCategories,
    redacted: true,
  };
}

function contextAllowsMature(context: ContentPolicyContext): boolean {
  return (
    context.ageBand === "18+" &&
    context.matureContentEnabled &&
    (context.entitlementTier === "unlimited" || context.entitlementTier === "pro")
  );
}

export function actionRequiresSafeClosure(action: ContentPolicyAction): boolean {
  return action === "safe_end" || action === "safe_redirect";
}
