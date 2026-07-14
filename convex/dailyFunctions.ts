// =============================================================================
// Daily Tale — convex functions (story-engagement W3 / R13, design §6–§7).
//
// Registered paths (BC1 — clients call the FULL directory-qualified path):
//   dailyFunctions:getToday     query
//   dailyFunctions:startDaily   mutation
//   dailyFunctions:getResults   query
//   dailyFunctions:mintDailyTale        internalAction  (cron: mint-daily-tale)
//   dailyFunctions:insertDailyTaleRow   internalMutation (idempotent per date)
//   dailyFunctions:findDailyByDate      internalQuery
//
// Wire shapes are EXACTLY §7 (BC2): the server emits null-for-absent, the
// `lib/dailyApi.ts` adapter maps null → optional fields. Optional fields are
// conditional-spread (BC4).
// =============================================================================

import {
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  makeFunctionReference,
  mutationGeneric,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";

import { OPEN_STARTER_ID } from "@cyoa/stories";
import {
  synthesizeFallbackArc,
  validateProposedArc,
  type StoryArc,
} from "@cyoa/engine";
import type { ContentPolicyContext } from "@cyoa/shared";

import {
  advanceDailyStreak,
  anonymousReaderName,
  buildDailyPremise,
  buildDailyResultRow,
  computeDistribution,
  dailyQuestionTeaser,
  emptyStreak,
  endingLabelResolver,
  isoDateFromMillis,
  type DailyDistributionRow,
  type StreakState,
} from "./daily";
import { streakKeepsake, KEEPSAKE_GRANTED, type Keepsake } from "./keepsakes";
import { evaluateTextPolicy } from "./contentPolicy";
import { AppError } from "./lib/errors";
import { cleanDoc } from "./lib/docs";
import { loadAndAuthorizeAccount } from "./lib/authz";
import type { RouterResult } from "./llm/router";
import type { SceneGenerationRequest } from "./llm/types";

const accountId = v.id("accounts");
const guestTokenHash = v.optional(v.string());

/**
 * All-ages content-policy context for Daily minting (R13.5). Daily premises are
 * always all-ages, so the arc is authored under the strictest gate: no mature
 * content, free tier, generation surface.
 */
const ALL_AGES_CONTEXT: ContentPolicyContext = {
  surface: "generation",
  entitlementTier: "free",
  matureContentEnabled: false,
};

// ---------------------------------------------------------------------------
// getToday (query) — design §7
//   {accountId?, guestTokenHash?} → {daily: {dailyId, date, title,
//                                    questionTeaser, played} | null}
//
// BC3 arg deviation: §7 documents `getToday {}`, but computing `played` per
// reader needs an identity. We widen args with OPTIONAL {accountId?,
// guestTokenHash?}; when absent, `played` is false (the card still renders).
// The contract smoke test must accept this deviation (noted in HANDOFF).
// ---------------------------------------------------------------------------
export const getToday = queryGeneric({
  args: {
    accountId: v.optional(accountId),
    guestTokenHash,
  },
  handler: async (ctx, args) => {
    const date = isoDateFromMillis(Date.now());
    const daily = await ctx.db
      .query("daily_tales")
      .withIndex("by_date", (q: any) => q.eq("date", date))
      .first();
    if (!daily) return { daily: null };

    let played = false;
    let streak: StreakState = emptyStreak();
    if (args.accountId) {
      played = await hasPlayedDaily(ctx, String(daily._id), String(args.accountId));
      streak = await readStreak(ctx, String(args.accountId));
    }

    return {
      daily: {
        dailyId: String(daily._id),
        date: String(daily.date),
        title: String(daily.title),
        questionTeaser: dailyQuestionTeaser(daily.storyArc, String(daily.title)),
        played,
      },
      // Panel-2 W3 retention: the reader's consecutive-day Daily streak. Always
      // present (zeroed when the reader has no record / no identity) so the card
      // can render an ember count without a null-guard dance.
      streak,
    };
  },
});

// ---------------------------------------------------------------------------
// startDaily (mutation) — design §7
//   {accountId, guestTokenHash?} → {saveId} | AppError("daily_already_played")
//
// One-per-day guard, then creates the reader's save FOR today's Daily by
// delegating to game:createSave with the Daily's arc injected (integrator
// wires the arc injection + turn-1 skip when `dailyId` is present).
// ---------------------------------------------------------------------------
export const startDaily = mutationGeneric({
  args: { accountId, guestTokenHash },
  handler: async (ctx, args): Promise<{ saveId: string }> => {
    await loadAndAuthorizeAccount(ctx, args.accountId, args.guestTokenHash);

    const now = Date.now();
    const date = isoDateFromMillis(now);
    const daily = await ctx.db
      .query("daily_tales")
      .withIndex("by_date", (q: any) => q.eq("date", date))
      .first();
    if (!daily) throw new AppError("daily_not_available");

    const dailyId = String(daily._id);
    if (await hasPlayedDaily(ctx, dailyId, String(args.accountId))) {
      throw new AppError("daily_already_played");
    }

    // Create the reader's save for today's Daily. createSave lives in game.ts
    // (integrator-owned) — call it via the registered path. The integrator
    // widens createSave args (BC3) to accept `dailyId` and, when present,
    // injects the daily_tales storyArc (source:"daily") and SKIPS turn-1 arc
    // generation. `makeFunctionReference` is untyped, so passing `dailyId`
    // typechecks today without an `as any` cast at this site.
    const createSaveRef = makeFunctionReference<"mutation">("game:createSave");
    const result: { saveId: string } = await ctx.runMutation(createSaveRef, {
      accountId: args.accountId,
      ...(args.guestTokenHash ? { guestTokenHash: args.guestTokenHash } : {}),
      storyId: OPEN_STARTER_ID,
      mode: "story",
      dailyId,
      seedPremise: String(daily.premise),
      seedTitle: String(daily.title),
      seedTone: String(daily.tone),
    });

    // Analytics (fire-and-forget, R16.1).
    await insertDailyAnalytics(ctx, {
      eventName: "daily.started",
      accountId: String(args.accountId),
      saveId: result.saveId,
      payload: { dailyId, date },
      now,
    });

    return { saveId: result.saveId };
  },
});

// ---------------------------------------------------------------------------
// getResults (query) — design §7
//   {dailyId, accountId, guestTokenHash?} →
//     {yours: {endingId, label} | null,
//      distribution: [{endingId, label, count, pct, firstAccountName?}]}
// ---------------------------------------------------------------------------
export const getResults = queryGeneric({
  args: {
    dailyId: v.id("daily_tales"),
    accountId,
    guestTokenHash,
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    yours: { endingId: string; label: string } | null;
    distribution: DailyDistributionRow[];
    streak: StreakState;
  }> => {
    await loadAndAuthorizeAccount(ctx, args.accountId, args.guestTokenHash);

    const daily = await ctx.db.get(args.dailyId);
    const labelFor = endingLabelResolver(daily?.storyArc);

    const rows = await ctx.db
      .query("daily_results")
      .withIndex("by_daily", (q: any) => q.eq("dailyId", String(args.dailyId)))
      .collect();

    const results = rows.map((row: any) => ({
      endingId: String(row.endingId),
      accountId: String(row.accountId),
      finishedAt: typeof row.finishedAt === "number" ? row.finishedAt : 0,
    }));

    const distribution = computeDistribution(results, labelFor, anonymousReaderName);

    const mine = rows.find((row: any) => String(row.accountId) === String(args.accountId));
    const yours = mine
      ? { endingId: String(mine.endingId), label: labelFor(String(mine.endingId)) }
      : null;

    const streak = await readStreak(ctx, String(args.accountId));

    return { yours, distribution, streak };
  },
});

// ---------------------------------------------------------------------------
// getStreak (query) — Panel-2 W3 retention.
//   {accountId, guestTokenHash?} → {streak: {current, longest, lastDate},
//                                   keepsakes: [{id,label,description}]}
//
// The reader's consecutive-day Daily streak plus the milestone keepsakes it has
// minted (7/14/… day Embers). Keepsakes are account-scoped and survive
// guest→account claim in place (R13.4). Zeroed streak + empty keepsakes when no
// record exists.
// ---------------------------------------------------------------------------
export const getStreak = queryGeneric({
  args: { accountId, guestTokenHash },
  handler: async (
    ctx,
    args,
  ): Promise<{ streak: StreakState; keepsakes: Keepsake[] }> => {
    await loadAndAuthorizeAccount(ctx, args.accountId, args.guestTokenHash);
    const record = await loadStreakRecord(ctx, String(args.accountId));
    return {
      streak: record ? streakStateFromRow(record) : emptyStreak(),
      keepsakes: record ? readStreakKeepsakes(record) : [],
    };
  },
});

// ---------------------------------------------------------------------------
// mintDailyTale (internalAction) — design §6. Cron `mint-daily-tale` (00:05
// UTC) calls this. Builds the deterministic premise, makes ONE router LLM call
// for the storyArc (deterministic fallback arc on failure), runs the all-ages
// policy check, and inserts `daily_tales` idempotently per date.
// ---------------------------------------------------------------------------
export const mintDailyTale = internalActionGeneric({
  args: {
    // Optional override for backfills/tests; defaults to today (UTC).
    date: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ minted: boolean; dailyId: string; source: "llm" | "synthesized" | "existing" }> => {
    const now = Date.now();
    const date = (args.date ?? isoDateFromMillis(now)).trim();

    // Idempotency probe (design §6): skip if today's row already exists.
    const findRef = makeFunctionReference<"query">("dailyFunctions:findDailyByDate");
    const existing: { dailyId: string } | null = await ctx.runQuery(findRef, { date });
    if (existing) {
      return { minted: false, dailyId: existing.dailyId, source: "existing" };
    }

    const { premise, tone, title } = buildDailyPremise(date);

    const { LlmRouter } = await import("./llm/router");
    const router = new LlmRouter();
    const authored = await authorDailyStoryArc({
      date,
      premise,
      tone,
      title,
      router,
      context: ALL_AGES_CONTEXT,
    });

    const insertRef = makeFunctionReference<"mutation">("dailyFunctions:insertDailyTaleRow");
    const inserted: { dailyId: string } = await ctx.runMutation(insertRef, {
      date,
      premise,
      tone,
      title,
      storyArc: authored.storyArc as unknown,
      createdAt: now,
    });

    return { minted: true, dailyId: inserted.dailyId, source: authored.source };
  },
});

/**
 * Author the Daily's storyArc with ONE router call and a deterministic fallback
 * (design §6). Extracted + exported so tests can drive it with a fake router
 * (LLM success, malformed output → fallback, thrown error → fallback) without
 * the convex action runtime. The stored arc is stamped `source:"daily"` so
 * every reader's injected save reads as a Daily (design §1.1). The `source`
 * return value reports AUTHORSHIP (llm vs synthesized) for analytics/logging.
 */
export async function authorDailyStoryArc(input: {
  date: string;
  premise: string;
  tone: string;
  title: string;
  router: { generateScene: (req: SceneGenerationRequest) => Promise<RouterResult> };
  context: ContentPolicyContext;
}): Promise<{ storyArc: StoryArc; source: "llm" | "synthesized" }> {
  const fallback = (): { storyArc: StoryArc; source: "synthesized" } => ({
    storyArc: { ...synthesizeFallbackArc(input.premise, input.title), source: "daily" },
    source: "synthesized",
  });

  try {
    const request: SceneGenerationRequest = {
      saveId: `daily:${input.date}`,
      storyId: OPEN_STARTER_ID,
      storyTitle: input.title,
      storyTone: input.tone,
      premise: input.premise,
      turnNumber: 0,
      nodeId: "start",
      seed: input.premise,
      memory: [],
      choices: [],
      sceneLength: "standard",
      contentContext: input.context,
      risk: "normal",
      entitlementTier: "free",
      retryCount: 0,
      mode: "llm-driven",
      produceArc: true,
    };
    const result = await input.router.generateScene(request);
    const validated = validateProposedArc(result.parsed.proposal?.storyArc);
    if (!validated) return fallback();
    if (!arcTextIsAllAges(validated, input.context)) return fallback();
    return { storyArc: { ...validated, source: "daily" }, source: "llm" };
  } catch {
    return fallback();
  }
}

/**
 * All-ages gate for an authored arc (R13.5 / R16.2): every reader-visible arc
 * string must classify `allow`. A single non-allow verdict rejects the arc and
 * the caller falls back to the deterministic (safe-by-construction) arc — never
 * a mint failure.
 */
function arcTextIsAllAges(arc: StoryArc, context: ContentPolicyContext): boolean {
  const strings = [
    arc.dramaticQuestion,
    arc.protagonistWant,
    arc.stakes,
    ...arc.beats.map((b) => b.label),
    ...arc.candidateEndings.map((c) => c.label),
    ...arc.candidateEndings.map((c) => c.hint),
  ];
  for (const text of strings) {
    if (!text) continue;
    if (evaluateTextPolicy({ text, context }).action !== "allow") return false;
  }
  return true;
}

/** Internal: locate today's Daily row (idempotency probe from the action). */
export const findDailyByDate = internalQueryGeneric({
  args: { date: v.string() },
  handler: async (ctx, args): Promise<{ dailyId: string } | null> => {
    const row = await ctx.db
      .query("daily_tales")
      .withIndex("by_date", (q: any) => q.eq("date", args.date))
      .first();
    return row ? { dailyId: String(row._id) } : null;
  },
});

/**
 * Internal: idempotent `daily_tales` insert. Re-checks `by_date` inside the
 * mutation (atomic) so two concurrent cron runs can't double-insert a day.
 */
export const insertDailyTaleRow = internalMutationGeneric({
  args: {
    date: v.string(),
    premise: v.string(),
    tone: v.string(),
    title: v.string(),
    storyArc: v.any(),
    createdAt: v.number(),
  },
  handler: async (ctx, args): Promise<{ dailyId: string }> => {
    const existing = await ctx.db
      .query("daily_tales")
      .withIndex("by_date", (q: any) => q.eq("date", args.date))
      .first();
    if (existing) return { dailyId: String(existing._id) };

    const id = await ctx.db.insert(
      "daily_tales",
      cleanDoc({
        date: args.date,
        premise: args.premise,
        tone: args.tone,
        title: args.title,
        storyArc: args.storyArc,
        createdAt: args.createdAt,
      }),
    );
    return { dailyId: String(id) };
  },
});

// ---------------------------------------------------------------------------
// Terminal hook (W3-D3, R13.3). The integrator calls this from the game.ts
// terminal block (RESERVED — do NOT edit game.ts) when an accepted terminal
// lands on a save carrying `dailyId`. Idempotent per (accountId, dailyId).
// Exported as a plain helper (not a registered function) so game.ts imports it
// directly. Emits `daily.finished` analytics fire-and-forget.
// ---------------------------------------------------------------------------
export async function insertDailyResultIfAbsent(
  ctx: StreakCtx & {
    db: {
      query: (table: string) => any;
      insert: (table: string, doc: any) => Promise<any>;
    };
  },
  input: {
    dailyId: string;
    accountId: string;
    endingId: string;
    turnCount: number;
    finishedAt: number;
  },
): Promise<{ inserted: boolean; resultId?: string; streakMintedKeepsakeId?: string }> {
  const existing = await ctx.db
    .query("daily_results")
    .withIndex("by_daily_account", (q: any) =>
      q.eq("dailyId", input.dailyId).eq("accountId", input.accountId),
    )
    .first();
  if (existing) return { inserted: false, resultId: String(existing._id) };

  const row = buildDailyResultRow(input);
  const resultId = await ctx.db.insert("daily_results", cleanDoc(row));

  await insertDailyAnalytics(ctx as any, {
    eventName: "daily.finished",
    accountId: input.accountId,
    payload: { dailyId: input.dailyId, endingId: input.endingId, turnCount: row.turnCount },
    now: input.finishedAt,
  });

  // Panel-2 W3: advance the consecutive-day streak and mint a milestone keepsake
  // (7/14/… days). Runs only on a fresh result insert, so it is exactly-once per
  // (account, daily) — the same choke point as the result row itself.
  const streakOutcome = await advanceStreakForCompletion(ctx, {
    accountId: input.accountId,
    dailyId: input.dailyId,
    finishedAt: input.finishedAt,
  });

  return {
    inserted: true,
    resultId: String(resultId),
    ...(streakOutcome.mintedKeepsake ? { streakMintedKeepsakeId: streakOutcome.mintedKeepsake.id } : {}),
  };
}

// ---------------------------------------------------------------------------
// Streak persistence (Panel-2 W3). The `daily_streaks` table is one row per
// account (by_account index). All shape/date logic lives in the pure `daily.ts`
// helpers; this layer is just the DB read/write + keepsake dedupe + analytics.
// The row is account-scoped, so guest→account claim (an in-place account
// upgrade — same _id) carries the streak and its keepsakes across for free
// (R13.4); no reassignment step is needed.
// ---------------------------------------------------------------------------

/** The db surface the streak helpers need — a superset of the result-insert ctx. */
type StreakCtx = {
  db: {
    query: (table: string) => any;
    insert: (table: string, doc: any) => Promise<any>;
    patch?: (id: any, doc: any) => Promise<any>;
    get?: (id: any) => Promise<any>;
  };
};

type StreakRow = {
  _id: string;
  accountId: string;
  current: number;
  longest: number;
  lastDate: string;
  keepsakes?: Keepsake[];
  updatedAt?: number;
};

/** Project the mutable streak fields off a raw row (defensive number coercion). */
function streakStateFromRow(row: StreakRow): StreakState {
  return {
    current: Number.isFinite(row.current) ? row.current : 0,
    longest: Number.isFinite(row.longest) ? row.longest : 0,
    lastDate: typeof row.lastDate === "string" ? row.lastDate : "",
  };
}

/** The milestone keepsakes minted onto a streak row (never null). */
function readStreakKeepsakes(row: StreakRow): Keepsake[] {
  return Array.isArray(row.keepsakes) ? row.keepsakes : [];
}

/** Load the account's single `daily_streaks` row (or null). */
async function loadStreakRecord(
  ctx: { db: { query: (table: string) => any } },
  accountIdValue: string,
): Promise<StreakRow | null> {
  const row = await ctx.db
    .query("daily_streaks")
    .withIndex("by_account", (q: any) => q.eq("accountId", accountIdValue))
    .first();
  return (row as StreakRow | null) ?? null;
}

/** Read the account's streak as a zeroed-when-absent projection. */
async function readStreak(
  ctx: { db: { query: (table: string) => any } },
  accountIdValue: string,
): Promise<StreakState> {
  const row = await loadStreakRecord(ctx, accountIdValue);
  return row ? streakStateFromRow(row) : emptyStreak();
}

/**
 * Fold a completion into the account's streak row: read prior state, advance it
 * (pure), mint a milestone keepsake when a new day pushes current to a 7-day
 * multiple, then upsert. The completion's day is the Daily's own `date` when the
 * daily_tales row is reachable, else the UTC day of `finishedAt` — both are the
 * calendar day the reader finished on.
 */
async function advanceStreakForCompletion(
  ctx: StreakCtx,
  params: { accountId: string; dailyId: string; finishedAt: number },
): Promise<{ mintedKeepsake?: Keepsake }> {
  const date = await resolveCompletionDate(ctx, params.dailyId, params.finishedAt);

  const existing = await loadStreakRecord(ctx, params.accountId);
  const prev: StreakState | null = existing ? streakStateFromRow(existing) : null;
  const advance = advanceDailyStreak(prev, date);
  if (!advance.changed) return {};

  const ownedKeepsakes = existing ? readStreakKeepsakes(existing) : [];
  const candidate = advance.incremented ? streakKeepsake(advance.state.current) : null;
  let keepsakes = ownedKeepsakes;
  let mintedKeepsake: Keepsake | undefined;
  if (candidate && !ownedKeepsakes.some((k) => k.id === candidate.id)) {
    keepsakes = [...ownedKeepsakes, candidate];
    mintedKeepsake = candidate;
  }

  const doc = {
    accountId: params.accountId,
    current: advance.state.current,
    longest: advance.state.longest,
    lastDate: advance.state.lastDate,
    keepsakes,
    updatedAt: params.finishedAt,
  };

  if (existing && ctx.db.patch) {
    await ctx.db.patch(existing._id, cleanDoc(doc));
  } else if (!existing) {
    await ctx.db.insert("daily_streaks", cleanDoc(doc));
  }

  await insertDailyAnalytics(ctx as any, {
    eventName: "daily.streak_advanced",
    accountId: params.accountId,
    payload: {
      dailyId: params.dailyId,
      current: advance.state.current,
      longest: advance.state.longest,
    },
    now: params.finishedAt,
  });

  if (mintedKeepsake) {
    await insertDailyAnalytics(ctx as any, {
      eventName: KEEPSAKE_GRANTED,
      accountId: params.accountId,
      payload: {
        source: "daily_streak",
        keepsakeId: mintedKeepsake.id,
        streak: advance.state.current,
      },
      now: params.finishedAt,
    });
  }

  return mintedKeepsake ? { mintedKeepsake } : {};
}

/** The Daily's `date` (canonical streak day), falling back to the finish day. */
async function resolveCompletionDate(
  ctx: StreakCtx,
  dailyId: string,
  finishedAt: number,
): Promise<string> {
  if (ctx.db.get) {
    try {
      const daily = await ctx.db.get(dailyId);
      const date = daily?.date;
      if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    } catch {
      // fall through to the finish-time derivation
    }
  }
  return isoDateFromMillis(finishedAt);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * True when this account has already started/finished today's Daily — either a
 * `daily_results` row exists (finished) or a save carries this `dailyId`
 * (started). Both branches satisfy the one-per-day guard (R13.2).
 */
async function hasPlayedDaily(
  ctx: { db: { query: (table: string) => any } },
  dailyId: string,
  accountIdValue: string,
): Promise<boolean> {
  const result = await ctx.db
    .query("daily_results")
    .withIndex("by_daily_account", (q: any) =>
      q.eq("dailyId", dailyId).eq("accountId", accountIdValue),
    )
    .first();
  if (result) return true;

  const save = await ctx.db
    .query("saves")
    .withIndex("by_dailyId", (q: any) => q.eq("dailyId", dailyId))
    .filter((q: any) => q.eq(q.field("accountId"), accountIdValue))
    .first();
  return save !== null;
}

/**
 * Best-effort `analytics_events` insert (R16.1). Fire-and-forget: never blocks
 * or throws out of the caller. Mirrors game.ts:insertStoryAnalytics — the event
 * name is a free-form dotted string validated by the analytics builder.
 */
async function insertDailyAnalytics(
  ctx: { db: { insert: (table: string, doc: any) => Promise<any> } },
  input: {
    eventName: string;
    accountId?: string;
    saveId?: string;
    payload?: Record<string, unknown>;
    now: number;
  },
): Promise<void> {
  try {
    const { buildAnalyticsEvent } = await import("./analytics");
    await ctx.db.insert(
      "analytics_events",
      buildAnalyticsEvent({
        eventName: input.eventName as any,
        ...(input.accountId ? { accountId: input.accountId } : {}),
        ...(input.saveId ? { saveId: input.saveId } : {}),
        payload: input.payload ?? {},
        createdAt: input.now,
      }),
    );
  } catch {
    // analytics is advisory — swallow.
  }
}
