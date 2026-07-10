import type { ContentPolicyContext, ContentPolicySummary } from "@cyoa/shared";

import type { AccountRecord } from "./account";
import { evaluateTextPolicy } from "./contentPolicy";
import { AppError } from "./lib/errors";
import type { SaveRecord } from "./saves";
import type { TurnHistoryRecord } from "./turn";

export type TalePrivacy = "public" | "unlisted" | "friends";
export type TaleForkPolicy = "any_decision" | "ending_only" | "disabled";

export type TaleTurnSnapshot = {
  sourceTurnId: string;
  turnNumber: number;
  fromNodeId: string;
  choiceId: string;
  prose: string;
  choices: Array<{ choiceId: string; label: string }>;
  engineDiffs: unknown[];
  engineEvents: unknown[];
  stateAfter: unknown;
  createdAt: number;
  /**
   * Minimal source-scene fields needed to mirror a fork's starting scene
   * WITHOUT re-reading the live `scenes` row (which rewind/purge may have
   * deleted). Persisted with the snapshot so a published tale is fully
   * source-independent for both read and fork.
   */
  sceneMirror?: {
    choiceViews?: unknown[];
    safety?: unknown;
    provider?: string;
    proposal?: unknown;
  };
};

export type PublishedTaleRecord = {
  _id?: string;
  ownerAccountId: string;
  sourceSaveId: string;
  storyId: string;
  title: string;
  synopsis: string;
  privacy: TalePrivacy;
  accessRevokedAt?: number;
  forkPolicy: TaleForkPolicy;
  isMature: boolean;
  safetySummary: ContentPolicySummary;
  snapshotTurnIds: string[];
  snapshotTurns: TaleTurnSnapshot[];
  createdAt: number;
  updatedAt: number;
};

export type TaleReadProjection = {
  taleId?: string;
  title: string;
  synopsis: string;
  storyId: string;
  privacy: TalePrivacy;
  forkPolicy: TaleForkPolicy;
  turns: TaleTurnSnapshot[];
  readOnly: true;
  revoked: boolean;
};

export type ForkPlan = {
  taleId?: string;
  sourceTurnId: string;
  accountId: string;
  storyId: string;
  startingState: unknown;
  path: string[];
  safetySummary: ContentPolicySummary;
  attributionEvent: TaleAttributionEvent;
};

export type TaleAttributionEvent = {
  eventName: "tale.published" | "tale.read" | "tale.forked" | "creator.play_time";
  taleId?: string;
  accountId?: string;
  storyId?: string;
  payload: Record<string, unknown>;
  redacted: boolean;
  createdAt: number;
};

export function publishTaleSnapshot(input: {
  owner: AccountRecord & { _id: string };
  entitlement: { tier: "free" | "unlimited" | "pro"; status: string } | null | undefined;
  save: SaveRecord & { _id: string };
  title: string;
  synopsis: string;
  privacy: TalePrivacy;
  forkPolicy: TaleForkPolicy;
  turns: TaleTurnSnapshot[];
  now: number;
}): PublishedTaleRecord {
  if (input.save.accountId !== input.owner._id) throw new AppError("save_forbidden");
  if (input.turns.length === 0) throw new AppError("tale_snapshot_empty");

  const safetySummary = evaluateTalePolicy({
    text: `${input.title}\n${input.synopsis}\n${input.turns.map((turn) => turn.prose).join("\n")}`,
    account: input.owner,
    entitlement: input.entitlement,
    surface: "publishing",
  });
  if (safetySummary.action === "block") throw new AppError("content_blocked");

  return {
    ownerAccountId: input.owner._id,
    sourceSaveId: input.save._id,
    storyId: input.save.storyId,
    title: input.title.trim(),
    synopsis: input.synopsis.trim(),
    privacy: input.privacy,
    forkPolicy: input.forkPolicy,
    isMature: safetySummary.matureCategories.length > 0,
    safetySummary,
    snapshotTurnIds: input.turns.map((turn) => turn.sourceTurnId),
    snapshotTurns: input.turns.map(cloneTurnSnapshot),
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function updateTaleMetadata(
  tale: PublishedTaleRecord,
  input: {
    title?: string;
    synopsis?: string;
    privacy?: TalePrivacy;
    forkPolicy?: TaleForkPolicy;
    now: number;
  },
): PublishedTaleRecord {
  return {
    ...tale,
    ...(input.title === undefined ? {} : { title: input.title.trim() }),
    ...(input.synopsis === undefined ? {} : { synopsis: input.synopsis.trim() }),
    ...(input.privacy === undefined ? {} : { privacy: input.privacy }),
    ...(input.forkPolicy === undefined ? {} : { forkPolicy: input.forkPolicy }),
    snapshotTurnIds: [...tale.snapshotTurnIds],
    snapshotTurns: tale.snapshotTurns.map(cloneTurnSnapshot),
    updatedAt: input.now,
  };
}

export function revokeTale(tale: PublishedTaleRecord, now: number): PublishedTaleRecord {
  return { ...tale, accessRevokedAt: now, updatedAt: now };
}

export function projectReadAlong(input: {
  tale: PublishedTaleRecord;
  viewerAccountId?: string;
  friendAccountIds?: string[];
  now: number;
}): TaleReadProjection {
  assertCanReadTale(input);
  return {
    ...(input.tale._id === undefined ? {} : { taleId: input.tale._id }),
    title: input.tale.title,
    synopsis: input.tale.synopsis,
    storyId: input.tale.storyId,
    privacy: input.tale.privacy,
    forkPolicy: input.tale.forkPolicy,
    turns: input.tale.snapshotTurns.map(cloneTurnSnapshot),
    readOnly: true,
    revoked: false,
  };
}

export function buildForkPlan(input: {
  tale: PublishedTaleRecord;
  sourceTurnId: string;
  account: AccountRecord & { _id: string };
  entitlement: { tier: "free" | "unlimited" | "pro"; status: string } | null | undefined;
  now: number;
}): ForkPlan {
  if (input.tale.accessRevokedAt !== undefined) throw new AppError("tale_revoked");
  if (input.tale.forkPolicy === "disabled") throw new AppError("forking_disabled");

  const source = input.tale.snapshotTurns.find((turn) => turn.sourceTurnId === input.sourceTurnId);
  if (!source) throw new AppError("fork_source_not_found");
  const terminal = source.engineEvents.some(
    (event) => typeof event === "object" && event !== null && "kind" in event && event.kind === "ending_unlocked",
  );
  if (input.tale.forkPolicy === "ending_only" && !terminal) throw new AppError("fork_requires_ending");

  const safetySummary = evaluateTalePolicy({
    text: source.prose,
    account: input.account,
    entitlement: input.entitlement,
    surface: "forking",
  });
  if (safetySummary.action === "block") throw new AppError("content_blocked");

  return {
    ...(input.tale._id === undefined ? {} : { taleId: input.tale._id }),
    sourceTurnId: input.sourceTurnId,
    accountId: input.account._id,
    storyId: input.tale.storyId,
    startingState: cloneJson(source.stateAfter),
    path: input.tale.snapshotTurns
      .filter((turn) => turn.turnNumber <= source.turnNumber)
      .map((turn) => turn.fromNodeId),
    safetySummary,
    attributionEvent: buildTaleAttributionEvent({
      eventName: "tale.forked",
      tale: input.tale,
      accountId: input.account._id,
      now: input.now,
      payload: { sourceTurnId: input.sourceTurnId },
    }),
  };
}

export function snapshotTurn(input: {
  sourceTurnId: string;
  history: TurnHistoryRecord;
  prose: string;
  choices: Array<{ choiceId: string; label: string }>;
  stateAfter: unknown;
  sceneMirror?: TaleTurnSnapshot["sceneMirror"];
}): TaleTurnSnapshot {
  return {
    sourceTurnId: input.sourceTurnId,
    turnNumber: input.history.turnNumber,
    fromNodeId: input.history.fromNodeId,
    choiceId: input.history.choiceId,
    prose: input.prose,
    choices: input.choices.map((choice) => ({ ...choice })),
    engineDiffs: cloneJson(input.history.engineDiffs),
    engineEvents: cloneJson(input.history.engineEvents),
    stateAfter: cloneJson(input.stateAfter),
    createdAt: input.history.createdAt,
    ...(input.sceneMirror ? { sceneMirror: cloneJson(input.sceneMirror) } : {}),
  };
}

export function buildTaleAttributionEvent(input: {
  eventName: TaleAttributionEvent["eventName"];
  tale: PublishedTaleRecord;
  accountId?: string;
  now: number;
  payload?: Record<string, unknown>;
}): TaleAttributionEvent {
  return {
    eventName: input.eventName,
    ...(input.tale._id === undefined ? {} : { taleId: input.tale._id }),
    ...(input.accountId === undefined ? {} : { accountId: input.accountId }),
    storyId: input.tale.storyId,
    payload: input.payload ?? {},
    redacted: true,
    createdAt: input.now,
  };
}

export function assertCanReadTale(input: {
  tale: PublishedTaleRecord;
  viewerAccountId?: string;
  friendAccountIds?: string[];
}): void {
  if (input.tale.accessRevokedAt !== undefined) throw new AppError("tale_revoked");
  if (input.tale.privacy === "public" || input.tale.privacy === "unlisted") return;
  if (input.viewerAccountId === input.tale.ownerAccountId) return;
  if (input.viewerAccountId && input.friendAccountIds?.includes(input.viewerAccountId)) return;
  throw new AppError("tale_forbidden");
}

function evaluateTalePolicy(input: {
  text: string;
  account: AccountRecord & { _id: string };
  entitlement: { tier: "free" | "unlimited" | "pro"; status: string } | null | undefined;
  surface: ContentPolicyContext["surface"];
}): ContentPolicySummary {
  return evaluateTextPolicy({
    text: input.text,
    context: {
      accountId: input.account._id,
      ageBand: input.account.ageBand,
      entitlementTier: input.entitlement?.tier ?? "free",
      matureContentEnabled:
        input.account.matureContentEnabled &&
        input.account.kind === "user" &&
        input.account.ageBand === "18+" &&
        input.entitlement?.status === "active" &&
        (input.entitlement.tier === "unlimited" || input.entitlement.tier === "pro"),
      surface: input.surface,
    },
  });
}

function cloneTurnSnapshot(turn: TaleTurnSnapshot): TaleTurnSnapshot {
  return {
    ...turn,
    choices: turn.choices.map((choice) => ({ ...choice })),
    engineDiffs: cloneJson(turn.engineDiffs),
    engineEvents: cloneJson(turn.engineEvents),
    stateAfter: cloneJson(turn.stateAfter),
    ...(turn.sceneMirror ? { sceneMirror: cloneJson(turn.sceneMirror) } : {}),
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
