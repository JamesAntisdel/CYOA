import type { Story } from "@cyoa/engine";

import { createGuestAccountRecord, projectAccount, type AccountProjection, type AccountRecord, type AgeSelection } from "./account";
import { buildClaimGuestPlan, buildMatureContentUpdate } from "./account";
import { buildCheckoutSessionCreateParams, buildCheckoutSessionRequest, type CheckoutPlan, type StripeCheckoutSessionCreateParams } from "./billing/stripe";
import { dailyAllowance, freeEntitlement, type EntitlementRecord } from "./billing/entitlements";
import type { StripePriceConfig } from "./billing/config";
import {
  archiveAuthoredSeed,
  createAuthoredSeedDraft,
  publishAuthoredSeed,
  type AuthoredSeedRecord,
} from "./creator";
import { AppError } from "./lib/errors";
import { createSaveRecord, projectCurrentScene, type SaveRecord, type SceneProjection } from "./saves";
import type { DailyTurnCounter } from "./ratelimit";
import type { TurnHistoryRecord, TurnResult } from "./turn";

export type LibraryItem = {
  saveId: string;
  storyId: string;
  title: string;
  mode: SaveRecord["mode"];
  status: SaveRecord["status"];
  currentNodeId: string;
  turnNumber: number;
  updatedAt: number;
};

export type CreatorSeedLibraryItem = {
  seedId: string;
  storyId: string;
  title: string;
  status: "published";
  opening: string;
  updatedAt: number;
};

export type SceneRecord = {
  saveId: string;
  nodeId: string;
  turnNumber: number;
  stateFingerprint: string;
  prose: string;
  streamStatus: SceneProjection["streamStatus"];
  choiceViews: SceneProjection["choices"];
  engineEvents: unknown[];
  safety: { risk: "normal" | "mature" | "blocked"; reasons: string[] };
  provider: "deterministic" | "anthropic" | "vertex" | "deepseek";
  createdAt: number;
  completedAt?: number | undefined;
  // The structured LLM-driven proposal that produced this scene's prose
  // and choice list. Authored-mode scenes leave this undefined.
  proposal?: unknown;
  terminal?: unknown;
};

export type TurnPersistencePlan = {
  savePatch: Pick<
    SaveRecord,
    "state" | "status" | "engineVersion" | "currentNodeId" | "turnNumber" | "updatedAt"
  > & { activeTurnRequestId?: string | undefined; currentSceneId?: string | undefined };
  dailyCounter: DailyTurnCounter;
  history: TurnHistoryRecord;
  scene: SceneRecord;
};

export type AccountProfileProjection = AccountProjection & {
  dailyAllowance: number | "unlimited";
  entitlementTier: EntitlementRecord["tier"];
  entitlementStatus: EntitlementRecord["status"];
};

export type CheckoutStartPlan = {
  request: ReturnType<typeof buildCheckoutSessionRequest>;
  params: StripeCheckoutSessionCreateParams;
};

export function buildGuestAccountSession(input: {
  existing: AccountRecord | null;
  ageSelection: AgeSelection;
  guestTokenHash: string;
  now: number;
}): { account: AccountRecord; projection: AccountProjection; created: boolean } {
  if (input.existing) {
    const account = { ...input.existing, lastActiveAt: input.now };
    return { account, projection: projectAccount(account), created: false };
  }

  const account = createGuestAccountRecord({
    ageSelection: input.ageSelection,
    guestTokenHash: input.guestTokenHash,
    now: input.now,
  });
  return { account, projection: projectAccount(account), created: true };
}

export function buildDefaultEntitlement(accountId: string, now: number): EntitlementRecord {
  return freeEntitlement(accountId, now);
}

export function buildAccountProfile(input: {
  account: AccountRecord;
  entitlement: EntitlementRecord | null;
}): AccountProfileProjection {
  const entitlement = input.entitlement ?? buildDefaultEntitlement(input.account._id ?? "pending", input.account.lastActiveAt);
  return {
    ...projectAccount(input.account),
    dailyAllowance: dailyAllowance(entitlement),
    entitlementTier: entitlement.tier,
    entitlementStatus: entitlement.status,
  };
}

export function buildClaimGuestAccountUpdate(input: {
  guestAccount: AccountRecord & { _id: string };
  userId: string;
  now: number;
}) {
  return buildClaimGuestPlan(input.guestAccount, input.userId, input.now);
}

export function buildMatureContentAccountUpdate(input: {
  account: AccountRecord;
  entitlement: EntitlementRecord | null;
  enabled: boolean;
  now: number;
}) {
  return buildMatureContentUpdate(input.account, input.entitlement, input.enabled, input.now);
}

export function buildCreateSavePlan(input: {
  accountId: string;
  story: Story;
  mode: SaveRecord["mode"];
  now: number;
  rngSeed: string;
}): SaveRecord {
  return createSaveRecord(input);
}

export function buildInitialSceneRecord(input: {
  save: SaveRecord;
  saveId: string;
  story: Story;
  now: number;
  storyMode?: "authored" | "llm-driven";
}): SceneRecord {
  if (input.storyMode === "llm-driven") {
    // Opening scene for an llm-driven story: no prose, no choices yet. The
    // client opens an SSE stream against `/llm/scene-stream` immediately
    // after createSave to populate prose + proposal + choices.
    return {
      saveId: input.saveId,
      nodeId: input.save.currentNodeId,
      turnNumber: input.save.turnNumber,
      stateFingerprint: [
        input.save.storyId,
        input.save.storyVersion,
        input.save.engineVersion,
        input.save.currentNodeId,
        input.save.turnNumber,
      ].join(":"),
      prose: "",
      streamStatus: "pending",
      choiceViews: [],
      engineEvents: [],
      safety: { risk: "normal", reasons: [] },
      provider: "deterministic",
      createdAt: input.now,
    };
  }
  return sceneRecordFromProjection({
    projection: projectCurrentScene({ ...input.save, _id: input.saveId }, input.story),
    save: { ...input.save, _id: input.saveId },
    prose: input.story.nodes[input.save.currentNodeId]?.seed ?? "",
    provider: "deterministic",
    engineEvents: [],
    now: input.now,
  });
}

export function buildLibraryItems(input: {
  saves: SaveRecord[];
  storyTitles: Map<string, string>;
}): LibraryItem[] {
  return input.saves
    .filter((save) => save.status === "active" || save.status === "ended" || save.status === "ended_safely")
    .map((save) => {
      if (!save._id) throw new AppError("save_id_required");
      return {
        saveId: save._id,
        storyId: save.storyId,
        // Reader-authored seed (createSave's "Seed an adventure" flow) takes
        // precedence over the starter-story title. Every seeded save lives
        // under the same synthetic `storyId === "open-canvas"`, so without
        // this fall-through the library would render every seeded save as
        // "Open Canvas" and the reader couldn't tell them apart.
        title: save.seedTitle ?? input.storyTitles.get(save.storyId) ?? save.storyId,
        mode: save.mode,
        status: save.status,
        currentNodeId: save.currentNodeId,
        turnNumber: save.turnNumber,
        updatedAt: save.updatedAt,
      };
    })
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export function authoredSeedStoryId(seedId: string): string {
  if (seedId.trim().length === 0) throw new AppError("creator_seed_id_required");
  return `authored_seed:${seedId}`;
}

export function parseAuthoredSeedStoryId(storyId: string): string | null {
  const prefix = "authored_seed:";
  if (!storyId.startsWith(prefix)) return null;
  const seedId = storyId.slice(prefix.length).trim();
  return seedId.length > 0 ? seedId : null;
}

export function buildCreatorSeedLibraryItems(input: {
  seeds: Array<AuthoredSeedRecord & { _id?: string }>;
}): CreatorSeedLibraryItem[] {
  return input.seeds
    .filter((seed) => seed.status === "published")
    .map((seed) => {
      if (!seed._id) throw new AppError("creator_seed_id_required");
      const startNode = seed.story.nodes[seed.story.startNodeId];
      return {
        seedId: seed._id,
        storyId: authoredSeedStoryId(seed._id),
        title: seed.title,
        status: "published" as const,
        opening: startNode?.seed ?? "Open the seed and test the first branch.",
        updatedAt: seed.updatedAt,
      };
    })
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export function buildTurnPersistencePlan(input: {
  result: TurnResult;
  saveId: string;
  now: number;
}): TurnPersistencePlan {
  const savePatch = {
    state: input.result.save.state,
    status: input.result.save.status,
    engineVersion: input.result.save.engineVersion,
    currentNodeId: input.result.save.currentNodeId,
    turnNumber: input.result.save.turnNumber,
    updatedAt: input.result.save.updatedAt,
    activeTurnRequestId: undefined,
  };

  return {
    savePatch,
    dailyCounter: input.result.dailyCounter,
    history: { ...input.result.history, saveId: input.saveId, provider: normalizeProvider(input.result.history.provider) },
    scene: sceneRecordFromProjection({
      projection: input.result.scene,
      save: { ...input.result.save, _id: input.saveId },
      prose: input.result.prose || input.result.scene.prose,
      provider: normalizeProvider(input.result.provider),
      engineEvents: input.result.history.engineEvents,
      now: input.now,
    }),
  };
}

export function buildCreateAuthoredSeedPlan(input: {
  owner: AccountRecord & { _id: string };
  title: string;
  story: Story;
  now: number;
}): AuthoredSeedRecord {
  return createAuthoredSeedDraft(input);
}

export function buildPublishAuthoredSeedPlan(input: {
  seed: AuthoredSeedRecord;
  owner: AccountRecord & { _id: string };
  now: number;
}): AuthoredSeedRecord {
  return publishAuthoredSeed(input);
}

export function buildArchiveAuthoredSeedPlan(input: {
  seed: AuthoredSeedRecord;
  owner: AccountRecord & { _id: string };
  now: number;
}): AuthoredSeedRecord {
  return archiveAuthoredSeed(input);
}

export function buildCheckoutStartPlan(input: {
  checkout: CheckoutPlan;
  prices: StripePriceConfig;
}): CheckoutStartPlan {
  return {
    request: buildCheckoutSessionRequest(input.checkout),
    params: buildCheckoutSessionCreateParams({
      plan: input.checkout,
      prices: input.prices,
    }),
  };
}

function sceneRecordFromProjection(input: {
  projection: SceneProjection;
  save: SaveRecord;
  prose: string;
  provider: SceneRecord["provider"];
  engineEvents: unknown[];
  now: number;
}): SceneRecord {
  if (!input.save._id) throw new AppError("save_id_required");
  return {
    saveId: input.save._id,
    nodeId: input.projection.nodeId,
    turnNumber: input.projection.turnNumber,
    stateFingerprint: [
      input.save.storyId,
      input.save.storyVersion,
      input.save.engineVersion,
      input.projection.nodeId,
      input.projection.turnNumber,
    ].join(":"),
    prose: input.prose,
    streamStatus: input.projection.streamStatus === "pending" ? "complete" : input.projection.streamStatus,
    choiceViews: input.projection.choices,
    engineEvents: input.engineEvents,
    safety: { risk: "normal", reasons: [] },
    provider: input.provider,
    createdAt: input.now,
    completedAt: input.now,
  };
}

function normalizeProvider(provider: string): SceneRecord["provider"] {
  if (provider === "anthropic" || provider === "vertex" || provider === "deepseek") return provider;
  return "deterministic";
}
