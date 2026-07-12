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
    /**
     * Per-account media-generation gates. Wired through the settings screen
     * (`apps/app/app/settings/index.tsx`) — when a modality is false, the
     * matching `convex/media/sceneMedia.ts` queue mutation short-circuits
     * before scheduling Imagen / Veo / Google TTS so the provider bill
     * matches the reader's stated preference. Absence means "all enabled"
     * (default behavior). Settings is global to the reader (not per-save),
     * so the gate lives on the account row rather than the save row.
     */
    mediaPrefs: v.optional(v.object({
      imagesEnabled: v.boolean(),
      audioEnabled: v.boolean(),
      videoEnabled: v.boolean(),
      // omni-cinematics media-strategy switch. Absent = legacy per-scene
      // behavior. The server resolver composes this with the per-modality
      // booleans above (videoEnabled:false caps at "stills_only" — build
      // correction C4) and the Pro entitlement gate.
      cinematicMode: v.optional(
        v.union(
          v.literal("off"),
          v.literal("stills_only"),
          v.literal("endpoint_cinematic"),
          v.literal("per_scene_legacy"),
        ),
      ),
    })),
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
    // Narrator voice id pinned to this save when the reader first picks one
    // (see apps/app/hooks/useNarratorVoice.ts). Server-side TTS uses it to
    // map to a Google Cloud TTS voice via convex/llm/ttsVoices.ts. Optional
    // for backwards compatibility with saves that pre-date narration.
    voiceId: v.optional(v.string()),
    // Seed-flow inputs: when the reader authored a custom premise via the
    // creator's "Seed an adventure" UI, the title/premise/tone they typed
    // are persisted here. The LLM-driven scene pipeline prefers these
    // over the starter story's hardcoded seed text so the opening reads
    // from the reader's premise instead of the starter map. Optional for
    // saves that came in via the legacy starter-only path.
    seedPremise: v.optional(v.string()),
    seedTitle: v.optional(v.string()),
    seedTone: v.optional(v.string()),
    // Running "story so far" summary maintained by `convex/llm/summarizer.ts`
    // after every successful turn. Surfaced to the next scene prompt as
    // canonical context above the rolling memory window so the LLM stops
    // proposing actions the reader already took (e.g. "open the coconut" on
    // turn 4 after it was opened on turn 2). Capped at ~500 characters by
    // the summarizer; absent on every save until the first successful turn
    // completes (the opening scene has nothing to summarise yet).
    storySummary: v.optional(v.string()),
    // Reference-image carry-over for scene illustrations. On turn 1 of an
    // llm-driven save, the LLM emits `protagonistAnchor` + `settingAnchor`
    // descriptions; convex/media schedules anchor jobs that generate
    // dedicated portrait + establishing-shot images and stores their
    // assetIds here. Subsequent scene-image calls fetch the storage bytes
    // for these anchors and pass them as inline reference inputs to
    // Gemini Flash Image so the protagonist face + setting style stay
    // consistent across the read. Optional — saves that pre-date this
    // feature (or where the LLM omitted the anchors) simply render
    // without references and fall back to the existing Imagen path.
    anchorProtagonistAssetId: v.optional(v.id("assets")),
    anchorSettingAssetId: v.optional(v.id("assets")),
    // omni-cinematics double-fire guard. `queueEndpointCinematic` patches this
    // on every successful queue so two concurrent queues (SSE re-mount /
    // double-scheduled turn completion) serialize on THIS document — Convex OCC
    // does not conflict on phantom inserts into an empty asset range, so the
    // asset-query dedupe alone can't stop a same-instant double-fire.
    lastCinematicQueuedAt: v.optional(v.number()),
    // story-engagement W3 (R13). When this save was started from a Daily Tale,
    // the `daily_tales` row id it belongs to. Set at createSave; drives the
    // one-per-day guard and the terminal `daily_results` insert. Absent on
    // every non-daily save (BC9).
    dailyId: v.optional(v.string()),
    // story-engagement W3 (R12.2). The keepsake id the reader carried into
    // this run from a prior ending (injected as a tagged inventory item at
    // createSave). Absent when no keepsake was carried.
    keepsakeCarried: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_accountId", ["accountId"])
    .index("by_storyId", ["storyId"])
    .index("by_status", ["status"])
    .index("by_activeTurnRequestId", ["activeTurnRequestId"])
    .index("by_dailyId", ["dailyId"]),

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
    /**
     * Timestamp (ms since epoch) at which the SSE handler claimed the
     * "streaming" lock for this scene. `getAuthorizedSceneStreamRequest`
     * uses this together with `SCENE_STREAM_LOCK_TTL_MS` to reject a
     * concurrent stream-open against a still-running scene while still
     * allowing a recovery retry after the holder has clearly crashed.
     * Optional: scenes created before this field shipped, and scenes that
     * are still in `pending` / `complete` / `blocked` / `failed`, never
     * populate it.
     */
    streamStartedAt: v.optional(v.number()),
    choiceViews: v.array(jsonValue),
    engineEvents: v.array(jsonValue),
    safety: jsonValue,
    provider: v.optional(v.union(v.literal("anthropic"), v.literal("vertex"), v.literal("deepseek"), v.literal("fireworks"), v.literal("deterministic"))),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
    // The LLM-driven contract: the structured proposal returned by the
    // model for this scene (prose + choices + effects + terminal). The
    // engine validates this before persisting; the next turn looks the
    // proposal up to apply the chosen choice's effects.
    proposal: v.optional(jsonValue),
    terminal: v.optional(jsonValue),
    /**
     * True when the router served this scene from the deterministic
     * fallback provider (every real provider failed or was ineligible).
     * Reader UI uses this to render the FallbackTurnPanel ("the page is
     * blank for a moment — try again") instead of the deterministic
     * placeholder prose + choices, which would otherwise look like a
     * real LLM scene. Absent on every real-provider scene; treat absent
     * as `false`. Cleared (left absent) once the reader retries and a
     * real provider responds.
     */
    isFallback: v.optional(v.boolean()),
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
    /**
     * Reader-facing label for the chosen action. For LLM-proposed choices
     * this is the proposal's `label` (a fixed string the engine chose
     * from). For free-form ("Option D") turns this is the trimmed text
     * the reader typed — surfaced through the memory window so the next
     * scene's prompt can read "from <node> chose '<typed text>'" instead
     * of an opaque synthetic choiceId. Optional for backwards compatibility
     * with rows written before this field existed.
     */
    choiceLabel: v.optional(v.string()),
    /**
     * NPC ids the LLM (or the engine, when it scans free-form prose) flagged
     * as mentioned in this turn's scene. Persisted so the next turn's
     * prompt-builder can surface those NPCs' sheets without re-parsing prose
     * (Requirements 31.3 / 31.4). Most-recent-first when read back via
     * `loadRecentNpcMentions`. Optional for backwards compatibility with rows
     * written before this field existed; the field is set by the LLM-contract
     * task (Task 55) once `proposal.npcMentions` is wired through the parser.
     */
    mentionsExtracted: v.optional(v.array(v.string())),
    engineDiffs: v.array(jsonValue),
    // story-engagement W1 (R5): visible-tier, hidden-stat-redacted signed diffs
    // for the client echo/consequence reel (`projection.recentDiffs`). Separate
    // from `engineDiffs` (raw) so the projection never has to re-redact.
    visibleDiffs: v.optional(v.array(jsonValue)),
    engineEvents: v.array(jsonValue),
    provider: v.union(v.literal("anthropic"), v.literal("vertex"), v.literal("deepseek"), v.literal("fireworks"), v.literal("deterministic")),
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
    // Set true when the unlock was a safety-forced safe ending (Req 11.4), so
    // the trophy crypt can distinguish it from an earned ending.
    safetyEnding: v.optional(v.boolean()),
    // story-engagement W3 (R12.1). The keepsake earned at this ending — either
    // an LLM-authored terminal keepsake (validated) or an ending-derived
    // default. Carriable into a future run (see saves.keepsakeCarried). Absent
    // on unlocks written before W3 (BC9).
    keepsake: v.optional(
      v.object({
        id: v.string(),
        label: v.string(),
        description: v.string(),
      }),
    ),
    // Panel review (real trophy labels). Human title for the ending — the
    // matched arc candidateEnding's label, else a title-cased endingId slug.
    // Absent on legacy rows and on machine-id endings with no candidate; the
    // client falls back gracefully (apps/app/lib/endingLabels.ts).
    label: v.optional(v.string()),
    // Last few reader choice labels leading into the ending (oldest→newest) —
    // the trophy crypt's human path hint, replacing node-id joins. Absent on
    // legacy rows; the client falls back to prettifying `path`.
    pathLabels: v.optional(v.array(v.string())),
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
    // Reference ids into the source save's turn_history (kept for lineage).
    snapshotTurnIds: v.array(v.id("turn_history")),
    // Denormalized, immutable snapshot of the story this tale captured. Persisted
    // so a published tale survives the source save being rewound or purged
    // (which deletes the referenced turn_history/scenes). Read + fork resolve
    // from these; snapshotTurnIds remain only for lineage. Optional for
    // backward-compatibility with any tale published before this field existed.
    storyId: v.optional(v.string()),
    snapshotTurns: v.optional(v.array(jsonValue)),
    // omni-cinematics Req 10.1: the source save's ending cinematic, denormalized
    // at publish time (owner-consented, safety-gated) so the published tale can
    // lead with it even after the source save/asset is gone.
    leadCinematic: v.optional(
      v.object({
        assetId: v.id("assets"),
        url: v.string(),
        hasAudio: v.boolean(),
        synthId: v.boolean(),
        endingId: v.optional(v.string()),
      }),
    ),
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
    // --- creator-arc community shelf (core-read-loop Req 22.3/22.6; steering
    // product feature 13). ALL optional: legacy rows keep working untouched.
    // Publish metadata collected in the creator route's publish step
    // (mirrors the tale-publish form: synopsis / privacy / fork policy).
    // Synopsis is capped at 200 chars server-side (SEED_SYNOPSIS_MAX).
    synopsis: v.optional(v.string()),
    // SeedTone id from the creator UI (e.g. "gothic-mystery"); free string
    // server-side, capped at 40 chars.
    tone: v.optional(v.string()),
    // Community-shelf visibility. ABSENT on seeds published before this field
    // existed — read as "unlisted" (owner + direct-link only) so nothing that
    // was published pre-shelf leaks onto the public shelf retroactively.
    visibility: v.optional(v.union(v.literal("public"), v.literal("unlisted"))),
    // Mature-exclusion mirror of published_tales.isMature (Req 12.9): derived
    // from the publish-time safety summary's matureCategories. Defensive —
    // the publishing-surface policy currently blocks mature text outright, so
    // this is false on every seed the gate lets through — but the shelf query
    // filters on it so a future policy loosening can't leak mature seeds to
    // guests / non-opted-in readers. Absent = derive from safetySummary.
    isMature: v.optional(v.boolean()),
    // Remix policy mirroring TaleForkPolicy semantics collapsed to the two
    // states that make sense for a whole-graph copy (there is no mid-run
    // decision point to fork from). Absent = "allowed" (matches the open
    // default tales ship with).
    forkPolicy: v.optional(v.union(v.literal("allowed"), v.literal("disabled"))),
    // Publish timestamp for shelf ordering + cursor paging (newest first).
    // Absent on legacy published rows — readers fall back to updatedAt
    // (published seeds are immutable, so updatedAt ≈ publish time).
    publishedAt: v.optional(v.number()),
    // Remix lineage: set on a draft created by `creatorFunctions:remix`.
    // Title is denormalized so the credit line survives the source seed
    // being archived or retitled.
    remixOfSeedId: v.optional(v.id("authored_seeds")),
    remixOfTitle: v.optional(v.string()),
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
    // Set true for a mature co-op room (Req 20.7). Written only when true.
    isMature: v.optional(v.boolean()),
    // Audit timestamp for when the room was closed; status:"closed" is the
    // source of truth, this is optional bookkeeping.
    closedAt: v.optional(v.number()),
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
    provider: v.optional(v.union(v.literal("anthropic"), v.literal("vertex"), v.literal("deepseek"), v.literal("fireworks"), v.literal("deterministic"))),
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

  // story-engagement W3 (R13, design §6). One shared "Daily Tale" per UTC day,
  // minted by the `mint-daily-tale` cron. `date` is the yyyy-mm-dd key (unique
  // via by_date). `storyArc` is the LLM-authored (or deterministic-fallback)
  // arc injected into every reader's daily save so all readers race the same
  // dramatic question.
  daily_tales: defineTable({
    date: v.string(),
    premise: v.string(),
    tone: v.string(),
    title: v.string(),
    storyArc: jsonValue,
    createdAt: v.number(),
  }).index("by_date", ["date"]),

  // story-bible (design §1.1). One row per llm-driven save holding the
  // server-only Story Bible plan (key registry / lock plan / cast / twists /
  // ending hints / motifs). Generated by a dedicated background LLM call
  // scheduled at createSave ("llm/storyBible:generateStoryBible"); the JSON in
  // `bible` is engine-typed (validateProposedBible) and consumption state
  // lives INSIDE the entries, updated in the SAME mutation as the turn's
  // state write (SB4/R2.1). NO field of this table ever reaches the client
  // (R2.2/BC10). Copied verbatim on fork; absent for authored stories.
  story_bibles: defineTable({
    saveId,
    status: v.union(
      v.literal("queued"),
      v.literal("generating"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    // Validated StoryBible JSON (absent until status:"ready").
    bible: v.optional(jsonValue),
    // Turn the bible was first included in a scene prompt (R1.5); its
    // endingHints were arc-matched at that moment. Absent until attached.
    attachedAtTurn: v.optional(v.number()),
    // Guard: at most one refresh call per act boundary (R6).
    lastRefreshAct: v.optional(v.number()),
    // ≤1 retry of the generation call (R1.4).
    retryCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_saveId", ["saveId"]),

  // story-engagement W3 (R13.3). One row per (account, daily) recording the
  // ending a reader reached — powers the results distribution + first-finder
  // badge. Idempotent per (accountId, dailyId).
  daily_results: defineTable({
    dailyId: v.string(),
    accountId,
    endingId: v.string(),
    turnCount: v.number(),
    finishedAt: v.number(),
  })
    .index("by_daily", ["dailyId"])
    .index("by_daily_account", ["dailyId", "accountId"]),

  assets: defineTable({
    accountId,
    saveId: v.optional(saveId),
    taleId: v.optional(taleId),
    sceneId: v.optional(v.id("scenes")),
    nodeId: v.optional(v.string()),
    // NPC portrait asset (Requirement 31). When set, this asset row is a
    // square 1:1 portrait generated by `convex/media/npcMedia.ts` for the
    // named NPC inside the owning save. `sceneId` and `nodeId` may both
    // be absent on portrait rows — portraits live on the save, not on a
    // single scene. Queries that filter by `npcId` use the `by_npc_save`
    // index below to look up the live portrait for a roster card.
    npcId: v.optional(v.string()),
    // Reference-anchor classifier for the scene-image carry-over pipeline.
    // When set, this asset row is one of the two save-level anchors
    // (protagonist portrait or setting establishing shot) generated on
    // turn 1 by `convex/media/geminiImageClient.ts`. The save row points
    // at these anchors via `anchorProtagonistAssetId` / `anchorSettingAssetId`;
    // every subsequent scene-image call fetches the storage bytes of the
    // pointed-at anchors and passes them as inline references to Gemini
    // Flash Image. Absent on normal scene images, NPC portraits,
    // videos, and audio.
    referenceKind: v.optional(v.union(v.literal("protagonist"), v.literal("setting"))),
    // "cinematic" (omni-cinematics spec): an endpoint cinematic (opening /
    // ending) produced by Gemini Omni, distinct from per-scene image/video.
    kind: v.union(v.literal("image"), v.literal("video"), v.literal("audio"), v.literal("cinematic")),
    provider: v.union(
      v.literal("vertex-imagen"),
      v.literal("vertex-veo"),
      v.literal("gemini-veo"),
      v.literal("gemini-omni"),
      v.literal("google-tts"),
      v.literal("uploaded"),
    ),
    url: v.string(),
    status: v.union(v.literal("queued"), v.literal("generating"), v.literal("ready"), v.literal("failed"), v.literal("blocked")),
    entitlementRequired: v.literal("pro"),
    promptHash: v.string(),
    provenance: jsonValue,
    safety: jsonValue,
    alt: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    durationMs: v.optional(v.number()),
    // Cinematic-only fields (kind === "cinematic"). `trigger` marks which
    // endpoint produced it; `endingId` links an ending cinematic to the
    // reached ending (per-save — repeat unlocks reuse the endingId but a new
    // asset row, see spec build-correction C5); `hasAudio` flags Omni's native
    // synchronized audio track. Absent on image/video/audio rows.
    cinematicTrigger: v.optional(v.union(v.literal("opening"), v.literal("ending"), v.literal("chapter"))),
    endingId: v.optional(v.string()),
    hasAudio: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
    readyAt: v.optional(v.number()),
  })
    .index("by_accountId", ["accountId"])
    .index("by_saveId", ["saveId"])
    .index("by_taleId", ["taleId"])
    .index("by_status", ["status"])
    .index("by_scene", ["sceneId"])
    // Look up a save's NPC portraits in one query — used by
    // `getNpcPortraitUrl` and the idempotency check in queueNpcPortrait.
    .index("by_npc_save", ["saveId", "npcId"])
    // Cinematics for a save (trophy-crypt playback + dedupe by trigger).
    .index("by_save_kind", ["saveId", "kind"]),

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

  // provider-and-credit-model design §2.2. Append-only spark ledger backing the
  // media credit economy. Balance = indexed sum over `by_account`, mirrored into
  // `entitlements.creditBalanceCents` for cheap reads. `idempotencyKey` (unique
  // via `by_idem`) dedupes grants / spends / Stripe webhooks the same way
  // `stripe_webhook_events` dedupes events. `delta` is +grant/purchase/refund,
  // -spend. `assetId` links a spend/refund to the media asset it paid for;
  // `stripeSessionId` links a `pack_purchase` to its one-time checkout session.
  // provider-and-credit-model design §3 (H1/H2). Fixed-window action rate
  // counters keyed by `<action>:<scope>` (e.g. `save:<accountId>`,
  // `guest:<guestTokenHash>`). `windowStart` + `count` implement a per-key
  // hourly budget enforced by `ratelimit.consumeActionRateLimit`. Distinct from
  // `daily_turn_counter` (per-account/day turn budget) — this bounds identity
  // minting + save creation to blunt the turn-0 bible-schedule cost amplifier.
  action_rate_counters: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  media_credits_ledger: defineTable({
    accountId: v.id("accounts"),
    delta: v.number(),
    reason: v.union(
      v.literal("pro_allowance"),
      v.literal("pack_purchase"),
      v.literal("reader_spend"),
      v.literal("creator_spend"),
      v.literal("refund"),
    ),
    idempotencyKey: v.string(),
    assetId: v.optional(v.id("assets")),
    stripeSessionId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_idem", ["idempotencyKey"]),
});
