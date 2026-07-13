// Client transport + pure view-logic for the reader-facing "Illuminate this
// page" surface (convex/media/illuminate.ts). Mirrors the shape of the other
// per-feature *Api.ts modules: a thin convexHttp wrapper plus the small pure
// helpers the <IlluminateButton> renders from (kept here so they can be
// unit-tested pure-Node without a transpiler).
//
// Product principle 7 ("pay for joy, not entry"): every function here decorates
// an ALREADY-RESOLVED scene. Nothing here can gate story or choice generation —
// the free text+still read never depends on it.

import { convexHttp as callConvexHttp } from "./convexHttp";

export type IlluminationKind = "still" | "cinematic";

/** Server view for the button + sheet (media/illuminate:getReaderIlluminationState). */
export type RemoteIlluminationState = {
  /** DB scenes id of the save's current page — fed straight into requestIllumination. */
  sceneId: string | null;
  /** True only when the page's prose has fully resolved (cosmetic guard). */
  resolved: boolean;
  /** Reader's current spark balance. */
  balance: number;
  costs: { still: number; cinematic: number };
  still: MediaSlot;
  cinematic: MediaSlot;
};

export type MediaSlot = {
  present: boolean;
  status?: "queued" | "generating" | "ready" | "blocked" | "failed";
  /** Ready still URL — the ALWAYS-FREE preview shown in the sheet. */
  url?: string;
};

export type IlluminationResult =
  | { status: "queued"; kind: IlluminationKind; assetId: string; sparksCharged: number; balanceAfter?: number; costSparks: number }
  | { status: "illuminated"; kind: IlluminationKind; assetId: string; alreadyPresent: true; sparksCharged: 0 }
  | { status: "insufficient_sparks"; kind: IlluminationKind; costSparks: number; balance: number; sparksCharged: 0 };

type Auth = { accountId: string; guestTokenHash?: string };

export async function getRemoteIlluminationState(
  input: Auth & { saveId: string },
): Promise<RemoteIlluminationState | null> {
  return callConvexHttp<RemoteIlluminationState>(
    "query",
    "media/illuminate:getReaderIlluminationState",
    input as unknown as Record<string, unknown>,
  );
}

export async function getRemoteSparkBalance(input: Auth): Promise<{ balance: number } | null> {
  return callConvexHttp<{ balance: number }>(
    "query",
    "media/illuminate:getSparkBalance",
    input as unknown as Record<string, unknown>,
  );
}

export async function requestRemoteIllumination(
  input: Auth & { saveId: string; sceneId: string; kind: IlluminationKind },
): Promise<IlluminationResult | null> {
  return callConvexHttp<IlluminationResult>(
    "mutation",
    "media/illuminate:requestIllumination",
    input as unknown as Record<string, unknown>,
  );
}

// --- Pure view-logic (unit-tested) -----------------------------------------

/** The candle affordance's visible state for a given illumination kind. */
export type CandleMode = "hidden" | "idle" | "queued" | "generating" | "illuminated";

/**
 * Derive the candle's mode from the server state. `hidden` when there is no
 * resolved page to light (the cosmetic guard) — the button renders nothing so
 * reading is never interrupted. `illuminated` once ready media is attached (the
 * button reads "illuminated" and no-ops). Pure.
 */
export function illuminateCandleMode(
  state: RemoteIlluminationState | null | undefined,
  kind: IlluminationKind,
): CandleMode {
  if (!state || !state.sceneId || !state.resolved) return "hidden";
  const slot = kind === "cinematic" ? state.cinematic : state.still;
  if (!slot.present) return "idle";
  if (slot.status === "ready") return "illuminated";
  if (slot.status === "generating") return "generating";
  if (slot.status === "blocked" || slot.status === "failed") return "idle";
  return "queued";
}

/** Whether a tap should open the confirm sheet (vs. no-op / stay hidden). */
export function candleIsTappable(mode: CandleMode): boolean {
  return mode === "idle";
}

/** The spark cost for a kind, read from the server-authoritative price card. */
export function illuminationCost(
  state: RemoteIlluminationState | null | undefined,
  kind: IlluminationKind,
): number {
  if (!state) return 0;
  return kind === "cinematic" ? state.costs.cinematic : state.costs.still;
}

/** Can the reader's balance cover this illumination? */
export function canAffordIllumination(
  state: RemoteIlluminationState | null | undefined,
  kind: IlluminationKind,
): boolean {
  if (!state) return false;
  return state.balance >= illuminationCost(state, kind);
}

// --- Copy in the tome voice -------------------------------------------------

/** Candle glyph — a lit flame when the page is (being) illuminated, a quiet
 * unlit candle when it merely can be. */
export function candleGlyph(mode: CandleMode): string {
  return mode === "idle" ? "🕯" : "🔥";
}

/** Accessible + visible label for the candle affordance, by mode. */
export function candleLabel(mode: CandleMode): string {
  switch (mode) {
    case "illuminated":
      return "This page is illuminated";
    case "generating":
      return "Illuminating this page…";
    case "queued":
      return "Illumination is kindling…";
    case "idle":
      return "Illuminate this page";
    default:
      return "";
  }
}

/** The sheet's confirm-line copy — "Set this page alight — N sparks". */
export function alightCopy(cost: number): string {
  return `Set this page alight — ${cost} ${cost === 1 ? "spark" : "sparks"}`;
}

/** Balance line for the sheet — "You hold N sparks". */
export function balanceCopy(balance: number): string {
  return `You hold ${balance} ${balance === 1 ? "spark" : "sparks"}`;
}
