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
  /**
   * Inventory carries `description` end-to-end so the LLM that emitted an
   * `inventory_add` last turn can read back WHERE the item is right now
   * (e.g. "hidden in The Count of Monte Cristo on the nightstand"). Without
   * the description in the prompt snapshot, the model only sees the bare
   * label and forgets that the ticket isn't in the protagonist's hand.
   */
  inventory: Array<{ id: string; label: string; description?: string }>;
  flags: Record<string, boolean | number | string>;
};

/**
 * Compact NPC sheet projected onto the scene prompt (Requirement 31.3). The
 * Convex request builder fills this from `buildNpcSheets`; absent or empty
 * means "no NPCs in scope this turn" and the prompt skips the section
 * entirely. Hidden NPC attributes and flags are filtered upstream.
 */
export type NpcSheetSnapshot = {
  name: string;
  role: string;
  vibe: string;
  knownFacts: string[];
  attributes: Array<{ label: string; value: number }>;
};

export type SceneGenerationRequest = {
  saveId: string;
  storyId: string;
  storyTitle?: string;
  storyTone?: string;
  premise?: string;
  /**
   * The turn number of the scene being generated (1-indexed). Used by the
   * pacing-rule branch in the prompt: early turns (1-2) establish the world
   * with sensory texture; mid turns (3-5) develop relationships and
   * complications without re-introducing what the reader already knows;
   * late turns (6+) accelerate toward consequences and endings. Without
   * this the LLM had to infer turn count from memory length and always
   * defaulted to "establish the world" mode, producing a repetitive
   * "here is the setting again" opener every scene.
   */
  turnNumber?: number;
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
  /**
   * Compact sheets for the NPCs in scope this turn (Requirement 31.3). Capped
   * at 5 entries by the request builder. Omit / leave empty when no NPCs are
   * in scope — the prompt skips the section entirely to keep the prompt tight.
   */
  npcSheets?: NpcSheetSnapshot[];
  /**
   * Running "story so far" summary maintained by `convex/llm/summarizer.ts`
   * after each successful turn. Capped at ~500 chars. When present, the
   * prompt-builder surfaces it above the memory window as canonical context
   * so the LLM stops re-proposing actions the reader already took. Absent on
   * the opening turn (nothing to summarise yet) and on saves predating the
   * summarizer.
   */
  storySummary?: string;
};

export const sceneGenerationRequestSchema = z.object({
  saveId: z.string().min(1),
  storyId: z.string().min(1),
  storyTitle: z.string().optional(),
  storyTone: z.string().optional(),
  premise: z.string().optional(),
  turnNumber: z.number().int().nonnegative().optional(),
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
  npcSheets: z
    .array(
      z.object({
        name: z.string(),
        role: z.string(),
        vibe: z.string(),
        knownFacts: z.array(z.string()),
        attributes: z.array(z.object({ label: z.string(), value: z.number() })),
      }),
    )
    .optional(),
  storySummary: z.string().optional(),
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
  /**
   * Out-of-band sentinel that the deterministic provider sets to `true` when
   * it serves a scene because every real provider failed (or none was
   * eligible). The router preserves this flag through `RouterResult` and the
   * SSE handler forwards it to `completeSceneStream` so the scene record can
   * be marked `isFallback: true`. The reader UI then renders the
   * FallbackTurnPanel ("the page is blank for a moment — try again") instead
   * of the deterministic placeholder prose + choices, which would otherwise
   * look like a real LLM scene to the reader.
   *
   * Carrying the flag here (rather than inside the JSON payload itself)
   * keeps the engine's Zod scene schema unchanged — the schema would
   * otherwise strip / reject an unknown field on the proposal.
   *
   * Absent on every real provider's generation. Treat absent as `false`.
   */
  isFallback?: boolean;
};

export type LlmProvider = {
  name: ProviderName;
  role: ProviderRole;
  /**
   * Optional `signal` plumbs the SSE client's AbortController through the
   * router into the provider's `fetch`. When the browser disconnects the
   * `cancel(reason)` handler on the ReadableStream (see `http.ts`) fires
   * `abortController.abort()`, which propagates through the signal and
   * aborts the in-flight provider HTTP request — releasing inference
   * budget instead of letting the call run to its own timeout.
   */
  generate(request: SceneGenerationRequest, signal?: AbortSignal): Promise<ProviderGeneration>;
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
