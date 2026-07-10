/**
 * Story-engagement Wave 1 — pure client logic (design §4.1, §7).
 *
 * This module deliberately imports NOTHING from React Native. It holds the
 * boundary adapters (BC2: server null-for-absent → client optional) and the
 * derivation logic that the QuestLine / ThreadsPill / ChapterEnd / echo
 * surfaces render, so all of it is unit-testable via vitest without the RN
 * runtime (see `__tests__/storyEngagement.test.ts`).
 *
 * Types come from `gameApi.ts` (the wire contract) via `import type`, which is
 * fully erased at compile time — no runtime dependency on the convex client is
 * pulled into the test.
 */
import type {
  RemoteArc,
  RemoteChoice,
  RemoteRecentDiff,
} from "./gameApi";

// Proper Unicode minus (U+2212) so signed chips read as typographic minus,
// matching the design copy ("−1 ♥") rather than an ASCII hyphen.
const MINUS = "−";

export type EchoTone = "positive" | "neutral" | "negative";
export type DerivedEcho = { text: string; tone: EchoTone };

/** The neutral echo shown for a turn that produced no visible mechanical change. */
export const HIDDEN_ONLY_ECHO = "something shifted…";
/** Fallback echo for old turns with no diffs and no visible stats. */
export const NEUTRAL_ECHO = "the story remembered";

// ---------------------------------------------------------------------------
// Boundary adapters (BC2 / BC4): null-for-absent → optional.
// ---------------------------------------------------------------------------

/** Choice render-state model consumed by ChoiceList (visible vs locked). */
export type ChoiceRenderModel = {
  id: string;
  label: string;
  locked: boolean;
  hint?: string;
};

/**
 * Map a wire `RemoteChoice` to the client render-state model. Prefers the
 * §7 `state` field, falling back to the legacy `visibility` field so a
 * mixed-version rollout stays correct. `"hidden"` choices are the caller's
 * concern to filter out; here we only decide visible vs locked.
 */
export function adaptRemoteChoice(choice: RemoteChoice): ChoiceRenderModel {
  const gate = choice.state ?? choice.visibility;
  const locked = gate === "locked";
  const hint = choice.lockedHint ?? undefined;
  return {
    id: choice.choice.id,
    label: choice.choice.label,
    locked,
    ...(hint ? { hint } : {}),
  };
}

/** Normalize the wire arc (null-for-absent) into an optional client arc. */
export function adaptArc(raw: RemoteArc | null | undefined): RemoteArc | undefined {
  return raw ?? undefined;
}

/** Normalize the wire recentDiffs (null-for-absent) into an optional array. */
export function adaptRecentDiffs(
  raw: RemoteRecentDiff[] | null | undefined,
): RemoteRecentDiff[] | undefined {
  return raw ?? undefined;
}

// ---------------------------------------------------------------------------
// Small display helpers.
// ---------------------------------------------------------------------------

/** Signed integer string using a typographic minus for negatives. */
export function signed(delta: number): string {
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return `${MINUS}${Math.abs(delta)}`;
  return "0";
}

const ROMAN = ["I", "II", "III", "IV", "V"];
export function romanAct(act: number): string {
  if (act < 1) return "I";
  if (act <= ROMAN.length) return ROMAN[act - 1]!;
  return String(act);
}

/**
 * Filled/empty beat dots for the QuestLine strip, e.g. fired 2 of 4 → "●●○○".
 * Both counts are clamped to non-negative; fired is clamped to total.
 */
export function beatDots(fired: number, total: number): string {
  const t = Math.max(0, Math.floor(total));
  const f = Math.max(0, Math.min(t, Math.floor(fired)));
  return "●".repeat(f) + "○".repeat(t - f);
}

// ---------------------------------------------------------------------------
// Signed echo derivation (R5.2, design §4.1).
// ---------------------------------------------------------------------------

type Chip = { text: string; tone: EchoTone };

/**
 * Map one signed diff to a display chip. Returns null for kinds that carry no
 * reader-facing chip. `vitality` renders with the ♥ glyph per the design copy.
 */
export function diffToChip(diff: RemoteRecentDiff): Chip | null {
  switch (diff.kind) {
    case "stat": {
      const glyph = diff.statId === "vitality" ? "♥" : diff.label;
      const tone: EchoTone = diff.delta < 0 ? "negative" : diff.delta > 0 ? "positive" : "neutral";
      return { text: `${signed(diff.delta)} ${glyph}`, tone };
    }
    case "currency": {
      const tone: EchoTone = diff.delta < 0 ? "negative" : diff.delta > 0 ? "positive" : "neutral";
      return { text: `${signed(diff.delta)} coin`, tone };
    }
    case "item": {
      return diff.op === "add"
        ? { text: `+ ${diff.label}`, tone: "positive" }
        : { text: `${MINUS} ${diff.label}`, tone: "negative" };
    }
    case "thread": {
      return diff.op === "fired"
        ? { text: `🧵 ${diff.note ?? "echo returns"}`, tone: "neutral" }
        : { text: "🧵 thread set", tone: "neutral" };
    }
    case "beat": {
      return { text: `⭑ ${diff.label}`, tone: "positive" };
    }
    case "act": {
      return { text: `Act ${romanAct(diff.act)}`, tone: "positive" };
    }
    // --- W2 forward-compat: best-effort chips (W2-CLIENT refines) ---
    case "clock": {
      return { text: `🕯 ${signed(diff.amount)}`, tone: "negative" };
    }
    case "npc": {
      const arrow = diff.deltaBand === "up" ? "▴" : "▾";
      const tone: EchoTone = diff.deltaBand === "up" ? "positive" : "negative";
      return { text: `${diff.name} ${arrow}`, tone };
    }
    case "check": {
      const tone: EchoTone =
        diff.outcome === "success" ? "positive" : diff.outcome === "fail" ? "negative" : "neutral";
      return { text: diff.outcome, tone };
    }
    default:
      return null;
  }
}

function aggregateTone(chips: Chip[]): EchoTone {
  if (chips.some((c) => c.tone === "negative")) return "negative";
  if (chips.some((c) => c.tone === "positive")) return "positive";
  return "neutral";
}

/**
 * Derive the signed echo line for a turn.
 *
 *  - `diffs` undefined/null → OLD turn (no diff persistence): fall back to the
 *    visible-stat snapshot (legacy behavior), else the neutral echo.
 *  - `diffs` present but empty (or only unknown kinds) → a turn happened with
 *    no visible mechanical change → the hidden-only echo ("something shifted…").
 *  - otherwise → up to 3 signed chips joined by " · ".
 */
export function deriveSignedEcho(
  diffs: RemoteRecentDiff[] | null | undefined,
  fallbackStats?: ReadonlyArray<{ label: string; value: number }>,
): DerivedEcho {
  if (diffs == null) {
    const snapshot = (fallbackStats ?? []).slice(0, 2);
    if (snapshot.length === 0) return { text: NEUTRAL_ECHO, tone: "neutral" };
    return {
      text: snapshot.map((s) => `${s.label}: ${s.value}`).join(" · "),
      tone: "neutral",
    };
  }
  const chips = diffs.map(diffToChip).filter((c): c is Chip => c !== null);
  if (chips.length === 0) return { text: HIDDEN_ONLY_ECHO, tone: "neutral" };
  return {
    text: chips.slice(0, 3).map((c) => c.text).join(" · "),
    tone: aggregateTone(chips),
  };
}

// ---------------------------------------------------------------------------
// Threads + act-advance signals (design §4.1, W1-C5).
// ---------------------------------------------------------------------------

/** True when the turn's diffs include a fired Chekhov thread. */
export function threadFiredInDiffs(diffs: RemoteRecentDiff[] | null | undefined): boolean {
  return (diffs ?? []).some((d) => d.kind === "thread" && d.op === "fired");
}

export type ActStamp = { actNumber: number; actLabel?: string };

/**
 * Derive the ChapterEnd act stamp when the boundary turn advanced an act.
 * Returns null unless the diffs carry an `act_advanced` (`kind:"act"`) record.
 * The label (when known) rides on the arc summary, so we join them here.
 */
export function actStampFromDiffs(
  diffs: RemoteRecentDiff[] | null | undefined,
  arc: RemoteArc | null | undefined,
): ActStamp | null {
  const actDiff = (diffs ?? []).find(
    (d): d is Extract<RemoteRecentDiff, { kind: "act" }> => d.kind === "act",
  );
  if (!actDiff) return null;
  const label = arc?.actLabel ?? undefined;
  return { actNumber: actDiff.act, ...(label ? { actLabel: label } : {}) };
}
