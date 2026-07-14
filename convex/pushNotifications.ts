// =============================================================================
// pushNotifications — SERVER half of the "candle re-lights" re-entry push.
//
// The CLIENT half (permission + token acquisition) lives in
// `apps/app/lib/pushNotifications.ts`; it calls `registerPushToken` here after
// obtaining the Expo push token (native only). This module owns:
//
//   pushNotifications:registerPushToken            mutation        (client)
//   pushNotifications:getAccountPushTokens         internalQuery
//   pushNotifications:removePushToken              internalMutation
//   pushNotifications:sendCandleRelightPush        internalAction
//   pushNotifications:selectGutteredCandleAccounts internalQuery
//   pushNotifications:notifyGutteredCandles        internalAction  (cron hook)
//
// Everything is TOLERANT: the send/notify paths never throw into a caller, a
// missing token is a silent no-op, and a dead device is pruned rather than
// surfaced. `fetch` runs only inside the action handlers (house rule).
//
// -----------------------------------------------------------------------------
// INTEGRATOR — schema.ts is integrator-reserved, so this module CODES AGAINST a
// new table the integrator must land. Add to `convex/schema.ts`:
//
//   // Expo push tokens for the "candle re-lights" re-entry nudge. One row per
//   // (device) token; a token re-points to whichever account last registered
//   // it. Absent for readers who never opted into push. Never reaches the
//   // client. Pruned when Expo reports DeviceNotRegistered.
//   push_tokens: defineTable({
//     accountId: v.id("accounts"),
//     token: v.string(),
//     platform: v.optional(v.union(v.literal("ios"), v.literal("android"))),
//     createdAt: v.number(),
//     updatedAt: v.number(),
//   })
//     .index("by_account", ["accountId"])
//     .index("by_token", ["token"]),
//
// INTEGRATOR — crons.ts is RESERVED. To fire the nudge when the daily candle
// re-lights (00:05 UTC, alongside `mint-daily-tale`), add ONE cron entry to
// `convex/crons.ts` (a minute after the mint so today's Daily exists first):
//
//   crons.daily(
//     "notify-guttered-candles",
//     { hourUTC: 0, minuteUTC: 6 },
//     makeFunctionReference<"action">("pushNotifications:notifyGutteredCandles"),
//     {},
//   );
// =============================================================================

import {
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  makeFunctionReference,
  mutationGeneric,
} from "convex/server";
import { v } from "convex/values";

import { cleanDoc } from "./lib/docs";
import { loadAndAuthorizeAccount } from "./lib/authz";

/** Expo's push service endpoint (batched, ≤100 messages per POST). */
export const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

/** Re-entry copy — mirrors the client-side local-notification stub defaults. */
export const CANDLE_RELIGHT_TITLE = "Your candle has re-lit";
export const CANDLE_RELIGHT_BODY = "The story is waiting where you left it.";

/** Android channel id — matches `apps/app/lib/pushNotifications.ts`. */
export const CANDLE_CHANNEL_ID = "candle-relights";

/** A save left untouched this long counts as a guttered candle. */
const GUTTER_IDLE_MS = 12 * 60 * 60 * 1000;
/** Cap accounts notified per cron run (bounds the fan-out cost). */
const DEFAULT_NOTIFY_LIMIT = 200;
/** Cap active-save rows scanned per selection pass. */
const DEFAULT_SCAN_LIMIT = 1000;
/** Expo caps a single POST at 100 messages. */
const EXPO_BATCH_SIZE = 100;

/** A single Expo push message (the subset of fields we send). */
export type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  sound: "default";
  channelId: string;
  priority: "high";
  data: Record<string, unknown>;
};

/**
 * True for a well-formed Expo push token (`ExponentPushToken[…]` /
 * `ExpoPushToken[…]`). Used to reject junk at registration AND to defend the
 * send path against a malformed stored value.
 */
export function isExpoPushToken(token: unknown): token is string {
  return (
    typeof token === "string" &&
    /^Expo(?:nent)?PushToken\[[^\]]+\]$/.test(token.trim())
  );
}

/** Split an array into fixed-size batches (last batch may be short). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Build the candle-relight Expo messages for a set of tokens (pure). Junk
 * tokens are filtered out. Title/body default to the re-entry copy.
 */
export function buildCandleRelightMessages(
  tokens: readonly string[],
  opts: { title?: string; body?: string; data?: Record<string, unknown> } = {},
): ExpoPushMessage[] {
  return tokens.filter(isExpoPushToken).map((to) => ({
    to: to.trim(),
    title: opts.title ?? CANDLE_RELIGHT_TITLE,
    body: opts.body ?? CANDLE_RELIGHT_BODY,
    sound: "default",
    channelId: CANDLE_CHANNEL_ID,
    priority: "high",
    data: { kind: "candle-relight", ...(opts.data ?? {}) },
  }));
}

/**
 * POST messages to Expo, TOLERANTLY. Never throws: a network error / non-2xx
 * marks the run not-ok but still returns. Returns the count Expo acknowledged
 * (`status:"ok"`) and any tokens Expo reported as `DeviceNotRegistered` (for
 * the caller to prune). `fetchImpl` is injectable for tests.
 */
export async function sendExpoPush(
  messages: readonly ExpoPushMessage[],
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<{ sent: number; invalidTokens: string[]; ok: boolean }> {
  if (messages.length === 0) return { sent: 0, invalidTokens: [], ok: true };
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const invalidTokens: string[] = [];
  let sent = 0;
  let ok = true;

  for (const batch of chunk(messages, EXPO_BATCH_SIZE)) {
    try {
      const res = await fetchImpl(EXPO_PUSH_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(batch),
      });
      if (!res.ok) {
        ok = false;
        continue;
      }
      const json = (await res.json().catch(() => null)) as {
        data?: Array<{ status?: string; details?: { error?: string } }>;
      } | null;
      const tickets = Array.isArray(json?.data) ? json.data : [];
      tickets.forEach((ticket, i) => {
        if (ticket?.status === "ok") {
          sent += 1;
          return;
        }
        if (ticket?.details?.error === "DeviceNotRegistered") {
          const to = batch[i]?.to;
          if (typeof to === "string") invalidTokens.push(to);
        }
      });
    } catch {
      // Network / abort / JSON error — advisory push, swallow and keep going.
      ok = false;
    }
  }

  return { sent, invalidTokens, ok };
}

// ---------------------------------------------------------------------------
// registerPushToken (mutation) — the client stores its Expo token here after
// acquiring it (native only). Authorized like every other session mutation.
// Tolerant on a malformed token (returns stored:false rather than throwing);
// an auth failure is a real error and still throws.
// ---------------------------------------------------------------------------
export const registerPushToken = mutationGeneric({
  args: {
    accountId: v.id("accounts"),
    guestTokenHash: v.optional(v.string()),
    token: v.string(),
    platform: v.optional(v.union(v.literal("ios"), v.literal("android"))),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ stored: boolean; reason: "created" | "updated" | "invalid_token" }> => {
    await loadAndAuthorizeAccount(ctx, args.accountId, args.guestTokenHash);

    const token = args.token.trim();
    if (!isExpoPushToken(token)) return { stored: false, reason: "invalid_token" };

    const now = Date.now();
    const existing = await ctx.db
      .query("push_tokens")
      .withIndex("by_token", (q: any) => q.eq("token", token))
      .first();

    if (existing) {
      // Re-point the device to whichever account last registered it (re-login
      // / account switch on the same handset).
      await ctx.db.patch(
        existing._id,
        cleanDoc({ accountId: args.accountId, platform: args.platform, updatedAt: now }),
      );
      return { stored: true, reason: "updated" };
    }

    await ctx.db.insert(
      "push_tokens",
      cleanDoc({
        accountId: args.accountId,
        token,
        platform: args.platform,
        createdAt: now,
        updatedAt: now,
      }),
    );
    return { stored: true, reason: "created" };
  },
});

// ---------------------------------------------------------------------------
// getAccountPushTokens (internalQuery) — an account's live, well-formed tokens.
// ---------------------------------------------------------------------------
export const getAccountPushTokens = internalQueryGeneric({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, args): Promise<{ tokens: string[] }> => {
    const rows = await ctx.db
      .query("push_tokens")
      .withIndex("by_account", (q: any) => q.eq("accountId", args.accountId))
      .collect();
    return { tokens: rows.map((r: any) => String(r.token)).filter(isExpoPushToken) };
  },
});

// ---------------------------------------------------------------------------
// removePushToken (internalMutation) — prune a token Expo flagged as dead.
// ---------------------------------------------------------------------------
export const removePushToken = internalMutationGeneric({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<{ removed: boolean }> => {
    const row = await ctx.db
      .query("push_tokens")
      .withIndex("by_token", (q: any) => q.eq("token", args.token))
      .first();
    if (!row) return { removed: false };
    await ctx.db.delete(row._id);
    return { removed: true };
  },
});

// ---------------------------------------------------------------------------
// sendCandleRelightPush (internalAction) — push the re-entry nudge to ONE
// account's stored token(s). Never throws into its caller. Dead tokens are
// pruned. No token → silent no-op.
// ---------------------------------------------------------------------------
export const sendCandleRelightPush = internalActionGeneric({
  args: {
    accountId: v.id("accounts"),
    title: v.optional(v.string()),
    body: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ sent: number; tokens: number }> => {
    try {
      const getRef = makeFunctionReference<"query">(
        "pushNotifications:getAccountPushTokens",
      );
      const { tokens }: { tokens: string[] } = await ctx.runQuery(getRef, {
        accountId: args.accountId,
      });
      if (!tokens || tokens.length === 0) return { sent: 0, tokens: 0 };

      const messages = buildCandleRelightMessages(tokens, {
        ...(args.title ? { title: args.title } : {}),
        ...(args.body ? { body: args.body } : {}),
        data: { accountId: String(args.accountId) },
      });

      const { sent, invalidTokens } = await sendExpoPush(messages);

      if (invalidTokens.length > 0) {
        const removeRef = makeFunctionReference<"mutation">(
          "pushNotifications:removePushToken",
        );
        for (const token of invalidTokens) {
          try {
            await ctx.runMutation(removeRef, { token });
          } catch {
            // pruning is best-effort
          }
        }
      }

      return { sent, tokens: tokens.length };
    } catch {
      return { sent: 0, tokens: 0 };
    }
  },
});

// ---------------------------------------------------------------------------
// selectGutteredCandleAccounts (internalQuery) — accounts with an active
// (unfinished) save that has gone idle past the gutter window AND a registered
// push token. Deduped, bounded. These are the readers whose candle guttered;
// the daily re-light is their re-entry moment.
// ---------------------------------------------------------------------------
export const selectGutteredCandleAccounts = internalQueryGeneric({
  args: {
    now: v.number(),
    idleMs: v.optional(v.number()),
    limit: v.optional(v.number()),
    scanLimit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ accountIds: string[] }> => {
    const idleMs = args.idleMs ?? GUTTER_IDLE_MS;
    const cutoff = args.now - idleMs;
    const limit = args.limit ?? DEFAULT_NOTIFY_LIMIT;
    const scanLimit = args.scanLimit ?? DEFAULT_SCAN_LIMIT;

    const saves = await ctx.db
      .query("saves")
      .withIndex("by_status", (q: any) => q.eq("status", "active"))
      .take(scanLimit);

    const seen = new Set<string>();
    const accountIds: string[] = [];

    for (const save of saves) {
      if (accountIds.length >= limit) break;
      const acctId = String(save.accountId);
      if (seen.has(acctId)) continue;
      seen.add(acctId);

      const account = await ctx.db.get(save.accountId);
      if (!account) continue;
      const lastActive =
        typeof account.lastActiveAt === "number" ? account.lastActiveAt : 0;
      // Still active inside the idle window → candle still lit, no nudge.
      if (lastActive > cutoff) continue;

      const token = await ctx.db
        .query("push_tokens")
        .withIndex("by_account", (q: any) => q.eq("accountId", save.accountId))
        .first();
      if (!token) continue;

      accountIds.push(acctId);
    }

    return { accountIds };
  },
});

// ---------------------------------------------------------------------------
// notifyGutteredCandles (internalAction) — the CRON HOOK. Selects guttered
// accounts and fans out `sendCandleRelightPush`. Never throws; a per-account
// failure is counted, not surfaced. Integrator wires this into crons.ts (see
// the header) at 00:06 UTC, a minute after `mint-daily-tale`.
// ---------------------------------------------------------------------------
export const notifyGutteredCandles = internalActionGeneric({
  args: {
    now: v.optional(v.number()),
    idleMs: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ notified: number; failed: number }> => {
    const now = args.now ?? Date.now();

    const selectRef = makeFunctionReference<"query">(
      "pushNotifications:selectGutteredCandleAccounts",
    );
    let accountIds: string[] = [];
    try {
      const res: { accountIds: string[] } = await ctx.runQuery(
        selectRef,
        cleanDoc({ now, idleMs: args.idleMs, limit: args.limit }),
      );
      accountIds = res?.accountIds ?? [];
    } catch {
      return { notified: 0, failed: 0 };
    }

    const sendRef = makeFunctionReference<"action">(
      "pushNotifications:sendCandleRelightPush",
    );
    let notified = 0;
    let failed = 0;
    for (const accountId of accountIds) {
      try {
        const res: { sent: number } = await ctx.runAction(sendRef, { accountId });
        if (res && res.sent > 0) notified += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }

    return { notified, failed };
  },
});
