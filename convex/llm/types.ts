import type { ContentPolicyContext } from "@cyoa/shared";
import { contentPolicyContextSchema } from "@cyoa/shared";
import type { LlmSceneProposal } from "@cyoa/engine";
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

/**
 * Generation mode:
 *  - "authored" — the player is at an authored node; the LLM only writes
 *    prose to layer over the already-defined choices/effects. Legacy shape.
 *  - "llm-driven" — the LLM proposes prose + choices + effects + an optional
 *    terminal marker as structured JSON. The engine validates and applies.
 */
export type SceneGenerationMode = "authored" | "llm-driven";

export type PlayerStateSnapshot = {
  vitality: number;
  currency: number;
  visibleStats: Array<{ statId: string; label: string; value: number }>;
  hiddenStats: Array<{ statId: string; value: number }>;
  inventory: Array<{ id: string; label: string }>;
  flags: Record<string, boolean | number | string>;
};

export type SceneGenerationRequest = {
  saveId: string;
  storyId: string;
  storyTitle?: string;
  storyTone?: string;
  premise?: string;
  nodeId: string;
  seed: string;
  memory: string[];
  choices: Array<{ choiceId: string; label: string }>;
  sceneLength: SceneLength;
  contentContext: ContentPolicyContext;
  risk: "low" | "normal" | "sensitive";
  entitlementTier: "free" | "unlimited" | "pro";
  retryCount: number;
  mode?: SceneGenerationMode;
  playerState?: PlayerStateSnapshot;
};

export const sceneGenerationRequestSchema = z.object({
  saveId: z.string().min(1),
  storyId: z.string().min(1),
  storyTitle: z.string().optional(),
  storyTone: z.string().optional(),
  premise: z.string().optional(),
  nodeId: z.string().min(1),
  seed: z.string(),
  memory: z.array(z.string()),
  choices: z.array(z.object({ choiceId: z.string().min(1), label: z.string().min(1) })),
  sceneLength: z.enum(["brief", "standard", "rich", "chapter"]).default("standard"),
  contentContext: contentPolicyContextSchema,
  risk: z.enum(["low", "normal", "sensitive"]),
  entitlementTier: z.enum(["free", "unlimited", "pro"]),
  retryCount: z.number().int().min(0),
  mode: z.enum(["authored", "llm-driven"]).optional(),
  playerState: z
    .object({
      vitality: z.number(),
      currency: z.number(),
      visibleStats: z.array(z.object({ statId: z.string(), label: z.string(), value: z.number() })),
      hiddenStats: z.array(z.object({ statId: z.string(), value: z.number() })),
      inventory: z.array(z.object({ id: z.string(), label: z.string() })),
      flags: z.record(z.union([z.boolean(), z.number(), z.string()])),
    })
    .optional(),
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
  /**
   * Set only when the LLM returned the structured llm-driven scene shape.
   * Authored-mode generations leave this undefined — their choices come from
   * the authored graph, not the model output.
   */
  proposal?: LlmSceneProposal;
};
