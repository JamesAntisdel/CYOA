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

// ---------------------------------------------------------------------------
// Community seed shelf (creator-arc; core-read-loop Req 22.3/22.6, steering
// product feature 13). Pure types + helpers for the publish-metadata fields
// added to `authored_seeds` and the public shelf projection consumed by
// `creatorFunctions:listPublishedPublic`.
// ---------------------------------------------------------------------------

export type SeedVisibility = "public" | "unlisted";
export type SeedForkPolicy = "allowed" | "disabled";

/** Publish-step metadata cap (mirrors the tale-publish synopsis budget). */
export const SEED_SYNOPSIS_MAX = 200;
export const SEED_TONE_MAX = 40;

/**
 * The optional community-shelf fields layered onto AuthoredSeedRecord by this
 * wave (schema `authored_seeds`, all optional — legacy rows carry none).
 */
export type AuthoredSeedShelfFields = {
  synopsis?: string;
  tone?: string;
  visibility?: SeedVisibility;
  isMature?: boolean;
  forkPolicy?: SeedForkPolicy;
  publishedAt?: number;
  remixOfSeedId?: string;
  remixOfTitle?: string;
};

export type AuthoredSeedShelfRecord = AuthoredSeedRecord & AuthoredSeedShelfFields;

/**
 * One public shelf card (wire shape — BC2: server emits null-for-absent, the
 * app adapter in `apps/app/lib/seedShelfApi.ts` maps nulls to optional).
 */
export type CommunitySeedShelfItem = {
  seedId: string;
  storyId: string;
  title: string;
  synopsis: string | null;
  tone: string | null;
  /** The seed's opening text — reader-visible turn-0 content only (BC10). */
  opening: string;
  ownerHandle: string;
  isMature: boolean;
  forkPolicy: SeedForkPolicy;
  remixOfTitle: string | null;
  publishedAt: number;
};

/** Legacy published seeds (no visibility field) read as unlisted so nothing
 * published before the shelf existed leaks onto it retroactively. */
export function seedVisibility(seed: AuthoredSeedShelfFields): SeedVisibility {
  return seed.visibility ?? "unlisted";
}

/** Absent forkPolicy reads as "allowed" (the open default tales ship with). */
export function seedForkPolicy(seed: AuthoredSeedShelfFields): SeedForkPolicy {
  return seed.forkPolicy ?? "allowed";
}

/**
 * Mature flag: prefer the persisted publish-time flag; legacy rows derive it
 * from the stored safety summary (mirrors published_tales.isMature, Req 12.9).
 */
export function seedIsMature(seed: AuthoredSeedShelfRecord): boolean {
  if (typeof seed.isMature === "boolean") return seed.isMature;
  const categories = (seed.safetySummary as { matureCategories?: unknown[] } | undefined)
    ?.matureCategories;
  return Array.isArray(categories) && categories.length > 0;
}

/** Shelf ordering key: publish time, falling back to updatedAt on legacy rows
 * (published seeds are immutable, so updatedAt ≈ publish time). */
export function seedPublishedAt(seed: AuthoredSeedShelfRecord): number {
  return seed.publishedAt ?? seed.updatedAt;
}

/**
 * Cross-account launch policy (Req 22.3 — "the dashboard's external-play
 * attribution becomes real"). The owner launches any of their own published
 * seeds (unchanged). Everyone else launches a PUBLISHED seed when its
 * visibility is public (shelf) or unlisted (link possession — the storyId
 * carries the seed id, mirroring unlisted-tale semantics). Draft/archived
 * seeds never launch cross-account. Mature gating is the caller's job (the
 * viewer's entitlement lives outside this pure module).
 */
export function canLaunchAuthoredSeed(input: {
  seed: AuthoredSeedShelfRecord;
  viewerAccountId: string;
}): boolean {
  if (input.seed.status !== "published") return false;
  if (input.seed.ownerAccountId === input.viewerAccountId) return true;
  const visibility = seedVisibility(input.seed);
  return visibility === "public" || visibility === "unlisted";
}

/**
 * Deterministic reader-facing display handle for a creator account. There is
 * no username system yet, and the raw account id must never reach another
 * reader — this derives a stable pseudonym ("ashen-lantern-3f2a") from a
 * small FNV-1a hash of the account id. Same account → same handle, so a
 * prolific creator is recognizable across shelf cards.
 */
export function creatorHandle(accountId: string): string {
  const adjectives = [
    "ashen", "gilded", "quiet", "vagrant", "hollow", "silver", "mossy", "sable",
    "amber", "pale", "iron", "velvet", "wandering", "candled", "thorned", "tidal",
  ];
  const nouns = [
    "lantern", "archivist", "cartographer", "raven", "keeper", "scribe", "warden", "pilgrim",
    "binder", "chronicler", "smith", "witness", "collector", "librarian", "courier", "teller",
  ];
  let hash = 0x811c9dc5;
  for (let index = 0; index < accountId.length; index += 1) {
    hash ^= accountId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const adjective = adjectives[hash % adjectives.length];
  const noun = nouns[Math.floor(hash / adjectives.length) % nouns.length];
  const suffix = (hash % 0x10000).toString(16).padStart(4, "0");
  return `${adjective}-${noun}-${suffix}`;
}

/**
 * Project one published seed onto its public shelf card. Null-for-absent per
 * BC2. `opening` is the start node's seed text (the exact prose a reader sees
 * on turn 0 — nothing hidden or unfired crosses the wire, BC10).
 */
export function buildCommunitySeedShelfItem(input: {
  seed: AuthoredSeedShelfRecord & { _id?: string };
  ownerHandle: string;
}): CommunitySeedShelfItem {
  const { seed } = input;
  if (!seed._id) throw new AppError("creator_seed_id_required");
  const startNode = seed.story.nodes[seed.story.startNodeId];
  return {
    seedId: seed._id,
    storyId: authoredSeedStoryId(seed._id),
    title: seed.title,
    synopsis: seed.synopsis ?? null,
    tone: seed.tone ?? null,
    opening: (startNode?.seed ?? "").slice(0, 280),
    ownerHandle: input.ownerHandle,
    isMature: seedIsMature(seed),
    forkPolicy: seedForkPolicy(seed),
    remixOfTitle: seed.remixOfTitle ?? null,
    publishedAt: seedPublishedAt(seed),
  };
}

/**
 * Validated publish-step metadata (creator route publish panel). Trims,
 * length-caps, and returns only the fields that were provided — callers
 * conditional-spread the result onto the publish plan. Content-policy
 * evaluation of the synopsis text stays in the registered mutation (it needs
 * the account context); this handles shape only.
 */
export function normalizeSeedPublishMetadata(input: {
  synopsis?: string | undefined;
  tone?: string | undefined;
  visibility?: SeedVisibility | undefined;
  forkPolicy?: SeedForkPolicy | undefined;
}): AuthoredSeedShelfFields {
  const out: AuthoredSeedShelfFields = {};
  if (typeof input.synopsis === "string") {
    const synopsis = input.synopsis.trim();
    if (synopsis.length > SEED_SYNOPSIS_MAX) throw new AppError("seed_synopsis_too_long");
    if (synopsis.length > 0) out.synopsis = synopsis;
  }
  if (typeof input.tone === "string") {
    const tone = input.tone.trim();
    if (tone.length > SEED_TONE_MAX) throw new AppError("seed_tone_too_long");
    if (tone.length > 0) out.tone = tone;
  }
  if (input.visibility) out.visibility = input.visibility;
  if (input.forkPolicy) out.forkPolicy = input.forkPolicy;
  return out;
}

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
  provider: "deterministic" | "anthropic" | "vertex" | "deepseek" | "fireworks";
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
  /**
   * Publish-step metadata from the creator route's publish panel (creator-arc,
   * Req 22.6). Optional — a metadata-less publish (legacy client) lands as an
   * UNLISTED seed so nothing reaches the public shelf without an explicit
   * choice. `normalizeSeedPublishMetadata` has already length-capped/trimmed;
   * this just layers the fields onto the pure publish plan.
   */
  metadata?: AuthoredSeedShelfFields | undefined;
}): AuthoredSeedShelfRecord {
  const plan = publishAuthoredSeed(input) as AuthoredSeedShelfRecord;
  const metadata = input.metadata ?? {};
  return {
    ...plan,
    ...(metadata.synopsis !== undefined ? { synopsis: metadata.synopsis } : {}),
    ...(metadata.tone !== undefined ? { tone: metadata.tone } : {}),
    // Preserve a previously chosen visibility/policy on re-publish; a seed
    // that never chose one stays unlisted (nothing leaks retroactively).
    visibility: metadata.visibility ?? plan.visibility ?? "unlisted",
    forkPolicy: metadata.forkPolicy ?? plan.forkPolicy ?? "allowed",
    // Mature mirror of published_tales.isMature (Req 12.9), derived from the
    // freshly recomputed publish-time safety summary. Defensive: the
    // publishing surface currently blocks mature text before this point.
    isMature:
      Array.isArray((plan.safetySummary as { matureCategories?: unknown[] })?.matureCategories) &&
      ((plan.safetySummary as { matureCategories: unknown[] }).matureCategories.length > 0),
    publishedAt: input.now,
  };
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
  if (
    provider === "anthropic" ||
    provider === "vertex" ||
    provider === "deepseek" ||
    provider === "fireworks"
  )
    return provider;
  return "deterministic";
}
