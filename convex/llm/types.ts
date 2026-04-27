import type { ContentPolicyContext } from "@cyoa/shared";

export type ProviderName = "anthropic" | "vertex" | "deepseek" | "deterministic";

export type ProviderRole = "quality" | "fallback" | "cost" | "deterministic";

export type ProviderHealth = {
  provider: ProviderName;
  available: boolean;
  latencyMs?: number;
  degradedReason?: string;
};

export type SceneGenerationRequest = {
  saveId: string;
  storyId: string;
  nodeId: string;
  seed: string;
  memory: string[];
  choices: Array<{ choiceId: string; label: string }>;
  contentContext: ContentPolicyContext;
  risk: "low" | "normal" | "sensitive";
  entitlementTier: "free" | "unlimited" | "pro";
  retryCount: number;
};

export type TokenChunk = {
  provider: ProviderName;
  text: string;
  index: number;
};

export type ProviderGeneration = {
  provider: ProviderName;
  text: string;
  tokenUsage: {
    input: number;
    output: number;
  };
};

export type LlmProvider = {
  name: ProviderName;
  role: ProviderRole;
  generate(request: SceneGenerationRequest): Promise<ProviderGeneration>;
  health(): ProviderHealth;
};

export type ParsedScene = {
  prose: string;
  choiceMetadata: Array<{ choiceId: string; tone?: string | undefined; label?: string | undefined }>;
};
