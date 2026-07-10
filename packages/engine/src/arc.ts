import type {
  ArcBeat,
  ArcBeatKind,
  ArcPriorityHint,
  CandidateEnding,
  StoryArc,
  StoryClock,
} from "./types";

// =============================================================================
// Story Arc engine module (Requirement 1). Pure — no `console`, no Date.now
// (BC6). Every function is total: malformed input returns null/fallback rather
// than throwing, so the read loop never hard-fails on model drift (BC5).
// =============================================================================

const QUESTION_MIN = 8;
const QUESTION_MAX = 160;
const WANT_MIN = 8;
const WANT_MAX = 120;
const STAKES_MIN = 8;
const STAKES_MAX = 160;
const BEAT_LABEL_MAX = 80;
const SLUG_MAX = 48;
const CANDIDATE_LABEL_MAX = 80;
const CANDIDATE_HINT_MAX = 120;
const MIN_BEATS = 3;
const MAX_BEATS = 5;
const MIN_CANDIDATES = 2;
const MAX_CANDIDATES = 4;

const BEAT_KINDS: readonly ArcBeatKind[] = [
  "inciting",
  "midpoint",
  "dark_night",
  "climax",
  "custom",
];
const PRIORITY_HINTS: readonly ArcPriorityHint[] = ["early", "mid", "late"];

const ACT_LABELS: Record<1 | 2 | 3, string> = {
  1: "The Opening",
  2: "Rising Action",
  3: "The Reckoning",
};

/** Turn bands for beat steering: early ≤ 4, mid 5–9, late ≥ 10. */
export function beatBandForTurn(turnNumber: number): ArcPriorityHint {
  if (turnNumber <= 4) return "early";
  if (turnNumber <= 9) return "mid";
  return "late";
}

function bandRank(hint: ArcPriorityHint): number {
  return PRIORITY_HINTS.indexOf(hint);
}

/**
 * Lowercase, ASCII-slug an id/label to a bounded token. Deterministic and
 * dependency-free so the same LLM string always maps to the same beat id.
 */
export function slugify(input: string, max = SLUG_MAX): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > max ? slug.slice(0, max).replace(/-+$/g, "") : slug;
}

function clampLen(input: string, min: number, max: number): string | null {
  const trimmed = input.trim();
  if (trimmed.length < min) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function asBeatKind(value: unknown): ArcBeatKind {
  return isString(value) && (BEAT_KINDS as readonly string[]).includes(value)
    ? (value as ArcBeatKind)
    : "custom";
}

function asPriorityHint(value: unknown): ArcPriorityHint {
  return isString(value) && (PRIORITY_HINTS as readonly string[]).includes(value)
    ? (value as ArcPriorityHint)
    : "mid";
}

function asAct(value: unknown): 1 | 2 | 3 {
  return value === 2 ? 2 : value === 3 ? 3 : 1;
}

/**
 * Validate + clamp a raw (LLM-proposed) arc into a canonical StoryArc, or
 * return null when it cannot be salvaged (too-short question/want/stakes,
 * fewer than 3 usable beats, fewer than 2 candidate endings). Never throws.
 *
 * Guarantees on a non-null result: string clamps applied, beat ids sluggified
 * + de-duplicated, 3–5 beats, 2–4 candidate endings, act ∈ {1,2,3}, every beat
 * `status: "pending"`, and at least one `requiredBeforeEnding` beat (a `climax`
 * beat is promoted, else the last beat).
 */
export function validateProposedArc(raw: unknown): StoryArc | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  const dramaticQuestion = isString(obj.dramaticQuestion)
    ? clampLen(obj.dramaticQuestion, QUESTION_MIN, QUESTION_MAX)
    : null;
  const protagonistWant = isString(obj.protagonistWant)
    ? clampLen(obj.protagonistWant, WANT_MIN, WANT_MAX)
    : null;
  const stakes = isString(obj.stakes) ? clampLen(obj.stakes, STAKES_MIN, STAKES_MAX) : null;
  if (dramaticQuestion === null || protagonistWant === null || stakes === null) return null;

  const rawBeats = Array.isArray(obj.beats) ? obj.beats : [];
  const seenBeatIds = new Set<string>();
  const beats: ArcBeat[] = [];
  for (const entry of rawBeats) {
    if (beats.length >= MAX_BEATS) break;
    if (typeof entry !== "object" || entry === null) continue;
    const beatObj = entry as Record<string, unknown>;
    const label = isString(beatObj.label) ? clampLen(beatObj.label, 1, BEAT_LABEL_MAX) : null;
    if (label === null) continue;
    const rawId = isString(beatObj.id) && beatObj.id.trim().length > 0 ? beatObj.id : label;
    const id = slugify(rawId);
    if (id.length === 0 || seenBeatIds.has(id)) continue;
    seenBeatIds.add(id);
    beats.push({
      id,
      label,
      kind: asBeatKind(beatObj.kind),
      priorityHint: asPriorityHint(beatObj.priorityHint),
      requiredBeforeEnding: beatObj.requiredBeforeEnding === true,
      status: "pending",
    });
  }
  if (beats.length < MIN_BEATS) return null;

  const rawCandidates = Array.isArray(obj.candidateEndings) ? obj.candidateEndings : [];
  const seenCandidateIds = new Set<string>();
  const candidateEndings: CandidateEnding[] = [];
  for (const entry of rawCandidates) {
    if (candidateEndings.length >= MAX_CANDIDATES) break;
    if (typeof entry !== "object" || entry === null) continue;
    const c = entry as Record<string, unknown>;
    const label = isString(c.label) ? clampLen(c.label, 1, CANDIDATE_LABEL_MAX) : null;
    if (label === null) continue;
    const rawId = isString(c.id) && c.id.trim().length > 0 ? c.id : label;
    const id = slugify(rawId);
    if (id.length === 0 || seenCandidateIds.has(id)) continue;
    seenCandidateIds.add(id);
    const hint = isString(c.hint) ? clampLen(c.hint, 0, CANDIDATE_HINT_MAX) ?? "" : "";
    candidateEndings.push({ id, label, hint });
  }
  if (candidateEndings.length < MIN_CANDIDATES) return null;

  ensureRequiredBeat(beats);

  return {
    dramaticQuestion,
    protagonistWant,
    stakes,
    act: asAct(obj.act),
    beats,
    candidateEndings,
    source: "llm",
  };
}

/** Force ≥1 `requiredBeforeEnding` beat: promote a `climax`, else the last beat. */
function ensureRequiredBeat(beats: ArcBeat[]): void {
  if (beats.some((beat) => beat.requiredBeforeEnding)) return;
  const climax = beats.find((beat) => beat.kind === "climax");
  const target = climax ?? beats[beats.length - 1];
  if (target) target.requiredBeforeEnding = true;
}

/**
 * Deterministic minimal arc from a premise when the model omits/malforms
 * `storyArc` (Requirement 1.2) — never a hard failure; every save gets an arc.
 */
export function synthesizeFallbackArc(premise: string, seedTitle?: string): StoryArc {
  const focus = deriveFocus(premise, seedTitle);
  const dramaticQuestion = clampLen(`Will you see ${focus} through to the end?`, QUESTION_MIN, QUESTION_MAX)
    ?? "What will you become before the end?";

  const beats: ArcBeat[] = [
    {
      id: "inciting-call",
      label: "The call that cannot be refused",
      kind: "inciting",
      priorityHint: "early",
      requiredBeforeEnding: false,
      status: "pending",
    },
    {
      id: "midpoint-turn",
      label: "The turn where the true cost is revealed",
      kind: "midpoint",
      priorityHint: "mid",
      requiredBeforeEnding: false,
      status: "pending",
    },
    {
      id: "climax-reckoning",
      label: "The reckoning that answers the question",
      kind: "climax",
      priorityHint: "late",
      requiredBeforeEnding: true,
      status: "pending",
    },
  ];

  return {
    dramaticQuestion,
    protagonistWant: "To reach the end of this on your own terms.",
    stakes: "Fail, and everything set in motion here is lost.",
    act: 1,
    beats,
    candidateEndings: [
      { id: "triumph", label: "The hard-won triumph", hint: "You answer the question and pay the price." },
      { id: "ruin", label: "The quiet ruin", hint: "The question answers you instead." },
    ],
    source: "synthesized",
  };
}

function deriveFocus(premise: string, seedTitle?: string): string {
  const source = (seedTitle ?? premise ?? "").trim();
  if (source.length === 0) return "this";
  const clipped = source.length > 90 ? source.slice(0, 90).trim() : source;
  return clipped.replace(/[.?!]+$/g, "");
}

/**
 * The single beat the prompt should steer toward (Requirement 1.3). Among
 * pending beats: prefer those already "due" for the current turn band (band ≤
 * current), earliest in array order; otherwise the earliest upcoming pending
 * beat. Returns null when every beat has fired.
 */
export function nextTargetBeat(arc: StoryArc, turnNumber: number): ArcBeat | null {
  const pending = arc.beats.filter((beat) => beat.status === "pending");
  if (pending.length === 0) return null;
  const currentRank = bandRank(beatBandForTurn(turnNumber));
  const due = pending.filter((beat) => bandRank(beat.priorityHint) <= currentRank);
  return (due.length > 0 ? due[0] : pending[0]) ?? null;
}

/** Match a beat by exact id or by sluggified id (tolerant of raw LLM ids). */
export function findArcBeat(arc: StoryArc, beatId: string): ArcBeat | undefined {
  const slug = slugify(beatId);
  return arc.beats.find((beat) => beat.id === beatId || beat.id === slug);
}

/**
 * Mark a beat fired (Requirement 1.4). Idempotent: firing an already-fired or
 * unknown beat returns `fired: false` and the arc unchanged. On a successful
 * fire, returns a NEW arc (input never mutated) with the beat's `status` and
 * `firedAtTurn` set.
 */
export function fireBeat(
  arc: StoryArc,
  beatId: string,
  turn: number,
): { arc: StoryArc; fired: boolean } {
  const target = findArcBeat(arc, beatId);
  if (!target || target.status === "fired") return { arc, fired: false };
  const beats = arc.beats.map((beat) =>
    beat.id === target.id ? { ...beat, status: "fired" as const, firedAtTurn: turn } : beat,
  );
  return { arc: { ...arc, beats }, fired: true };
}

/**
 * Advance the act when its trigger beats have fired (Requirement 1.4):
 * act 1 → 2 once an `inciting` beat fires; act 2 → 3 once a `midpoint` beat
 * fires OR two or more `mid`-priority beats fire. Returns the input arc
 * unchanged when nothing is due; otherwise a NEW arc with `act` + generated
 * `actLabel`.
 */
export function advanceActIfDue(arc: StoryArc): StoryArc {
  const incitingFired = arc.beats.some((beat) => beat.kind === "inciting" && beat.status === "fired");
  const midpointFired = arc.beats.some((beat) => beat.kind === "midpoint" && beat.status === "fired");
  const midFiredCount = arc.beats.filter(
    (beat) => beat.priorityHint === "mid" && beat.status === "fired",
  ).length;

  let target: 1 | 2 | 3 = 1;
  if (incitingFired) target = 2;
  if (midpointFired || midFiredCount >= 2) target = 3;

  const nextAct = (Math.max(arc.act, target) as 1 | 2 | 3);
  if (nextAct === arc.act) return arc;
  return { ...arc, act: nextAct, actLabel: ACT_LABELS[nextAct] };
}

/** True once every `requiredBeforeEnding` beat has fired (Requirement 2.1). */
export function arcAllowsEnding(arc: StoryArc): boolean {
  return arc.beats.every((beat) => !beat.requiredBeforeEnding || beat.status === "fired");
}

/**
 * Normalize a proposed ending id to one of the arc's candidate ids when it
 * fuzzy-matches (Requirement 2.4); otherwise the proposed id is kept (freeform
 * endings remain legal). Matching: exact slug, then substring containment,
 * then bounded edit distance.
 */
export function normalizeEndingId(arc: StoryArc, proposedId: string): string {
  const proposedSlug = slugify(proposedId);
  if (proposedSlug.length === 0) return proposedId;

  let best: { id: string; distance: number } | null = null;
  for (const candidate of arc.candidateEndings) {
    if (candidate.id === proposedSlug) return candidate.id;
    if (candidate.id.includes(proposedSlug) || proposedSlug.includes(candidate.id)) {
      return candidate.id;
    }
    const distance = levenshtein(candidate.id, proposedSlug);
    if (best === null || distance < best.distance) best = { id: candidate.id, distance };
  }

  if (best === null) return proposedId;
  const threshold = Math.max(2, Math.floor(proposedSlug.length * 0.34));
  return best.distance <= threshold ? best.id : proposedId;
}

// =============================================================================
// The Guttering Candle — doom clock (Requirement 9, W2). Pure StoryClock
// helpers. The clock rides inside `saves.state` (no schema change); legacy +
// arc-less saves omit it entirely (BC9). Orchestration (per-turn ticking,
// expiry auto-fire of `dark_night` beats, diff emission) lives in `llm.ts`
// where the turn loop is; these functions are the pure math it calls.
// =============================================================================

/** Default clock ceiling (Requirement 9.1). */
export const CLOCK_MAX_DEFAULT = 12;
/** Hardcore shrinks the ceiling ~25% (Requirement 15.1 — wired W3 via param). */
export const CLOCK_HARDCORE_MAX_REDUCTION = 0.25;
const CLOCK_LABEL_DEFAULT = "The candle burns";
/** The engine auto-advances +1 every this-many completed turns (Requirement 9.2). */
const CLOCK_TURNS_PER_TICK = 3;

/**
 * Build a fresh clock (Requirement 9.1). `label` defaults to the themed
 * fallback; `max` defaults to {@link CLOCK_MAX_DEFAULT}. `maxReduction` (0..1)
 * shrinks the ceiling — hardcore passes {@link CLOCK_HARDCORE_MAX_REDUCTION}
 * (W3). The result is never below 1.
 */
export function createClock(
  label?: string,
  opts?: { max?: number; maxReduction?: number },
): StoryClock {
  const baseMax = Math.max(1, Math.trunc(opts?.max ?? CLOCK_MAX_DEFAULT));
  const reduction = clampUnit(opts?.maxReduction ?? 0);
  const max = Math.max(1, Math.round(baseMax * (1 - reduction)));
  const trimmed = (label ?? "").trim();
  return {
    label: trimmed.length > 0 ? trimmed : CLOCK_LABEL_DEFAULT,
    value: 0,
    max,
    expired: false,
  };
}

/**
 * Deterministic per-turn advance (Requirement 9.2): +1 on every 3rd completed
 * turn (turn 3, 6, 9, …), otherwise unchanged. Idempotent given the same
 * `turnNumber` (the caller ticks exactly once per completed turn). Never
 * retreats. Returns the input clock unchanged on non-tick turns.
 */
export function tickClock(clock: StoryClock, turnNumber: number): StoryClock {
  if (turnNumber <= 0 || turnNumber % CLOCK_TURNS_PER_TICK !== 0) return clock;
  return applyClockAdvance(clock, 1);
}

/**
 * Advance (or, with a negative amount, retreat — the rare skill-check boon)
 * the clock, clamped to [0, max]; `expired` becomes true once value reaches
 * max (Requirement 9.3). Returns a NEW clock; the input is never mutated. A
 * zero net change still returns a fresh object (harmless; callers compare
 * `value`).
 */
export function applyClockAdvance(clock: StoryClock, amount: number): StoryClock {
  const delta = Math.trunc(Number.isFinite(amount) ? amount : 0);
  const value = clampInt(clock.value + delta, 0, clock.max);
  return { ...clock, value, expired: value >= clock.max };
}

/**
 * Escalation band for the prompt (Requirement 9.3): none < 50% < 75% < 100%.
 * At 100% (expired) the next prompt must drive into the climax under degraded
 * circumstances.
 */
export function clockDirective(
  clock: StoryClock,
): "none" | "escalate_50" | "escalate_75" | "climax_now" {
  if (clock.max <= 0) return "none";
  if (clock.value >= clock.max) return "climax_now";
  const pct = clock.value / clock.max;
  if (pct >= 0.75) return "escalate_75";
  if (pct >= 0.5) return "escalate_50";
  return "none";
}

/** Beat ids the clock should auto-fire on expiry (Requirement 9.3). */
export function darkNightBeatIds(arc: StoryArc): string[] {
  return arc.beats
    .filter((beat) => beat.kind === "dark_night" && beat.status !== "fired")
    .map((beat) => beat.id);
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function clampInt(value: number, min: number, max: number): number {
  const int = Math.trunc(value);
  if (int < min) return min;
  if (int > max) return max;
  return int;
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const prev = new Array<number>(cols);
  const curr = new Array<number>(cols);
  for (let j = 0; j < cols; j += 1) prev[j] = j;
  for (let i = 1; i < rows; i += 1) {
    curr[0] = i;
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min((curr[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    for (let j = 0; j < cols; j += 1) prev[j] = curr[j] ?? 0;
  }
  return prev[cols - 1] ?? 0;
}
