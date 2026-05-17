import { z } from "zod";

import { resolveDeath } from "./death";
import { unlockCurrentEnding } from "./endings";
import { setFlag, unsetFlag } from "./flags";
import { addItem, removeItem } from "./inventory";
import { cloneState } from "./state";
import { applyStatDelta } from "./stats";
import type {
  EngineContext,
  EngineDiff,
  EngineEvent,
  EngineResult,
  PlayerState,
  Story,
} from "./types";

// =============================================================================
// LLM scene contract: the LLM proposes prose + 2-4 choices + effects + an
// optional terminal marker. The engine is the deterministic validator. We
// clamp numeric deltas and reject shape violations rather than mutating the
// game state with whatever the model returns.
// =============================================================================

const STAT_DELTA_BOUND = 10;
const CURRENCY_DELTA_BOUND = 100;
const DELAYED_MAX_HORIZON = 12;
const MAX_EFFECTS_PER_CHOICE = 6;
const MAX_CHOICES = 4;
const MIN_CHOICES = 2;
const MAX_PROSE_CHARS = 12_000;

const itemSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(120),
  description: z.string().max(480).optional(),
});

// Effects the LLM may propose at the leaf — no nested delayed effects allowed
// from the model. The engine still supports authored delayed effects; the LLM
// surface is intentionally narrower because nested validation across an
// open-ended horizon is hard to reason about under untrusted input.
const leafEffectSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("stat"),
    statId: z.string().min(1).max(64),
    delta: z
      .number()
      .finite()
      .transform((value) => clampDelta(value, STAT_DELTA_BOUND)),
  }),
  z.object({
    kind: z.literal("currency"),
    delta: z
      .number()
      .finite()
      .transform((value) => clampDelta(value, CURRENCY_DELTA_BOUND)),
  }),
  z.object({ kind: z.literal("inventory_add"), item: itemSchema }),
  z.object({ kind: z.literal("inventory_remove"), itemId: z.string().min(1).max(64) }),
  z.object({
    kind: z.literal("flag_set"),
    flag: z.string().min(1).max(64),
    value: z.union([z.boolean(), z.number().finite(), z.string().max(240)]),
  }),
  z.object({ kind: z.literal("flag_unset"), flag: z.string().min(1).max(64) }),
]);

const delayedEffectSchema = z.object({
  kind: z.literal("delayed"),
  delayNodes: z.number().int().positive().max(DELAYED_MAX_HORIZON),
  effects: z.array(leafEffectSchema).max(MAX_EFFECTS_PER_CHOICE),
});

export const llmEffectSchema = z.union([leafEffectSchema, delayedEffectSchema]);

export const llmChoiceSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(240),
  tone: z.string().min(1).max(32).optional(),
  effects: z.array(llmEffectSchema).max(MAX_EFFECTS_PER_CHOICE).optional(),
});

export const llmTerminalSchema = z.object({
  kind: z.enum(["death", "success", "safe"]),
  endingId: z.string().min(1).max(64),
  label: z.string().min(1).max(160).optional(),
});

export const llmSceneOutputSchema = z
  .object({
    prose: z.string().min(1).max(MAX_PROSE_CHARS),
    choices: z.array(llmChoiceSchema).min(MIN_CHOICES).max(MAX_CHOICES),
    terminal: llmTerminalSchema.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    value.choices.forEach((choice, index) => {
      if (ids.has(choice.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["choices", index, "id"],
          message: `duplicate_choice_id:${choice.id}`,
        });
      }
      ids.add(choice.id);
    });
  });

export type LlmEffect = z.infer<typeof llmEffectSchema>;
export type LlmChoiceProposal = z.infer<typeof llmChoiceSchema>;
export type LlmTerminalProposal = z.infer<typeof llmTerminalSchema>;
export type LlmSceneProposal = z.infer<typeof llmSceneOutputSchema>;

export type LlmSceneApplyResult = EngineResult & {
  proposal: LlmSceneProposal;
  terminal: LlmTerminalProposal | null;
  /**
   * The choice the player just took (its effects were already applied).
   * Null when entering the opening scene of an LLM-driven story.
   */
  appliedChoiceId: string | null;
};

/**
 * Parse a raw LLM payload (either a JSON string or already-parsed value) into
 * a validated scene proposal. Throws when the shape is invalid; clamps deltas
 * to engine-safe ranges.
 */
export function parseLlmSceneProposal(input: unknown): LlmSceneProposal {
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed.startsWith("{")) throw new Error("llm_scene_not_json");
    try {
      return llmSceneOutputSchema.parse(JSON.parse(trimmed));
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error("llm_scene_invalid_json");
      throw error;
    }
  }
  return llmSceneOutputSchema.parse(input);
}

/**
 * Phase A of the llm-driven turn: apply the effects of the choice the player
 * just took (validated against the prior proposal) and stamp a synthetic node
 * id for the new scene. Returns the next state cursor that the LLM will write
 * prose against. Does not require — and does not validate — the next
 * proposal, which is still being generated when this runs.
 *
 * For the opening scene of an llm-driven story, pass `priorProposal: null`
 * and `choiceId: null`; nothing is applied and the cursor moves to
 * `<storyId>:llm:0`.
 */
export function advanceLlmTurnCursor(input: {
  state: PlayerState;
  story: Story;
  priorProposal: LlmSceneProposal | null;
  choiceId: string | null;
  ctx: EngineContext;
}): EngineResult & { appliedChoiceId: string | null; nodeId: string } {
  const { state, story, priorProposal, choiceId, ctx } = input;
  void ctx; // engine context is reserved for future-deterministic plumbing
  const next = cloneState(state);
  const diffs: EngineDiff[] = [];
  const events: EngineEvent[] = [];
  let appliedChoiceId: string | null = null;

  if (priorProposal && choiceId) {
    const choice = priorProposal.choices.find((candidate) => candidate.id === choiceId);
    if (!choice) throw new Error(`llm_choice_not_found:${choiceId}`);
    applyEffects(next, choice.effects ?? [], diffs);
    events.push({ kind: "choice_applied", choiceId });
    appliedChoiceId = choiceId;
    next.turnNumber += 1;
  }

  const llmNodeId = `${story.id}:llm:${next.turnNumber}`;
  next.currentNodeId = llmNodeId;
  next.path.push(llmNodeId);
  diffs.push({ kind: "node", target: llmNodeId, delta: 1 });
  events.push({ kind: "node_entered", nodeId: llmNodeId });

  // Death-by-vitality always wins. Authored deathNodeId still kicks in if a
  // designer ever mixes modes (training-room style + llm-driven seed).
  if (story.deathNodeId) {
    resolveDeath(next, story, diffs, events);
  }

  return { state: next, diffs, events, appliedChoiceId, nodeId: llmNodeId };
}

/**
 * Phase B of the llm-driven turn: validate the freshly-generated proposal and
 * record any terminal it carries against the engine state.
 */
export function recordLlmProposalTerminal(input: {
  state: PlayerState;
  story: Story;
  proposal: LlmSceneProposal;
  ctx: EngineContext;
}): EngineResult & { terminal: LlmTerminalProposal | null } {
  const { state, story, proposal, ctx } = input;
  void ctx;
  const next = cloneState(state);
  const diffs: EngineDiff[] = [];
  const events: EngineEvent[] = [];
  let terminal: LlmTerminalProposal | null = proposal.terminal ?? null;

  if (next.vitality <= 0) {
    terminal = {
      kind: "death",
      endingId: terminal?.endingId ?? "ending-death",
      label: terminal?.label ?? "Vitality fails.",
    };
  }

  if (terminal) {
    const endingId = terminal.endingId;
    if (!next.endingsUnlocked[endingId]) {
      next.endingsUnlocked[endingId] = {
        storyId: story.id,
        endingId,
        firstSeenTurn: next.turnNumber,
        mode: next.mode,
        path: [...next.path],
      };
      diffs.push({ kind: "ending", target: endingId, delta: 1 });
      events.push({ kind: "ending_unlocked", endingId });
    }
    if (terminal.kind === "death") {
      events.push({ kind: "death_triggered", nodeId: next.currentNodeId });
    }
  }

  unlockCurrentEnding(next, story, diffs, events);
  return { state: next, diffs, events, terminal };
}

/**
 * Convenience: phase A + phase B combined into one call. Used by the
 * non-streaming `submitChoice` path and by tests, where the full proposal is
 * available up front.
 */
export function applyLlmSceneToState(input: {
  state: PlayerState;
  story: Story;
  priorProposal: LlmSceneProposal | null;
  choiceId: string | null;
  nextProposal: LlmSceneProposal;
  ctx: EngineContext;
}): LlmSceneApplyResult {
  const phaseA = advanceLlmTurnCursor({
    state: input.state,
    story: input.story,
    priorProposal: input.priorProposal,
    choiceId: input.choiceId,
    ctx: input.ctx,
  });
  const phaseB = recordLlmProposalTerminal({
    state: phaseA.state,
    story: input.story,
    proposal: input.nextProposal,
    ctx: input.ctx,
  });

  return {
    state: phaseB.state,
    diffs: [...phaseA.diffs, ...phaseB.diffs],
    events: [...phaseA.events, ...phaseB.events],
    proposal: input.nextProposal,
    terminal: phaseB.terminal,
    appliedChoiceId: phaseA.appliedChoiceId,
  };
}

function applyEffects(state: PlayerState, effects: LlmEffect[], diffs: EngineDiff[]): void {
  for (const effect of effects) applyEffect(state, effect, diffs);
}

function applyEffect(state: PlayerState, effect: LlmEffect, diffs: EngineDiff[]): void {
  switch (effect.kind) {
    case "stat":
      applyStatDelta(state, effect.statId, effect.delta, diffs);
      return;
    case "currency": {
      const before = state.currency;
      state.currency = Math.max(0, before + effect.delta);
      diffs.push({
        kind: "currency",
        target: "currency",
        delta: effect.delta,
        before,
        after: state.currency,
      });
      return;
    }
    case "inventory_add": {
      // Strip undefined description so exactOptionalPropertyTypes is happy
      // when downstream callers rely on the InventoryItem narrowed shape.
      const item: { id: string; label: string; description?: string } = {
        id: effect.item.id,
        label: effect.item.label,
        ...(effect.item.description !== undefined ? { description: effect.item.description } : {}),
      };
      addItem(state, item, diffs);
      return;
    }
    case "inventory_remove":
      removeItem(state, effect.itemId, diffs);
      return;
    case "flag_set":
      setFlag(state, effect.flag, effect.value, diffs);
      return;
    case "flag_unset":
      unsetFlag(state, effect.flag, diffs);
      return;
    case "delayed":
      // The LLM-driven flow doesn't support delayed effects yet — the engine's
      // delayed machinery is built around authored node-count horizons that
      // don't translate cleanly to free-form scenes. Validate the shape and
      // drop the effect rather than risk applying it at the wrong horizon.
      return;
  }
}

function clampDelta(value: number, bound: number): number {
  if (!Number.isFinite(value)) return 0;
  const integer = Math.trunc(value);
  if (integer > bound) return bound;
  if (integer < -bound) return -bound;
  return integer;
}
