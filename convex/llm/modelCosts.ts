// Cost telemetry — single source of truth for per-model token pricing
// (provider-and-credit design §1.3).
//
// Every model any provider can select gets an entry here. Providers surface
// their resolved `modelId` on the generation (`ProviderGeneration.modelId`);
// the turn path multiplies token usage by these rates and writes
// `estimatedCostCents` into the analytics turn payload (the operator dashboard
// already aggregates that field — it was previously always absent). Prices are
// USD per 1,000,000 tokens.
//
// `allowsMature` doubles as the mature-content routing gate
// (`providerPolicy.providerEligible`): when a reader has mature content enabled,
// the router drops any model whose `allowsMature` is false.
//
// PRICE SOURCE DATE: 2026-07. Update this table quarterly; when you do, bump
// the date on this comment. Fireworks serverless per-token pricing + each
// provider's public list price at that date:
//   - Fireworks DeepSeek-V3     $0.14 in / $0.28 out
//   - Fireworks GLM-4.6         $0.43 in / $1.75 out
//   - Fireworks GLM-5.2         $1.40 in / $4.40 out
//   - Gemini 3 Flash            $0.30 in / $2.50 out (best-effort; preview list price)
//   - Claude Sonnet 4.6         $3.00 in / $15.00 out
//   - Claude Haiku 4.5          $1.00 in / $5.00 out

export type ModelCost = {
  /** USD per 1M input (prompt) tokens. */
  inPerMTok: number;
  /** USD per 1M output (completion) tokens. */
  outPerMTok: number;
  /**
   * Whether this model may serve mature content. The tier-aware router drops
   * models whose `allowsMature` is false when the reader has mature content
   * enabled. The cheap open workhorse (DeepSeek-V3 on Fireworks) is gated OFF
   * for mature so mature turns climb to a model tuned to handle it.
   */
  allowsMature: boolean;
};

// Keys are the EXACT model ids providers report on their generations (see each
// provider module's config default), so a resolved `modelId` looks up directly.
export const COST_TABLE: Record<string, ModelCost> = {
  // Fireworks trio (default ids from convex/llm/fireworks.ts).
  "accounts/fireworks/models/deepseek-v3": { inPerMTok: 0.14, outPerMTok: 0.28, allowsMature: false },
  "accounts/fireworks/models/glm-4p6": { inPerMTok: 0.43, outPerMTok: 1.75, allowsMature: true },
  "accounts/fireworks/models/glm-5p2": { inPerMTok: 1.4, outPerMTok: 4.4, allowsMature: true },
  // Gemini (vertex.ts) — both the canonical name and the runtime preview id.
  "gemini-3-flash": { inPerMTok: 0.3, outPerMTok: 2.5, allowsMature: true },
  "gemini-3-flash-preview": { inPerMTok: 0.3, outPerMTok: 2.5, allowsMature: true },
  // Anthropic (anthropic.ts scene default + background haiku legs).
  "claude-sonnet-4-6": { inPerMTok: 3.0, outPerMTok: 15.0, allowsMature: true },
  "claude-haiku-4-5": { inPerMTok: 1.0, outPerMTok: 5.0, allowsMature: true },
};

/**
 * Look up a model's cost entry. Exact match first, then a tolerant match that
 * strips a trailing `-preview` (dated/preview snapshot ids) so
 * `gemini-3-flash-preview`-style runtime ids resolve to their base entry.
 * Returns `undefined` for unknown models.
 */
export function lookupModelCost(modelId: string): ModelCost | undefined {
  const exact = COST_TABLE[modelId];
  if (exact) return exact;
  const stripped = modelId.replace(/-preview$/, "");
  return COST_TABLE[stripped];
}

/**
 * Price a generation. Returns the estimated cost in CENTS (fractional) for the
 * given resolved `modelId` and token usage. Unknown models price at 0 so an
 * unpriceable generation never blocks or corrupts the turn path — it simply
 * records no cost. Negative / missing token counts are clamped to 0.
 */
export function costCentsForUsage(
  modelId: string,
  usage: { input?: number | undefined; output?: number | undefined },
): number {
  const cost = lookupModelCost(modelId);
  if (!cost) return 0;
  const input = Math.max(0, usage.input ?? 0);
  const output = Math.max(0, usage.output ?? 0);
  return (input / 1_000_000) * cost.inPerMTok * 100 + (output / 1_000_000) * cost.outPerMTok * 100;
}

/**
 * The mature-content gate for the router. Unknown models default to `true`
 * (permissive) so a model missing from the table is never silently blocked —
 * add it to `COST_TABLE` to gate it.
 */
export function modelAllowsMature(modelId: string): boolean {
  return lookupModelCost(modelId)?.allowsMature ?? true;
}
