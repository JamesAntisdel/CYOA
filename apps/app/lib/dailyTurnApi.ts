/**
 * Panel-2 Wave 2 — Daily *turn-budget* client transport + pure candle math
 * (panel-review-2 ranked ideas: "Real candle-state API" + "candle-gutter
 * interstitial").
 *
 * Distinct from `dailyApi.ts` (the shared Daily *Tale* of the day). This module
 * owns the per-reader daily *turn cap* state — how many turns the reader has
 * spent today, the included allowance for their tier, and when the candle
 * re-lights — that drives the in-reader burn meter and the candle-gutter
 * interstitial. Principle 7: the client must be able to SEE the burn before the
 * cap bites, so the reader is never surprised by a mid-scene paywall.
 *
 * BUILD CORRECTIONS honored (mirrors dailyApi.ts):
 *  - BC1: `DAILY_TURN_STATE_PATH` is the FULL registered path INCLUDING the
 *    directory-less module prefix. WAVE2-SERVER registers the query; if it
 *    lands under a different module the constant below is the single edit.
 *  - BC2: `convexHttp` casts, it does NOT validate — the server emits
 *    null-for-absent; the adapter maps those to safe client defaults and
 *    tolerates a missing / partially-populated projection (returns null → the
 *    meter and interstitial both self-hide).
 *  - BC4: `exactOptionalPropertyTypes` — optional props via conditional spread.
 *
 * Pure helpers import NOTHING from React Native so they are unit-testable under
 * vitest (`lib/__tests__/dailyTurnApi.test.ts`). Countdown formatting is reused
 * from `dailyApi` so the burn-reset label matches the Daily-card countdown.
 */
import { convexHttp } from "./convexHttp";
import { formatCountdown } from "./dailyApi";

/**
 * Full registered path for WAVE2-SERVER's per-reader daily turn-state query.
 * WAVE2-SERVER registered the projection in its own `dailyTurns.ts` module
 * (reads `daily_turn_counter` + `entitlements`), so the path is
 * `dailyTurns:getDailyTurnState`. If the server team moves it, change ONLY this
 * constant (BC1).
 */
export const DAILY_TURN_STATE_PATH = "dailyTurns:getDailyTurnState";

/** The burn fraction at/after which the reader sees the subtle candle meter. */
export const CANDLE_METER_THRESHOLD = 0.5;

// ---------------------------------------------------------------------------
// Wire shapes. Client-facing (adapted) first, then the raw server shape with
// null-for-absent that the adapter reconciles.
// ---------------------------------------------------------------------------

/** Adapted per-reader daily turn-budget state. */
export type RemoteDailyTurnState = {
  /** Turns the reader has spent today (>= 0). */
  turnsUsed: number;
  /**
   * Included daily allowance for the reader's tier. `0` means "unlimited" — a
   * paid tier with no daily cap; the meter and interstitial never show.
   */
  turnsAllowed: number;
  /** Epoch ms of the next candle re-light (next UTC midnight). */
  resetsAtUtc: number;
  /** True when the tier carries no daily cap (Patron / Magus). */
  unlimited: boolean;
};

/**
 * Raw server shape — the `dailyTurns:getDailyTurnState` projection
 * (DailyTurnStateProjection). `allowance` is either a numeric daily cap or the
 * literal string `"unlimited"` for a paid tier with no cap; `remaining` and
 * `tier` are carried for future use but the meter only needs used + allowance +
 * reset. Fields are typed nullable defensively so a truncated payload still
 * adapts to safe defaults.
 */
type ServerDailyTurnState = {
  turnsUsedToday: number | null;
  /** Numeric daily cap, or the literal "unlimited" (paid tier, no cap). */
  allowance: number | "unlimited" | null;
  remaining?: number | "unlimited" | null;
  resetsAtUtc: number | null;
  tier?: string | null;
};

// ---------------------------------------------------------------------------
// Adapter (exported for direct unit testing — BC2 null-mapping).
// ---------------------------------------------------------------------------

/**
 * Map the raw server value to the client turn-state model. Returns `null` when
 * the payload is missing/garbage so both the meter and the interstitial hide
 * (a reader we can't read turn-state for is never surprise-gated by our UI —
 * the server's own cap remains the real gate). An `unlimited` tier maps to
 * `turnsAllowed: 0, unlimited: true`.
 */
export function adaptDailyTurnState(
  raw: ServerDailyTurnState | null | undefined,
): RemoteDailyTurnState | null {
  if (!raw || typeof raw !== "object") return null;
  const turnsUsed =
    typeof raw.turnsUsedToday === "number" && raw.turnsUsedToday >= 0
      ? Math.floor(raw.turnsUsedToday)
      : 0;
  const rawAllowed = typeof raw.allowance === "number" ? Math.floor(raw.allowance) : 0;
  // Unlimited when the server sends the "unlimited" literal OR the numeric
  // allowance is absent / non-positive.
  const unlimited = raw.allowance === "unlimited" || rawAllowed <= 0;
  const turnsAllowed = unlimited ? 0 : rawAllowed;
  const resetsAtUtc =
    typeof raw.resetsAtUtc === "number" && raw.resetsAtUtc > 0 ? raw.resetsAtUtc : 0;
  return { turnsUsed, turnsAllowed, resetsAtUtc, unlimited };
}

/**
 * Fetch the reader's daily turn-budget state. Returns `null` when the backend
 * is unreachable OR the query isn't deployed yet — the caller then renders
 * neither the meter nor the interstitial (fail-open, never a phantom gate).
 */
export async function getRemoteDailyTurnState(input: {
  accountId: string;
  guestTokenHash?: string;
}): Promise<RemoteDailyTurnState | null> {
  const raw = await convexHttp<ServerDailyTurnState>(
    "query",
    DAILY_TURN_STATE_PATH,
    input as unknown as Record<string, unknown>,
  );
  return adaptDailyTurnState(raw);
}

// ---------------------------------------------------------------------------
// Pure candle model (burn fraction, meter/gutter gates, reset label).
// ---------------------------------------------------------------------------

export type CandleBurnModel = {
  /** Burn fraction 0..1 (turnsUsed / turnsAllowed), clamped. */
  fraction: number;
  /** Turns remaining before the cap bites (never negative). */
  remaining: number;
  /** Show the subtle in-reader meter (burn >= 50%, not unlimited, not guttered). */
  showMeter: boolean;
  /** The candle has guttered — today's turns are spent (turnsUsed >= allowed). */
  guttered: boolean;
  /** Human countdown to the next re-light, e.g. `7h 22m` / `3m 04s`. */
  resetsInLabel: string;
};

/**
 * Derive the candle model from turn-state + a clock. Pure so the meter/gutter
 * thresholds are unit-tested without the RN runtime. An `unlimited` (or null)
 * state never burns: no meter, never guttered.
 */
export function candleBurnModel(
  state: RemoteDailyTurnState | null | undefined,
  now: number,
): CandleBurnModel {
  const idle: CandleBurnModel = {
    fraction: 0,
    remaining: 0,
    showMeter: false,
    guttered: false,
    resetsInLabel: "",
  };
  if (!state || state.unlimited || state.turnsAllowed <= 0) return idle;
  const fraction = Math.min(1, Math.max(0, state.turnsUsed / state.turnsAllowed));
  const remaining = Math.max(0, state.turnsAllowed - state.turnsUsed);
  const guttered = state.turnsUsed >= state.turnsAllowed;
  const showMeter = !guttered && fraction >= CANDLE_METER_THRESHOLD;
  const resetsInLabel = state.resetsAtUtc > 0 ? formatCountdown(Math.max(0, state.resetsAtUtc - now)) : "";
  return { fraction, remaining, showMeter, guttered, resetsInLabel };
}
