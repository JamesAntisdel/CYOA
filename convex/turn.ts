import { applyChoiceAndEnterNode, resolveTerminal, type EngineEvent } from "@cyoa/engine";

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

  const engineStarted = input.now;
  const applied = applyChoiceAndEnterNode(input.save.state, input.story, input.choiceId, {
    now: input.now,
    rngSeed: input.requestId,
  });
  const nextSave = applySaveState(input.save, applied.state, input.now);
  const terminal = resolveTerminal(applied.state, input.story);

  let prose = "";
  let provider = "deterministic";
  let tokenUsage: { input: number; output: number } | undefined;
  const router = input.router ?? new LlmRouter();

  if (!terminal && applied.state.vitality > 0) {
    const node = input.story.nodes[applied.state.currentNodeId];
    if (!node) throw new AppError("node_not_found");
    const generationRequest: SceneGenerationRequest = {
      saveId: input.save._id ?? "pending",
      storyId: input.story.id,
      nodeId: node.id,
      seed: node.seed ?? "",
      memory: [],
      choices: node.choices.map((choice) => ({ choiceId: choice.id, label: choice.label })),
      contentContext: {
        surface: "generation",
        entitlementTier: "free",
        matureContentEnabled: false,
      },
      risk: "normal",
      entitlementTier: "free",
      retryCount: 0,
    };
    const generated = await router.generateScene(generationRequest);
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
      latency: { engineMs: 0, llmMs: Math.max(0, input.now - engineStarted) },
      createdAt: input.now,
    },
  };
}
