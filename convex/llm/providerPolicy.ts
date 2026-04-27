import type { LlmProvider, ProviderName, SceneGenerationRequest } from "./types";

export function providerEligible(
  provider: LlmProvider,
  request: SceneGenerationRequest,
): boolean {
  const health = provider.health();
  if (!health.available) return false;
  if (provider.name === "deepseek") {
    return request.risk === "low" && request.contentContext.matureContentEnabled === false;
  }
  if (provider.name === "deterministic") return true;
  return true;
}

export function chooseProvider(
  providers: LlmProvider[],
  request: SceneGenerationRequest,
): LlmProvider {
  const preferredOrder: ProviderName[] =
    request.risk === "low"
      ? ["deepseek", "anthropic", "vertex", "deterministic"]
      : ["anthropic", "vertex", "deterministic"];

  for (const name of preferredOrder) {
    const provider = providers.find((candidate) => candidate.name === name);
    if (provider && providerEligible(provider, request)) return provider;
  }

  const deterministic = providers.find((provider) => provider.name === "deterministic");
  if (!deterministic) throw new Error("deterministic_provider_missing");
  return deterministic;
}
