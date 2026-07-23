// =============================================================================
// Act Mementos (act-mementos spec, R1–R2). Pure helpers + one plain mint helper
// for the "pressed between the pages" loop: crossing an act boundary
// (act 1→2, 2→3) mints a small, durable, account-scoped collectible derived
// deterministically from what the reader just lived through — the act number,
// the arc's `actLabel`, the fired beat, and the story title. No LLM call, no
// media.
//
// `deriveActMemento` is pure (no ctx, no Date.now) so it unit-tests cheaply and
// stays total — an absent `actLabel`/`beatLabel` falls back deterministically
// (AM2), it never waits for the label to arrive later. Text-policy
// (`evaluateTextPolicy`) is applied here against a CALLER-supplied policy
// context BEFORE persistence (R16.2 / R1.3) — the memento composes already-gated
// arc strings into NEW display text, so it gates again; a block degrades the
// offending string to neutral fallback text, never a mint failure.
//
// `mintActMementoIfDue` is an exported PLAIN helper (not a registered function),
// mirroring `dailyFunctions.insertDailyResultIfAbsent`: the reserved turn
// mutation (`game.ts`, RESERVED — see the integrator note in the task report)
// imports and calls it at the single live act-boundary site. It never throws out
// of itself (R1.5) — every failure degrades to "no memento, turn proceeds".
// =============================================================================

import type { ContentPolicyContext } from "@cyoa/shared";

import { evaluateTextPolicy } from "./contentPolicy";
import { cleanDoc } from "./lib/docs";

/** A minted act memento as it persists on a `mementos` row (integrator-owned table). */
export type Memento = {
  act: number;
  /** ≤80, policy-gated. "Act II — <actLabel>" | "Act II of <title>" fallback (AM2). */
  label: string;
  /** ≤160, policy-gated. The just-fired beat's label, else a fixed book-voice line. */
  description: string;
  storyTitle: string;
};

/** Analytics event name — fired when an act boundary grants a memento (R16.1). */
export const MEMENTO_GRANTED = "memento.granted";

/** Clamps per design §1.2: label ≤80, description ≤160. */
const LABEL_MAX = 80;
const DESCRIPTION_MAX = 160;

/** Fixed book-voice line used when no fired-beat label is available (R1.1). */
const DESCRIPTION_FALLBACK = "A page pressed between the chapters — proof you passed this way.";
/** Last-resort story title when the run carries none (keeps derivation total). */
const STORY_TITLE_FALLBACK = "an untold tale";

/**
 * Roman numerals matching ChapterEnd's `actRoman`
 * (`apps/app/components/reading/ChapterEnd.tsx:32-37`): out-of-range low → "I",
 * 1..5 map to the table, higher → the plain number. Kept in lockstep so the
 * memento label reads the same act numeral the ChapterEnd stamp shows.
 */
const ACT_ROMAN = ["I", "II", "III", "IV", "V"];
function actRoman(n: number): string {
  if (!Number.isFinite(n) || n < 1) return "I";
  const i = Math.floor(n);
  if (i <= ACT_ROMAN.length) return ACT_ROMAN[i - 1]!;
  return String(i);
}

function clampLen(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Deterministic + total act-memento derivation (R1.1 / AM2). Labels are optional
 * at mint time — the act stamp joins `arc.actLabel` opportunistically, so this
 * MUST derive with the label absent and never re-mint when it arrives later:
 *   - `label`: "Act <roman> — <actLabel>" when the arc label is present, else the
 *     "Act <roman> of <storyTitle>" fallback.
 *   - `description`: the most recently fired beat's label when available, else a
 *     fixed book-voice line.
 * Both are clamped (label ≤80, description ≤160); the story title falls back to a
 * stable phrase rather than an empty string.
 */
export function deriveActMemento(input: {
  act: number;
  actLabel?: string;
  beatLabel?: string;
  storyTitle: string;
}): Memento {
  const act = Number.isFinite(input.act) ? Math.floor(input.act) : 1;
  const roman = actRoman(act);
  const storyTitle = asTrimmedString(input.storyTitle) || STORY_TITLE_FALLBACK;
  const actLabel = asTrimmedString(input.actLabel);
  const label = clampLen(
    actLabel.length > 0 ? `Act ${roman} — ${actLabel}` : `Act ${roman} of ${storyTitle}`,
    LABEL_MAX,
  );
  const beatLabel = asTrimmedString(input.beatLabel);
  const description = clampLen(beatLabel.length > 0 ? beatLabel : DESCRIPTION_FALLBACK, DESCRIPTION_MAX);
  return { act, label, description, storyTitle };
}

/** Only `action: "allow"` persists the composed string; anything else → fallback (R1.3). */
function policyAllows(text: string, context: ContentPolicyContext): boolean {
  try {
    return evaluateTextPolicy({ text, context }).action === "allow";
  } catch {
    // A policy failure is treated as a block — the neutral fallback still persists.
    return false;
  }
}

/** The db surface the mint helper needs — a subset of the turn mutation's ctx. */
export type MementoMintCtx = {
  db: {
    query: (table: string) => any;
    insert: (table: string, doc: any) => Promise<any>;
  };
};

/**
 * Mint one act memento when a turn crosses an act boundary (R1.1–R1.5, R2.1).
 * Best-effort and idempotent — called from the reserved turn mutation at the
 * single live act-boundary site with the arc, fired-beat label, and story title
 * already in scope. Contract:
 *   - no arc / authored (non-llm) / co-op follower / act < 2 ⇒ no-op (R1.4).
 *   - `by_save_act(saveId, act)` already present ⇒ no-op; the original row
 *     survives a rewind re-cross (R1.2 / R2.1).
 *   - `deriveActMemento` composes the label/description (AM2 fallbacks).
 *   - each string is policy-gated against `policyContext`; a block degrades it to
 *     neutral fallback text, never a mint failure (R1.3).
 *   - the row is inserted via `cleanDoc` (BC4); `memento.granted` fires
 *     fire-and-forget (AM4).
 *   - EVERY failure is swallowed — the helper never throws out of itself (R1.5),
 *     so a race, a missing table, or a policy error leaves the turn untouched.
 */
export async function mintActMementoIfDue(
  ctx: MementoMintCtx,
  input: {
    accountId: string;
    saveId: string;
    storyId: string;
    /** The act ENTERED (2 or 3 today), read off the `act_advanced` diff. */
    act: number;
    /** The save's arc; `null`/absent ⇒ arc-less/legacy save ⇒ no-op (R1.4). */
    arc?: { actLabel?: string } | null;
    /** The most recently fired beat's label, when the same turn fired one. */
    firedBeatLabel?: string;
    storyTitle: string;
    /** Present only when the run is a Daily. */
    dailyId?: string;
    /** Authored (non-llm) save ⇒ no-op (R1.4). */
    isAuthored?: boolean;
    /** Co-op follower client ⇒ no-op (R1.4). */
    isFollower?: boolean;
    /** Caller-built content policy context for the reader (R1.3). */
    policyContext: ContentPolicyContext;
    now: number;
  },
): Promise<{ minted: boolean; mementoId?: string }> {
  try {
    // R1.4 — arc-less / authored / follower saves behave exactly as today.
    if (!input.arc) return { minted: false };
    if (input.isAuthored) return { minted: false };
    if (input.isFollower) return { minted: false };

    // The act ENTERED is 2 or 3; anything below is not a real crossing.
    const act = Number.isFinite(input.act) ? Math.floor(input.act) : 0;
    if (act < 2) return { minted: false };

    // R1.2 — idempotent per (saveId, act). A rewind that re-crosses the same
    // boundary hits the existing row and no-ops; the original survives.
    const existing = await ctx.db
      .query("mementos")
      .withIndex("by_save_act", (q: any) => q.eq("saveId", input.saveId).eq("act", act))
      .first();
    if (existing) return { minted: false, mementoId: String(existing._id) };

    // AM2 — total derivation; the neutral variant (no arc/beat labels) is the
    // policy fallback source.
    const derived = deriveActMemento({
      act,
      ...(input.arc.actLabel !== undefined ? { actLabel: input.arc.actLabel } : {}),
      ...(input.firedBeatLabel !== undefined ? { beatLabel: input.firedBeatLabel } : {}),
      storyTitle: input.storyTitle,
    });
    const neutral = deriveActMemento({ act, storyTitle: input.storyTitle });

    // R1.3 — gate each composed string; a block degrades to neutral text (and if
    // even that is blocked, to a bare act numeral / the fixed book-voice line).
    const label = policyAllows(derived.label, input.policyContext)
      ? derived.label
      : policyAllows(neutral.label, input.policyContext)
        ? neutral.label
        : `Act ${actRoman(act)}`;
    const description = policyAllows(derived.description, input.policyContext)
      ? derived.description
      : DESCRIPTION_FALLBACK;

    const mementoId = await ctx.db.insert(
      "mementos",
      cleanDoc({
        accountId: input.accountId,
        saveId: input.saveId,
        storyId: input.storyId,
        act,
        label,
        description,
        storyTitle: derived.storyTitle,
        dailyId: input.dailyId,
        createdAt: input.now,
      }),
    );

    // AM4 / R1.5 — analytics is fire-and-forget; it never blocks or fails a mint.
    await insertMementoAnalytics(ctx, {
      accountId: input.accountId,
      saveId: input.saveId,
      storyId: input.storyId,
      act,
      ...(input.dailyId !== undefined ? { dailyId: input.dailyId } : {}),
      now: input.now,
    });

    return { minted: true, mementoId: String(mementoId) };
  } catch {
    // R1.5 — minting is best-effort; any failure degrades to no memento and the
    // turn proceeds untouched.
    return { minted: false };
  }
}

/**
 * Best-effort `analytics_events` insert for `memento.granted` (R16.1). Mirrors
 * `dailyFunctions.insertDailyAnalytics` — fire-and-forget, never throws out of
 * the caller. Payload carries `storyId`, `act`, and `dailyId?` (design §5);
 * `accountId`/`saveId` ride the top-level id fields.
 */
async function insertMementoAnalytics(
  ctx: { db: { insert: (table: string, doc: any) => Promise<any> } },
  input: {
    accountId: string;
    saveId: string;
    storyId: string;
    act: number;
    dailyId?: string;
    now: number;
  },
): Promise<void> {
  try {
    const { buildAnalyticsEvent } = await import("./analytics");
    await ctx.db.insert(
      "analytics_events",
      buildAnalyticsEvent({
        eventName: MEMENTO_GRANTED as any,
        accountId: input.accountId,
        saveId: input.saveId,
        payload: {
          storyId: input.storyId,
          act: input.act,
          ...(input.dailyId !== undefined ? { dailyId: input.dailyId } : {}),
        },
        createdAt: input.now,
      }),
    );
  } catch {
    // analytics is advisory — swallow.
  }
}
