import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const accountId = v.id("accounts");
const saveId = v.id("saves");
const sceneId = v.id("scenes");
const taleId = v.id("published_tales");
const roomId = v.id("coop_rooms");

const jsonValue = v.any();

export default defineSchema({
  accounts: defineTable({
    kind: v.union(v.literal("guest"), v.literal("user")),
    userId: v.optional(v.string()),
    guestTokenHash: v.optional(v.string()),
    ageBand: v.union(v.literal("13-17"), v.literal("18+")),
    matureContentEnabled: v.boolean(),
    matureContentEnabledAt: v.optional(v.number()),
    createdAt: v.number(),
    lastActiveAt: v.number(),
    ttlExpiresAt: v.optional(v.number()),
    isAdmin: v.optional(v.boolean()),
  })
    .index("by_userId", ["userId"])
    .index("by_guestTokenHash", ["guestTokenHash"])
    .index("by_ttlExpiresAt", ["ttlExpiresAt"]),

  entitlements: defineTable({
    accountId,
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    tier: v.union(v.literal("free"), v.literal("unlimited"), v.literal("pro")),
    source: v.union(v.literal("stripe"), v.literal("apple"), v.literal("google"), v.literal("manual")),
    status: v.union(v.literal("active"), v.literal("grace"), v.literal("expired"), v.literal("revoked")),
    includedTurnsPerDay: v.optional(v.number()),
    includedPremiumTokens: v.optional(v.number()),
    includedImages: v.optional(v.number()),
    includedVideos: v.optional(v.number()),
    overageOptIn: v.boolean(),
    monthlySpendCapCents: v.optional(v.number()),
    creditBalanceCents: v.optional(v.number()),
    renewsAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_accountId", ["accountId"])
    .index("by_stripeCustomerId", ["stripeCustomerId"])
    .index("by_stripeSubscriptionId", ["stripeSubscriptionId"]),

  usage_meters: defineTable({
    accountId,
    periodStart: v.number(),
    periodEnd: v.number(),
    textTokens: v.number(),
    premiumTextTokens: v.number(),
    imageGenerations: v.number(),
    videoGenerations: v.number(),
    stripeMeterEventIds: v.array(v.string()),
    estimatedCostCents: v.number(),
    billableOverageCents: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account_period", ["accountId", "periodStart"])
    .index("by_periodEnd", ["periodEnd"]),

  saves: defineTable({
    accountId,
    storyId: v.string(),
    mode: v.union(v.literal("story"), v.literal("hardcore")),
    status: v.union(v.literal("active"), v.literal("dead"), v.literal("ended"), v.literal("ended_safely")),
    engineVersion: v.number(),
    storyVersion: v.number(),
    state: jsonValue,
    currentNodeId: v.string(),
    currentSceneId: v.optional(sceneId),
    turnNumber: v.number(),
    activeTurnRequestId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_accountId", ["accountId"])
    .index("by_storyId", ["storyId"])
    .index("by_status", ["status"])
    .index("by_activeTurnRequestId", ["activeTurnRequestId"]),

  scenes: defineTable({
    saveId,
    nodeId: v.string(),
    turnNumber: v.number(),
    stateFingerprint: v.string(),
    prose: v.string(),
    streamStatus: v.union(
      v.literal("pending"),
      v.literal("streaming"),
      v.literal("complete"),
      v.literal("failed"),
      v.literal("blocked"),
    ),
    choiceViews: v.array(jsonValue),
    engineEvents: v.array(jsonValue),
    safety: jsonValue,
    provider: v.optional(v.union(v.literal("anthropic"), v.literal("vertex"), v.literal("deepseek"), v.literal("deterministic"))),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_save_turn", ["saveId", "turnNumber"])
    .index("by_save_node_fingerprint", ["saveId", "nodeId", "stateFingerprint"]),

  turn_history: defineTable({
    saveId,
    accountId,
    requestId: v.string(),
    turnNumber: v.number(),
    fromNodeId: v.string(),
    choiceId: v.string(),
    engineDiffs: v.array(jsonValue),
    engineEvents: v.array(jsonValue),
    provider: v.union(v.literal("anthropic"), v.literal("vertex"), v.literal("deepseek"), v.literal("deterministic")),
    tokenUsage: v.optional(jsonValue),
    latency: jsonValue,
    createdAt: v.number(),
  })
    .index("by_save_turn", ["saveId", "turnNumber"])
    .index("by_accountId", ["accountId"])
    .index("by_requestId", ["requestId"]),

  endings_unlocked: defineTable({
    accountId,
    storyId: v.string(),
    endingId: v.string(),
    firstSeen: v.number(),
    mode: v.union(v.literal("story"), v.literal("hardcore")),
    path: v.array(v.string()),
  })
    .index("by_account_story", ["accountId", "storyId"])
    .index("by_account_ending", ["accountId", "endingId"]),

  published_tales: defineTable({
    ownerAccountId: accountId,
    sourceSaveId: saveId,
    title: v.string(),
    synopsis: v.string(),
    coverAssetId: v.optional(v.id("assets")),
    privacy: v.union(v.literal("public"), v.literal("unlisted"), v.literal("friends")),
    accessRevokedAt: v.optional(v.number()),
    forkPolicy: v.union(v.literal("any_decision"), v.literal("ending_only"), v.literal("disabled")),
    isMature: v.boolean(),
    safetySummary: jsonValue,
    snapshotTurnIds: v.array(v.id("turn_history")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_ownerAccountId", ["ownerAccountId"])
    .index("by_sourceSaveId", ["sourceSaveId"])
    .index("by_privacy", ["privacy"]),

  tale_reads: defineTable({
    taleId,
    accountId: v.optional(accountId),
    readAt: v.number(),
  })
    .index("by_taleId", ["taleId"])
    .index("by_accountId", ["accountId"]),

  tale_forks: defineTable({
    taleId,
    sourceTurnId: v.id("turn_history"),
    newSaveId: saveId,
    accountId,
    createdAt: v.number(),
  })
    .index("by_taleId", ["taleId"])
    .index("by_accountId", ["accountId"]),

  authored_seeds: defineTable({
    ownerAccountId: accountId,
    title: v.string(),
    status: v.union(v.literal("draft"), v.literal("published"), v.literal("archived")),
    story: jsonValue,
    safetySummary: jsonValue,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_ownerAccountId", ["ownerAccountId"])
    .index("by_status", ["status"]),

  seasons: defineTable({
    storyId: v.string(),
    title: v.string(),
    startsAt: v.number(),
    endsAt: v.number(),
    status: v.union(v.literal("draft"), v.literal("active"), v.literal("ended")),
    rules: jsonValue,
  })
    .index("by_status", ["status"])
    .index("by_window", ["startsAt", "endsAt"]),

  leaderboard_entries: defineTable({
    seasonId: v.id("seasons"),
    accountId,
    storyId: v.string(),
    endingId: v.string(),
    kind: v.union(v.literal("first_to_find"), v.literal("rarest_path"), v.literal("completion")),
    rankValue: v.number(),
    createdAt: v.number(),
  })
    .index("by_season_kind", ["seasonId", "kind"])
    .index("by_accountId", ["accountId"]),

  coop_rooms: defineTable({
    saveId,
    hostAccountId: accountId,
    roomCode: v.string(),
    inviteTokenHash: v.string(),
    status: v.union(v.literal("open"), v.literal("active"), v.literal("closed")),
    mode: v.union(v.literal("pass"), v.literal("vote")),
    visibility: v.union(v.literal("private"), v.literal("link"), v.literal("friends")),
    spectatorMode: v.union(v.literal("off"), v.literal("read_only")),
    participants: v.array(jsonValue),
    activeParticipantId: v.optional(v.string()),
    voteEndsAt: v.optional(v.number()),
    votes: jsonValue,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_saveId", ["saveId"])
    .index("by_hostAccountId", ["hostAccountId"])
    .index("by_roomCode", ["roomCode"])
    .index("by_inviteTokenHash", ["inviteTokenHash"]),

  analytics_events: defineTable({
    accountId: v.optional(accountId),
    saveId: v.optional(saveId),
    taleId: v.optional(taleId),
    roomId: v.optional(roomId),
    eventName: v.string(),
    storyId: v.optional(v.string()),
    turnNumber: v.optional(v.number()),
    provider: v.optional(v.union(v.literal("anthropic"), v.literal("vertex"), v.literal("deepseek"), v.literal("deterministic"))),
    payload: jsonValue,
    redacted: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_eventName", ["eventName"])
    .index("by_accountId", ["accountId"])
    .index("by_saveId", ["saveId"])
    .index("by_createdAt", ["createdAt"]),

  daily_turn_counter: defineTable({
    accountId,
    dayKey: v.string(),
    turnsUsed: v.number(),
    resetAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account_day", ["accountId", "dayKey"])
    .index("by_resetAt", ["resetAt"]),

  assets: defineTable({
    accountId,
    saveId: v.optional(saveId),
    taleId: v.optional(taleId),
    kind: v.union(v.literal("image"), v.literal("video"), v.literal("audio")),
    provider: v.union(
      v.literal("vertex-imagen"),
      v.literal("vertex-veo"),
      v.literal("gemini-veo"),
      v.literal("uploaded"),
    ),
    url: v.string(),
    status: v.union(v.literal("queued"), v.literal("generating"), v.literal("ready"), v.literal("failed"), v.literal("blocked")),
    entitlementRequired: v.literal("pro"),
    promptHash: v.string(),
    provenance: jsonValue,
    safety: jsonValue,
    createdAt: v.number(),
  })
    .index("by_accountId", ["accountId"])
    .index("by_saveId", ["saveId"])
    .index("by_taleId", ["taleId"])
    .index("by_status", ["status"]),

  migrations: defineTable({
    saveId,
    fromEngineVersion: v.number(),
    toEngineVersion: v.number(),
    status: v.union(v.literal("pending"), v.literal("applied"), v.literal("failed")),
    error: v.optional(v.string()),
    createdAt: v.number(),
    appliedAt: v.optional(v.number()),
  })
    .index("by_saveId", ["saveId"])
    .index("by_status", ["status"]),

  idempotency_records: defineTable({
    scope: v.string(),
    requestId: v.string(),
    accountId: v.optional(accountId),
    saveId: v.optional(saveId),
    result: jsonValue,
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_scope_request", ["scope", "requestId"])
    .index("by_expiresAt", ["expiresAt"]),

  stripe_webhook_events: defineTable({
    eventId: v.string(),
    type: v.string(),
    processedAt: v.number(),
  })
    .index("by_eventId", ["eventId"])
    .index("by_processedAt", ["processedAt"]),
});
