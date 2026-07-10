import { applyChoiceAndEnterNode, resolveTerminal, type EngineEvent } from "@cyoa/engine";
import type { ContentPolicyContext } from "@cyoa/shared";

import { applySaveState, projectCurrentScene, type SaveRecord } from "./saves";
import { LlmRouter } from "./llm/router";
import type { SceneGenerationRequest } from "./llm/types";
import { AppError } from "./lib/errors";
import type { DailyTurnCounter } from "./ratelimit";
import { consumeTurn } from "./ratelimit";
import type { Story } from "@cyoa/engine";

export type TurnRequest = {
  save: SaveRecord;
  story: Story;
  choiceId: string;
  requestId: string;
  accountId: string;
  now: number;
  dailyCounter: DailyTurnCounter | null;
  dailyAllowance: number | "unlimited";
  dayKey: string;
  resetAt: number;
  router?: LlmRouter;
  /**
   * Resolved content-policy context (mature opt-in + entitlement tier) for the
   * scene request. Falls back to a safe free-tier context when omitted so
   * legacy callers and tests keep compiling without explicit wiring.
   */
  contentContext?: ContentPolicyContext;
  /**
   * Compact memory beats threaded into the LLM prompt. The narrator uses these
   * for continuity; when omitted the request goes out with no memory window.
   */
  memory?: string[];
  /** Mature-aware entitlement tier carried through to the router/provider policy. */
  entitlementTier?: "free" | "unlimited" | "pro";
};

export type TurnHistoryRecord = {
  saveId?: string;
  accountId: string;
  requestId: string;
  turnNumber: number;
  fromNodeId: string;
  choiceId: string;
  engineDiffs: unknown[];
  engineEvents: EngineEvent[];
  provider: string;
  tokenUsage?: { input: number; output: number };
  latency: { engineMs: number; llmMs: number };
  createdAt: number;
};

export type TurnResult = {
  save: SaveRecord;
  dailyCounter: DailyTurnCounter;
  history: TurnHistoryRecord;
  scene: ReturnType<typeof projectCurrentScene>;
  prose: string;
  provider: string;
};

export function assertTurnRequestId(requestId: string): void {
  if (requestId.trim().length < 8) throw new AppError("request_id_required");
}

export async function submitTurn(input: TurnRequest): Promise<TurnResult> {
  assertTurnRequestId(input.requestId);
  if (input.save.accountId !== input.accountId) throw new AppError("save_forbidden");
  if (input.save.activeTurnRequestId && input.save.activeTurnRequestId !== input.requestId) {
    throw new AppError("turn_in_progress");
  }

  const dailyCounter = consumeTurn({
    counter: input.dailyCounter,
    accountId: input.accountId,
    dayKey: input.dayKey,
    now: input.now,
    resetAt: input.resetAt,
    allowance: input.dailyAllowance,
  });

  // Wall-clock timing. `input.now` is a single static timestamp used for the
  // persisted createdAt/updatedAt; it cannot measure elapsed time. Read the
  // clock directly around the engine step and the (awaited, network-bound)
  // LLM call so turn_history.latency reflects real provider latency instead
  // of a constant 0 that blinds the cost/latency dashboards.
  const engineStarted = Date.now();
  const applied = applyChoiceAndEnterNode(input.save.state, input.story, input.choiceId, {
    now: input.now,
    rngSeed: input.requestId,
  });
  const engineMs = Math.max(0, Date.now() - engineStarted);
  const nextSave = applySaveState(input.save, applied.state, input.now);
  const terminal = resolveTerminal(applied.state, input.story);

  let prose = "";
  let provider = "deterministic";
  let tokenUsage: { input: number; output: number } | undefined;
  let llmMs = 0;
  const router = input.router ?? new LlmRouter();

  if (!terminal && applied.state.vitality > 0) {
    const node = input.story.nodes[applied.state.currentNodeId];
    if (!node) throw new AppError("node_not_found");
    const contentContext: ContentPolicyContext = input.contentContext ?? {
      surface: "generation",
      entitlementTier: "free",
      matureContentEnabled: false,
    };
    const entitlementTier = input.entitlementTier ?? contentContext.entitlementTier ?? "free";
    const generationRequest: SceneGenerationRequest = {
      saveId: input.save._id ?? "pending",
      storyId: input.story.id,
      nodeId: node.id,
      seed: node.seed ?? "",
      memory: input.memory ?? [],
      choices: node.choices.map((choice) => ({ choiceId: choice.id, label: choice.label })),
      sceneLength: node.sceneLength ?? input.story.defaultSceneLength ?? "standard",
      contentContext,
      risk: "normal",
      entitlementTier,
      retryCount: 0,
    };
    const llmStarted = Date.now();
    const generated = await router.generateScene(generationRequest);
    llmMs = Math.max(0, Date.now() - llmStarted);
    prose = generated.parsed.prose;
    provider = generated.generation.provider;
    tokenUsage = generated.generation.tokenUsage;
  }

  return {
    save: nextSave,
    dailyCounter,
    scene: projectCurrentScene(nextSave, input.story),
    prose,
    provider,
    history: {
      ...(input.save._id === undefined ? {} : { saveId: input.save._id }),
      accountId: input.accountId,
      requestId: input.requestId,
      turnNumber: nextSave.turnNumber,
      fromNodeId: input.save.currentNodeId,
      choiceId: input.choiceId,
      engineDiffs: applied.diffs,
      engineEvents: applied.events,
      provider,
      ...(tokenUsage === undefined ? {} : { tokenUsage }),
      latency: { engineMs, llmMs },
      createdAt: input.now,
    },
  };
}
