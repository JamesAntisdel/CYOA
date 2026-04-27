import type { ContentPolicyContext, ContentPolicySummary } from "@cyoa/shared";

import { buildSafeEnding, evaluateTextPolicy } from "../contentPolicy";

export type PromptGuardResult =
  | { allowed: true; summary: ContentPolicySummary }
  | { allowed: false; summary: ContentPolicySummary; safeEndingProse?: string };

export function guardPromptText(text: string, context: ContentPolicyContext): PromptGuardResult {
  const summary = evaluateTextPolicy({ text, context });
  if (summary.action === "allow" || summary.action === "rewrite") {
    return { allowed: true, summary };
  }

  if (summary.action === "safe_end" || summary.action === "safe_redirect") {
    return {
      allowed: false,
      summary,
      safeEndingProse: buildSafeEnding(summary).prose,
    };
  }

  return { allowed: false, summary };
}
