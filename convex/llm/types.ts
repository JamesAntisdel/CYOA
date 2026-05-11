import type { ContentPolicyContext } from "@cyoa/shared";
import { contentPolicyContextSchema } from "@cyoa/shared";
import { z } from "zod";

export type ProviderName = "anthropic" | "vertex" | "deepseek" | "deterministic";

export type ProviderRole = "quality" | "fallback" | "cost" | "deterministic";

export type SceneLength = "brief" | "standard" | "rich" | "chapter";

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
  sceneLength: SceneLength;
  contentContext: ContentPolicyContext;
  risk: "low" | "normal" | "sensitive";
  entitlementTier: "free" | "unlimited" | "pro";
  retryCount: number;
};

export const sceneGenerationRequestSchema = z.object({
  saveId: z.string().min(1),
  storyId: z.string().min(1),
  nodeId: z.string().min(1),
  seed: z.string(),
  memory: z.array(z.string()),
  choices: z.array(z.object({ choiceId: z.string().min(1), label: z.string().min(1) })),
  sceneLength: z.enum(["brief", "standard", "rich", "chapter"]).default("standard"),
  contentContext: contentPolicyContextSchema,
  risk: z.enum(["low", "normal", "sensitive"]),
  entitlementTier: z.enum(["free", "unlimited", "pro"]),
  retryCount: z.number().int().min(0),
});

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
