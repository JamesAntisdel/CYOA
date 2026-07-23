import type { ContentPolicyContext } from "@cyoa/shared";
import { contentPolicyContextSchema } from "@cyoa/shared";
import type { BibleDigest, LlmSceneProposal } from "@cyoa/engine";
import { z } from "zod";

export type ProviderName = "anthropic" | "vertex" | "deepseek" | "fireworks" | "deterministic";

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
  inventory: Array<{ id: string; label: string; description?: string; tags?: string[] }>;
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

/**
 * Story-arc "pursuit" context threaded onto the scene prompt (Requirements
 * R1.3, R6.1). The Convex request builder fills this from `state.arc` (the
 * arc created on turn 1 — see `convex/game.ts`); the prompt-builder renders it
 * as the `== YOUR PURSUIT ==` section ABOVE the memory window so the spine
 * outranks variety. Absent on legacy (arc-less) saves — the prompt then skips
 * the whole section and behaves exactly as before (BC9).
 *
 * Spoiler discipline (BC10): the candidate-ending labels appear ONLY in the
 * ENDINGS output rule; the single steer-toward beat label appears ONLY in the
 * steer line. Neither reaches the reader (the projection strips them) — this is
 * the LLM's private planning surface.
 */
export type PursuitPromptContext = {
  dramaticQuestion: string;
  protagonistWant: string;
  stakes: string;
  act: number;
  /** Labels of beats already fired (safe to name — the reader lived them). */
  firedBeatLabels: string[];
  /** The single beat to steer toward this scene, or null when none pending. */
  targetBeatLabel: string | null;
  /** Id the model must set on `beatFired` when it lands the target beat. */
  targetBeatId: string | null;
  /** Candidate endings the final scene must choose from (R2.4). */
  candidateEndings: Array<{ id: string; label: string }>;
  /**
   * One-shot directive from the terminal gate (R2), consumed + cleared by the
   * prompt build that surfaces it. `surface_beat` → the story tried to end
   * early; `narrate_costly_survival` → an early death was converted to a
   * severe setback.
   */
  directive?: "surface_beat" | "narrate_costly_survival";
  /** Beat label to put on stage when `directive === "surface_beat"`. */
  surfaceBeatLabel?: string;
  /**
   * Foreshadow notes of delayed threads that fired on the just-completed turn
   * (R3.3) — the next scene must narrate the callback. Empty when none fired.
   */
  threadFires: string[];
  /**
   * The doom clock (R9, W2). Present on arc saves that have seeded a clock; the
   * prompt renders escalation copy keyed off `directive` (50%/75%/expired
   * bands, computed server-side by the engine's `clockDirective`). Absent on
   * legacy / arc-less / pre-clock saves — the escalation line is skipped.
   */
  clock?: {
    label: string;
    value: number;
    max: number;
    directive: "none" | "escalate_50" | "escalate_75" | "climax_now";
  };
};

/**
 * Resolved skill-check outcome (R7.2, W2) threaded onto the NEXT scene request
 * after the reader picks a checked choice. The engine resolves the check at
 * submission (`beginStreamingChoice`), applies the outcome-table engine effects
 * immediately, and stashes this so the prompt narrates a result it cannot
 * overrule. `note` is the success/fail flavor line the LLM authored on the
 * choice. Absent when the picked choice carried no check.
 */
export type CheckOutcomePromptContext = {
  outcome: "success" | "partial" | "fail";
  statId: string;
  margin: number;
  note?: string;
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
  /**
   * Entitlement tier used by the TIER-AWARE provider router (provider-and-credit
   * design §1.2). This is the PRIMARY routing key — `risk` is only a secondary
   * escalation hint. `guest`/`free` route to the cheap Fireworks workhorse and
   * NEVER to Anthropic/Vertex (cost); `unlimited` and `pro` climb to the mid /
   * premium Fireworks models and the quality providers. server-core populates it
   * at the game.ts call sites from the reader's resolved entitlement. Absent on
   * legacy saves / pre-tier requests — the policy defaults to `free` (the
   * cheapest, safest lane) so an old caller never accidentally lands on an
   * expensive provider (BC9).
   */
  tier?: "guest" | "free" | "unlimited" | "pro";
  /**
   * Internal routing hint set transiently by `providerPolicy.orderedProviders`
   * so the single Fireworks provider knows WHICH model tier to serve on this
   * candidate step (the order can try Fireworks twice — cheap then mid — as an
   * in-turn escalation ladder). Never set by server-core; the Fireworks provider
   * falls back to mapping `tier` when this is absent.
   */
  fireworksModelTier?: "cheap" | "mid" | "premium";
  retryCount: number;
  mode?: SceneGenerationMode;
  /**
   * Reading-modes R4 (novel mode). The save-level reading CONTRACT threaded onto
   * the scene request, exactly like `mode`. Absent ⇒ `"branching"` (every
   * legacy/branching save — deploy-skew safe both ways). When `"novel"` the
   * prompt-builder emits a prose+terminal-only linear shape (no branching
   * choices) and the parse gates select the additive `llmNovelSceneOutputSchema`
   * (which accepts 0/1 choices) instead of the branching `min(2)` schema. Only
   * set by the integrator's `getAuthorizedSceneStreamRequest` on llm-driven novel
   * saves (R4.7); authored/scripted/branching requests never carry it.
   */
  readingMode?: "branching" | "novel";
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
  /**
   * Story-arc pursuit context (R1.3 / R6.1). Present on arc saves; the
   * prompt-builder renders the `== YOUR PURSUIT ==` section from it. Absent on
   * legacy saves — the section is skipped entirely.
   */
  pursuit?: PursuitPromptContext;
  /**
   * True only on an arc save's OPENING turn (turn 1) when the arc has NOT yet
   * been authored — the prompt then carries the STORY ARC production block
   * instructing the model to emit a `storyArc` object (R1.1). Absent/false on
   * every later turn and on daily saves (arc is pre-injected).
   */
  produceArc?: boolean;
  /**
   * Resolved skill-check outcome for the choice the reader just picked (R7.2,
   * W2). Present only on the scene generated immediately after a checked choice
   * was submitted; the prompt renders a CHECK OUTCOME block ("the attempt
   * FAILED — narrate it; do not undo it"). Absent otherwise.
   */
  checkOutcome?: CheckOutcomePromptContext;
  /**
   * Story-bible digest (story-bible R3.1) built by the engine's
   * `buildBibleDigest` from the save's attached bible: due/promised registry
   * keys, planned doors, cast sheet, pending twists, OUTSTANDING KEYS lines.
   * Present only once the background bible call has landed AND attached
   * (turn ≥ 2); absent on legacy / bible-less / authored saves — the prompt
   * then renders byte-identical to today (R3.5/BC9). Spoiler discipline
   * (BC10): none of this ever reaches the reader; the prompt is the only
   * consumer.
   */
  storyBible?: BibleDigest;
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
  tier: z.enum(["guest", "free", "unlimited", "pro"]).optional(),
  fireworksModelTier: z.enum(["cheap", "mid", "premium"]).optional(),
  retryCount: z.number().int().min(0),
  mode: z.enum(["authored", "llm-driven"]).optional(),
  readingMode: z.enum(["branching", "novel"]).optional(),
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
  pursuit: z
    .object({
      dramaticQuestion: z.string(),
      protagonistWant: z.string(),
      stakes: z.string(),
      act: z.number(),
      firedBeatLabels: z.array(z.string()),
      targetBeatLabel: z.string().nullable(),
      targetBeatId: z.string().nullable(),
      candidateEndings: z.array(z.object({ id: z.string(), label: z.string() })),
      directive: z.enum(["surface_beat", "narrate_costly_survival"]).optional(),
      surfaceBeatLabel: z.string().optional(),
      threadFires: z.array(z.string()),
      clock: z
        .object({
          label: z.string(),
          value: z.number(),
          max: z.number(),
          directive: z.enum(["none", "escalate_50", "escalate_75", "climax_now"]),
        })
        .optional(),
    })
    .optional(),
  produceArc: z.boolean().optional(),
  checkOutcome: z
    .object({
      outcome: z.enum(["success", "partial", "fail"]),
      statId: z.string(),
      margin: z.number(),
      note: z.string().optional(),
    })
    .optional(),
  storyBible: z
    .object({
      keys: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          opensHint: z.string(),
          surfaceBand: z.enum(["early", "mid", "late"]),
          due: z.boolean(),
          promised: z.boolean(),
        }),
      ),
      doors: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          keyId: z.string(),
          gateBand: z.enum(["mid", "late"]),
          note: z.string(),
        }),
      ),
      cast: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          want: z.string(),
          secret: z.string(),
          bondHint: z.string(),
        }),
      ),
      twists: z.array(
        z.object({ id: z.string(), label: z.string(), precondition: z.string() }),
      ),
      outstanding: z.array(
        z.discriminatedUnion("state", [
          z.object({
            keyId: z.string(),
            label: z.string(),
            state: z.literal("promised"),
            promisedAtTurn: z.number(),
          }),
          z.object({
            keyId: z.string(),
            label: z.string(),
            state: z.literal("reoffer"),
            grantedAtTurn: z.number(),
          }),
        ]),
      ),
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
  /**
   * The concrete model id the provider actually resolved and called (e.g.
   * `accounts/fireworks/models/deepseek-v3`, `claude-sonnet-4-6`). Surfaced so
   * the turn path can price the generation via
   * `costCentsForUsage(modelId, tokenUsage)` (provider-and-credit design §1.3)
   * and write `estimatedCostCents` into the analytics turn payload. Absent on
   * generations from providers that predate cost telemetry — treat absent as
   * "unpriceable" (cost 0).
   */
  modelId?: string;
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
