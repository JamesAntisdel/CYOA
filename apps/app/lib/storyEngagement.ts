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
  RemoteCheck,
  RemoteChoice,
  RemoteCodexEntry,
  RemoteDoorsJournalEntry,
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
  /** W2 skill-check descriptor (odds phrase only — BC10). Absent when none. */
  check?: RemoteCheck;
  /** Near-miss band on a locked numeric gate (phrase only — BC10). */
  nearness?: "near" | "far";
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
  const check = choice.check ?? undefined;
  const nearness = choice.nearness ?? undefined;
  return {
    id: choice.choice.id,
    label: choice.choice.label,
    locked,
    ...(hint ? { hint } : {}),
    // A locked choice never shows its check chip — the door isn't open, so the
    // odds are moot. Keeps the two W2/W1 affordances from stacking on one card.
    ...(check && !locked ? { check } : {}),
    // The near-miss band is only meaningful on a still-locked door.
    ...(nearness && locked ? { nearness } : {}),
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
    // --- W2 chips (design §4.2) ---
    case "clock": {
      // The doom-clock advanced. The reason string (server-authored, ≤80) is
      // the reader-facing copy; fall back to a neutral escalation line so a
      // reason-less advance still narrates. Always the negative tone — the
      // candle burning down is pressure, never a gain.
      const reason = diff.reason?.trim();
      return { text: `🕯 ${reason && reason.length > 0 ? reason : "the hour presses on"}`, tone: "negative" };
    }
    case "npc": {
      // A relationship moved OR the NPC learned a fact. A fact ("Mira will
      // remember that") reads warmer/heavier than a bare disposition tick, so
      // when both ride on one diff we surface the fact line and keep the arrow
      // in the a11y-neutral tone; a pure disposition shift shows the band word.
      if (diff.fact && diff.fact.trim().length > 0) {
        return { text: `${diff.name} will remember that`, tone: "neutral" };
      }
      // A pure disposition shift carries a band; a fact-only diff omits it
      // (server types deltaBand as optional). With neither, there's nothing
      // reader-facing to chip.
      if (!diff.deltaBand) return null;
      const arrow = trendArrow(diff.deltaBand);
      const tone: EchoTone = diff.deltaBand === "up" ? "positive" : "negative";
      return { text: `${diff.name} ${arrow} ${dispositionBandWord(diff.deltaBand)}`, tone };
    }
    case "check": {
      // Short echo stamp for the resolved check. The fuller CheckBanner (with
      // the margin phrase + dice roll) is the primary surface; this chip just
      // records the outcome in the running echo line. The stat is NOT named
      // here (the diff only carries statId, not a label).
      const tone: EchoTone =
        diff.outcome === "success" ? "positive" : diff.outcome === "fail" ? "negative" : "neutral";
      return { text: `⚄ ${checkOutcomeWord(diff.outcome)}`, tone };
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

// ---------------------------------------------------------------------------
// W2-C1 — Skill checks: CheckChip label + post-turn CheckBanner (design §4.2).
// ---------------------------------------------------------------------------

/** The die glyph the CheckChip / CheckBanner lead with. */
export const CHECK_DIE_GLYPH = "⚄";

export type CheckOutcome = "success" | "partial" | "fail";

/**
 * The CheckChip label shown on a choice card, e.g. `⚄ Nerve — risky`. Built
 * from the server-projected ODDS PHRASE only — the client never sees the stat
 * total, roll, or threshold (BC10). Uses an em dash to match the book voice.
 */
export function checkChipLabel(check: RemoteCheck): string {
  return `${CHECK_DIE_GLYPH} ${check.label} — ${check.odds}`;
}

/**
 * A11y label for the CheckChip — spells out that this is a gamble on the given
 * stat and how the odds read, without any raw numbers.
 */
export function checkChipAccessibilityLabel(check: RemoteCheck): string {
  return `Skill check on ${check.label}. Your odds: ${check.odds}.`;
}

/** One short in-world word per outcome for the running echo chip. */
export function checkOutcomeWord(outcome: CheckOutcome): string {
  switch (outcome) {
    case "success":
      return "cleared";
    case "partial":
      return "strained";
    case "fail":
      return "failed";
  }
}

export type CheckBannerModel = {
  outcome: CheckOutcome;
  /** Short stamp word: "Success" / "Partial" / "Failed". */
  stamp: string;
  /** In-world margin phrase, e.g. "and barely" or "with room to spare". */
  phrase: string;
  tone: EchoTone;
};

/**
 * Map a resolved-check diff to the CheckBanner display model. `margin` is the
 * signed distance past/short of the threshold the server surfaces (still not
 * the raw roll — it's the outcome margin). We translate its magnitude into an
 * in-world phrase rather than showing the number, keeping BC10 spoiler
 * discipline (no visible check math).
 */
export function checkBannerModel(diff: {
  outcome: CheckOutcome;
  statId: string;
  margin: number;
}): CheckBannerModel {
  const magnitude = Math.abs(diff.margin);
  const close = magnitude <= 1;
  let stamp: string;
  let phrase: string;
  let tone: EchoTone;
  switch (diff.outcome) {
    case "success":
      stamp = "Success";
      phrase = close ? "by a hair" : "with room to spare";
      tone = "positive";
      break;
    case "partial":
      stamp = "Partial";
      phrase = "at a cost";
      tone = "neutral";
      break;
    case "fail":
      stamp = "Failed";
      phrase = close ? "by a hair" : "outright";
      tone = "negative";
      break;
  }
  return { outcome: diff.outcome, stamp, phrase, tone };
}

/**
 * Extract the resolved-check record from a turn's diffs, if any. Drives the
 * post-turn CheckBanner (which shows on the scene that FOLLOWS the checked
 * choice — the outcome diff rides that scene's recentDiffs, per design §4.2).
 */
export function checkResultFromDiffs(
  diffs: RemoteRecentDiff[] | null | undefined,
): { outcome: CheckOutcome; statId: string; margin: number } | null {
  const found = (diffs ?? []).find(
    (d): d is Extract<RemoteRecentDiff, { kind: "check" }> => d.kind === "check",
  );
  if (!found) return null;
  return { outcome: found.outcome, statId: found.statId, margin: found.margin };
}

// ---------------------------------------------------------------------------
// W2-C2 — CandleClock segment math (design §4.2, R9.4).
// ---------------------------------------------------------------------------

/** Fraction (0–1) at/above which the doom-clock shows a lit flame. */
export const CANDLE_FLAME_THRESHOLD = 0.75;

export type CandleModel = {
  /** Segments already burned down (value). */
  filled: number;
  /** Segments still standing (max − value). */
  empty: number;
  /** Total segments (clamped max). */
  total: number;
  /** Burn fraction 0–1. */
  pct: number;
  /** True at ≥75% — the inline flame lights and the prose escalates. */
  flame: boolean;
};

/**
 * Compute the segmented-candle model from a clock's value/max. Both are
 * clamped non-negative; value is clamped to max; a zero/absent max yields an
 * empty, flame-less candle (never divides by zero). The candle renders one
 * segment per unit of `max` so the reader can count the pressure directly.
 */
export function candleSegments(value: number, max: number): CandleModel {
  const total = Math.max(0, Math.floor(max));
  const filled = Math.max(0, Math.min(total, Math.floor(value)));
  const empty = total - filled;
  const pct = total === 0 ? 0 : filled / total;
  return { filled, empty, total, pct, flame: total > 0 && pct >= CANDLE_FLAME_THRESHOLD };
}

/** Burned/standing candle glyphs, e.g. value 3 of 4 → "▮▮▮▯". */
export function candleBar(value: number, max: number): string {
  const { filled, empty } = candleSegments(value, max);
  return "▮".repeat(filled) + "▯".repeat(empty);
}

// ---------------------------------------------------------------------------
// W2-C3 — NPC disposition band words + roster trend arrows (design §4.2, R8.3).
// ---------------------------------------------------------------------------

/**
 * Turn a disposition delta BAND (the only directional signal in the npc diff —
 * §7 gives us `up`/`down`, never the raw disposition value) into an in-world
 * mood word for the echo chip.
 */
export function dispositionBandWord(band: "up" | "down"): string {
  return band === "up" ? "warmer" : "cooler";
}

/** ▴ / ▾ trend arrow for a roster row from a disposition band. */
export function trendArrow(band: "up" | "down"): string {
  return band === "up" ? "▴" : "▾";
}

/**
 * Build a per-NPC trend map from a turn's diffs so the roster can mark which
 * cast members moved (and which way) THIS turn. Later diffs win when the same
 * NPC appears twice (the net latest direction). NPC diffs that only carry a
 * learned fact (no disposition move) are ignored for the arrow.
 */
export function npcTrendsFromDiffs(
  diffs: RemoteRecentDiff[] | null | undefined,
): Record<string, "up" | "down"> {
  const out: Record<string, "up" | "down"> = {};
  for (const d of diffs ?? []) {
    // Only a genuine disposition move carries a band; fact-only npc diffs omit
    // `deltaBand` (server types it optional) and get no trend arrow.
    if (d.kind !== "npc" || !d.deltaBand) continue;
    out[d.npcId] = d.deltaBand;
  }
  return out;
}

// ---------------------------------------------------------------------------
// W2-C4 — Codex list model + new-truth detection (design §4.2, R11.2).
// ---------------------------------------------------------------------------

/** Normalize the wire codex (null-for-absent) into an optional array. */
export function adaptCodex(
  raw: RemoteCodexEntry[] | null | undefined,
): RemoteCodexEntry[] | undefined {
  return raw ?? undefined;
}

/**
 * Codex entries newest-first (highest turnNumber first). The server projects
 * them newest-first already (§7), but we re-sort defensively so the tab order
 * is stable regardless of server ordering. Stable within a turn (preserves
 * relative order of same-turn entries).
 */
export function codexNewestFirst(
  codex: RemoteCodexEntry[] | null | undefined,
): RemoteCodexEntry[] {
  return (codex ?? [])
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      if (b.entry.turnNumber !== a.entry.turnNumber) {
        return b.entry.turnNumber - a.entry.turnNumber;
      }
      return a.index - b.index;
    })
    .map((w) => w.entry);
}

/**
 * True when a truth was recorded on the CURRENT turn — drives the one-shot
 * "✒️ New truth recorded" pip. Compares the newest entry's turnNumber against
 * the scene's turn number (design §4.2: pip on a new codex entry).
 */
export function hasNewCodexTruth(
  codex: RemoteCodexEntry[] | null | undefined,
  currentTurn: number | undefined,
): boolean {
  if (currentTurn == null) return false;
  return codexNewestFirst(codex).some((e) => e.turnNumber === currentTurn);
}

// ---------------------------------------------------------------------------
// DOORS-JOURNAL — teased-door list model + key-arrival nudge (the reader-
// facing half of the story-bible fetch-quest loop). Pure so the tome voice
// and the transition detection are vitest-covered without the RN runtime.
// ---------------------------------------------------------------------------

/**
 * The tome-voice line for a journal entry. One full sentence per state so the
 * row reads as the tome speaking, never as a mechanics readout:
 *   teased      → "The crypt gate remembers you."
 *   key-in-hand → "The crypt gate — a key has turned up."
 *   opened      → "The crypt gate stands open."
 */
export function doorJournalLine(entry: RemoteDoorsJournalEntry): string {
  const trimmed = entry.label.trim();
  const label =
    trimmed.length > 0 ? trimmed[0]!.toUpperCase() + trimmed.slice(1) : "The door";
  if (entry.state === "opened") return `${label} stands open.`;
  if (entry.state === "key-in-hand") return `${label} — a key has turned up.`;
  return `${label} remembers you.`;
}

/**
 * Labels of doors whose key ARRIVED between two journal snapshots (state
 * moved teased → key-in-hand) — drives the one-shot "A key has turned up."
 * nudge. No previous snapshot (first load / resume) never nudges: the reader
 * may be rejoining mid-state and a stale toast would be noise.
 */
export function doorsNewlyKeyed(
  prev: RemoteDoorsJournalEntry[] | undefined,
  next: RemoteDoorsJournalEntry[] | null | undefined,
): string[] {
  if (!prev || !next) return [];
  const teasedBefore = new Set(
    prev.filter((e) => e.state === "teased").map((e) => e.label),
  );
  return next
    .filter((e) => e.state === "key-in-hand" && teasedBefore.has(e.label))
    .map((e) => e.label);
}

/**
 * The one-shot key-arrival nudge (panel-review-2 merged doors-journal idea).
 * The old toast — "A key has turned up." — named no door and pointed nowhere,
 * so the reader couldn't connect the payoff to the lock they'd met. This NAMES
 * the door whose key just landed (from the reader-seen labels `doorsNewlyKeyed`
 * returns — BC10, never a plan/id) and points at the doors-journal pill so the
 * fetch-quest payoff is legible. Title-cases the first label the same way
 * `doorJournalLine` does so the sentence reads as the tome speaking.
 */
export function keyArrivalToast(labels: string[]): string {
  const named = labels.map((label) => label.trim()).filter((label) => label.length > 0);
  const first = named[0];
  if (!first) return "A key has turned up — see the tome above.";
  const label = first[0]!.toUpperCase() + first.slice(1);
  return `A key has turned up — ${label}. See the tome above.`;
}
