import type { LlmProvider, ProviderName, SceneGenerationRequest } from "./types";
import { fireworksModelId, type FireworksModelTier } from "./fireworks";
import { modelAllowsMature } from "./modelCosts";
import { readEnv } from "./httpClient";

// Canonical model ids for the non-Fireworks providers, mirroring their config
// defaults so the mature-content gate can look each one up in the cost table
// without importing the provider modules (which would pull in fetch/postJson
// wiring). Kept in sync with anthropic.ts / vertex.ts defaults.
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";
const DEFAULT_VERTEX_MODEL = "gemini-3-flash-preview";

/**
 * One entry in a tier's provider order. For a Fireworks step, `fireworksTier`
 * pins WHICH of the three Fireworks models to serve so a single order can list
 * Fireworks twice (an in-turn cheap→mid / mid→premium escalation ladder).
 */
export type ProviderStep = { name: ProviderName; fireworksTier?: FireworksModelTier };

const fw = (fireworksTier: FireworksModelTier): ProviderStep => ({ name: "fireworks", fireworksTier });
const step = (name: ProviderName): ProviderStep => ({ name });

/**
 * `risk` is only a SECONDARY escalation hint (design §1.2): a parse-failure
 * retry or a sensitive turn may bump one Fireworks tier up and, for Unlimited,
 * unlock Anthropic as a last quality leg.
 */
function isEscalated(request: SceneGenerationRequest): boolean {
  return request.risk === "sensitive" || request.retryCount > 0;
}

/**
 * Tier-aware provider order (design §1.2). Ordered by the reader's ENTITLEMENT
 * tier; first eligible provider wins. Deterministic is always the final
 * fallback so a turn never hard-fails (BC5).
 *
 *   guest / free  → Fireworks cheap → Fireworks mid → deterministic.
 *                   NEVER Anthropic/Vertex (cost).
 *   unlimited     → Fireworks mid → Fireworks premium → Vertex → deterministic.
 *                   Anthropic only on a parse-retry escalation.
 *   pro           → Fireworks premium → Anthropic → Vertex → deterministic.
 *
 * Absent `tier` defaults to `free` — the cheapest, safest lane.
 */
/**
 * Operational escape hatch (not part of the tier design): when
 * `LLM_PROVIDER_OVERRIDE` names a provider, EVERY tier routes to just that
 * provider, then deterministic. Set `LLM_PROVIDER_OVERRIDE=vertex` (with
 * `GEMINI_TEXT_MODEL` pointing at a Flash-Lite id) to run the whole app on
 * Gemini while Fireworks is not yet configured. Unset it to restore
 * tier-aware routing. An unrecognized value is ignored (falls through to
 * tier routing) so a typo can never strand every turn on deterministic.
 */
function overrideOrder(): ProviderStep[] | null {
  const raw = readEnv("LLM_PROVIDER_OVERRIDE");
  if (raw === undefined) return null;
  const name = raw.trim().toLowerCase();
  const known: ProviderName[] = ["fireworks", "anthropic", "vertex", "deepseek", "deterministic"];
  if (!(known as string[]).includes(name)) return null;
  if (name === "deterministic") return [step("deterministic")];
  // Fireworks under an override serves its cheap model unless MID/PREMIUM is
  // pinned separately; other providers ignore the tier field.
  const first: ProviderStep = name === "fireworks" ? fw("cheap") : step(name as ProviderName);
  return [first, step("deterministic")];
}

export function providerOrder(request: SceneGenerationRequest): ProviderStep[] {
  const override = overrideOrder();
  if (override) return override;

  const tier = request.tier ?? "free";
  const escalated = isEscalated(request);
  switch (tier) {
    case "guest":
    case "free":
      // Cost gate: the free lanes never touch Anthropic or Vertex. An
      // escalation just leads with the mid Fireworks model.
      return escalated
        ? [fw("mid"), fw("cheap"), step("deterministic")]
        : [fw("cheap"), fw("mid"), step("deterministic")];
    case "unlimited":
      return escalated
        ? [fw("premium"), fw("mid"), step("vertex"), step("anthropic"), step("deterministic")]
        : [fw("mid"), fw("premium"), step("vertex"), step("deterministic")];
    case "pro":
      // Best prose for the paying media tier. Escalation doesn't change the
      // set — Anthropic is already in the primary path.
      return [fw("premium"), step("anthropic"), step("vertex"), step("deterministic")];
    default:
      return [fw("cheap"), fw("mid"), step("deterministic")];
  }
}

/**
 * Whether a candidate (provider + optional Fireworks tier) may serve mature
 * content. Resolves the model id the candidate would call and reads its
 * `allowsMature` flag from the cost table. The deterministic safety net is
 * always allowed.
 */
function candidateAllowsMature(name: ProviderName, fireworksTier?: FireworksModelTier): boolean {
  switch (name) {
    case "fireworks":
      return modelAllowsMature(fireworksModelId(fireworksTier ?? "cheap"));
    case "anthropic":
      return modelAllowsMature(readEnv("ANTHROPIC_MODEL") ?? DEFAULT_ANTHROPIC_MODEL);
    case "vertex":
      return modelAllowsMature(readEnv("GEMINI_TEXT_MODEL") ?? readEnv("VERTEX_TEXT_MODEL") ?? DEFAULT_VERTEX_MODEL);
    case "deterministic":
      return true;
    default:
      // deepseek (legacy, no longer in any order) and any unknown provider
      // fall through: gated OFF for mature so a stray registration can't leak.
      return name === "deepseek" ? false : true;
  }
}

/**
 * A provider is eligible when it is healthy AND (when the reader has mature
 * content enabled) the candidate model allows mature content. `fireworksTier`
 * pins the Fireworks model for the mature gate on Fireworks steps.
 */
export function providerEligible(
  provider: LlmProvider,
  request: SceneGenerationRequest,
  fireworksTier?: FireworksModelTier,
): boolean {
  if (!provider.health().available) return false;
  if (
    request.contentContext.matureContentEnabled === true &&
    !candidateAllowsMature(provider.name, fireworksTier)
  ) {
    return false;
  }
  return true;
}

/**
 * Wrap the single Fireworks provider so a specific candidate step calls it with
 * a pinned model tier. The wrapper injects `fireworksModelTier` into the
 * request just before delegating — the same base instance can therefore appear
 * multiple times in one order with different resolved models.
 */
function wrapFireworksStep(provider: LlmProvider, fireworksTier: FireworksModelTier): LlmProvider {
  return {
    ...provider,
    generate: (request, signal) => provider.generate({ ...request, fireworksModelTier: fireworksTier }, signal),
  };
}

export function orderedProviders(
  providers: LlmProvider[],
  request: SceneGenerationRequest,
): LlmProvider[] {
  const order = providerOrder(request);
  const ordered: LlmProvider[] = [];

  for (const candidate of order) {
    const provider = providers.find((p) => p.name === candidate.name);
    if (!provider) continue;
    if (!providerEligible(provider, request, candidate.fireworksTier)) continue;
    ordered.push(
      candidate.name === "fireworks" && candidate.fireworksTier
        ? wrapFireworksStep(provider, candidate.fireworksTier)
        : provider,
    );
  }

  return ordered;
}

export function chooseProvider(
  providers: LlmProvider[],
  request: SceneGenerationRequest,
): LlmProvider {
  const candidates = orderedProviders(providers, request);
  const first = candidates[0];
  if (first) return first;

  const deterministic = providers.find((provider) => provider.name === "deterministic");
  if (!deterministic) throw new Error("deterministic_provider_missing");
  return deterministic;
}
