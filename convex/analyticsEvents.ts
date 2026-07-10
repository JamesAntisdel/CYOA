import type { ProviderName } from "@cyoa/shared";

import {
  buildAnalyticsEvent,
  type AnalyticsEventRecord,
} from "./analytics";
import type { ContentPolicySummary } from "@cyoa/shared";

/**
 * Pure builders for the turn-completion + narrative-safety `analytics_events`
 * rows written by the read-loop (Requirements 15.2 / 15.6, 27.2-27.5). These
 * are intentionally side-effect free so they can be unit-tested without a live
 * Convex DB — the mutation handlers in `convex/game.ts` / `convex/turn.ts` call
 * these and hand the resulting record straight to `ctx.db.insert`.
 *
 * Every field name here is chosen to match what the read-side aggregator
 * (`convex/analytics.ts` `buildOperatorDashboard` / `buildCostMetrics` /
 * `buildLiveMetrics` / `buildSafetyMetrics`) already consumes:
 *   - cost / tokens: `payload.inputTokens`, `payload.outputTokens`,
 *     top-level `provider` + `storyId`, `turnNumber` (counted as one turn),
 *     `saveId` (counted as one session).
 *   - latency: `payload.firstTokenMs`, `payload.totalMs` (or `payload.llmMs`).
 *   - fallback rate: `payload.fallback === true` (or eventName
 *     `provider.fallback`).
 *   - safety: eventName `safety.blocked|redirected|ended`, `payload.category`,
 *     `payload.action`.
 */

export type TurnCompletedAnalyticsInput = {
  accountId: string;
  saveId: string;
  storyId: string;
  turnNumber: number;
  provider: ProviderName;
  /** Provider-reported (or estimated) prompt/completion token counts. */
  inputTokens: number;
  outputTokens: number;
  /** Latency at each stage, in milliseconds. Absent stages are omitted. */
  engineMs?: number;
  llmMs?: number;
  firstTokenMs?: number;
  totalMs?: number;
  /**
   * True when the router fell through to the deterministic placeholder
   * provider (every real provider failed / was ineligible). Feeds the
   * dashboard's fallback-rate meter.
   */
  fallback: boolean;
  createdAt: number;
};

/**
 * Build the `llm.completed` row appended when a turn's scene lands. Carries
 * provider, token usage, per-stage latency, and the fallback flag so the
 * operator dashboard can compute tokens-per-session, cost-per-turn-by-provider,
 * time-to-first-token p50/p95, and fallback rate (Requirement 15.2 / 15.4).
 */
export function buildTurnCompletedEvent(
  input: TurnCompletedAnalyticsInput,
): AnalyticsEventRecord {
  return buildAnalyticsEvent({
    accountId: input.accountId,
    saveId: input.saveId,
    storyId: input.storyId,
    turnNumber: input.turnNumber,
    provider: input.provider,
    eventName: "llm.completed",
    payload: {
      provider: input.provider,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      ...(input.engineMs === undefined ? {} : { engineMs: input.engineMs }),
      ...(input.llmMs === undefined ? {} : { llmMs: input.llmMs }),
      ...(input.firstTokenMs === undefined ? {} : { firstTokenMs: input.firstTokenMs }),
      ...(input.totalMs === undefined ? {} : { totalMs: input.totalMs }),
      fallback: input.fallback,
    },
    createdAt: input.createdAt,
  });
}

export type SafetyAnalyticsEventName =
  | "safety.blocked"
  | "safety.redirected"
  | "safety.ended";

/**
 * Map a content-policy action to the redacted safety analytics event name
 * (Requirement 15.6). `block` / `rewrite` → blocked, `safe_end` → ended,
 * `safe_redirect` → redirected. `allow` has no safety event and returns null.
 */
export function safetyEventNameForAction(
  action: ContentPolicySummary["action"],
): SafetyAnalyticsEventName | null {
  switch (action) {
    case "block":
    case "rewrite":
      return "safety.blocked";
    case "safe_end":
      return "safety.ended";
    case "safe_redirect":
      return "safety.redirected";
    case "allow":
    default:
      return null;
  }
}

export type SafetyAnalyticsInput = {
  eventName: SafetyAnalyticsEventName;
  /** Content-policy action the classifier took (persisted as `payload.action`). */
  action: ContentPolicySummary["action"];
  /** Classifier safety categories — metadata only, never the unsafe text. */
  categories: string[];
  accountId?: string;
  saveId?: string;
  storyId?: string;
  turnNumber?: number;
  provider?: ProviderName;
  /** Latency impact of the safety pass, in milliseconds. */
  latencyMs?: number;
  createdAt: number;
};

/**
 * Build a redacted `safety.blocked|redirected|ended` row (Requirement 11.9 /
 * 15.6). Stores only metadata — classifier category + action taken + optional
 * latency — and is flagged `redacted: true`. The unsafe prose/choice text is
 * NEVER passed in, so nothing sensitive can leak; `buildAnalyticsEvent`'s
 * sanitizer is a second line of defence.
 */
export function buildSafetyAnalyticsEvent(
  input: SafetyAnalyticsInput,
): AnalyticsEventRecord {
  const category = input.categories.find((value) => value.length > 0);
  return buildAnalyticsEvent({
    ...(input.accountId === undefined ? {} : { accountId: input.accountId }),
    ...(input.saveId === undefined ? {} : { saveId: input.saveId }),
    ...(input.storyId === undefined ? {} : { storyId: input.storyId }),
    ...(input.turnNumber === undefined ? {} : { turnNumber: input.turnNumber }),
    ...(input.provider === undefined ? {} : { provider: input.provider }),
    eventName: input.eventName,
    payload: {
      action: input.action,
      ...(category === undefined ? {} : { category }),
      categories: input.categories,
      ...(input.latencyMs === undefined ? {} : { latencyMs: input.latencyMs }),
    },
    redacted: true,
    createdAt: input.createdAt,
  });
}
