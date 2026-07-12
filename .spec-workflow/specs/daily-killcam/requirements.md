# Requirements — Daily Killcam ("N% of today's readers chose this")

Status: DRAFT FOR REVIEW (2026-07-11). Companion docs: `design.md`
(architecture), `tasks.md` (agent tasks).

Grounding: this spec extends story-engagement R13 (the Daily Tale). Today the
Daily's only social surface is END-OF-RUN: `daily_results` rows aggregate into
the ending distribution on the results screen (`computeDistribution`,
`convex/daily.ts:185`; rendered via `DailyResults`). Nothing social happens
DURING the run — the shared-seed premise ("all readers race the same
question") is invisible until the reader finishes. This spec adds the missing
mid-run beat: after the reader commits an early choice, show what share of
today's readers did the same. It implements the "shared ending leaderboards"
spirit of core-read-loop Req 23.3 (surfaces without exposing hidden paths)
one layer earlier in the run. Story-engagement's cross-cutting rules (R16.2
safety, R16.3 back-compat, R16.4 testing) apply to every requirement below
unchanged, as do design §0 BC1–BC10.

## Introduction

Daily runs share the ARC, not the generated scenes (R13.2: the pre-generated
`storyArc` is injected; every reader's prose and choice labels are generated
fresh from the same premise). So two readers at turn 2 may face differently
worded choices that mean roughly the same thing — and by turn 5 their stories
have genuinely diverged. Bucketing by turn number + normalized choice-label
key therefore works well exactly where the runs still rhyme: the opening
forks. That is not a limitation to paper over; it IS the product. Like a
Wordle square, the Daily Killcam is about the shared opening moves — "62% of
today's readers answered the signal; you rowed toward the dark" — not a full
path histogram. Recording and display are hard-capped at the first 3
completed turns, buckets under a 10-reader floor stay silent, and the reader
only ever sees the percentage for a choice THEY already made.

## Alignment with Product Vision

- **Consequences are immediate and felt** (product principle 4): the pulse
  lands seconds after the commit, while the choice is still warm.
- **Moat through shared surfaces** (business objectives; Key Feature 15 —
  shared leaderboards drive recurring engagement): the Daily becomes a
  conversation piece mid-run, not only at the finish line.
- **Story first** (principle 1): one quiet chip in the echo strip, phrased in
  the book voice ("the road less traveled") — never a stats dashboard over
  the prose.
- **Spoiler discipline** (story-engagement BC10): percentages attach only to
  the reader's own committed choices; other readers' choice text never
  crosses the wire.

---

## Requirements

### R1 — Early-turn choice recording

User story: as a Daily reader, my opening choices are counted so the day's
shared story has a visible pulse.

1. WHEN an llm-driven turn is applied to a save carrying `dailyId` AND the
   turn's number is at most `KILLCAM_TURN_CAP` (3) THEN the server SHALL
   record one `daily_choice_results` row (new table, integrator-owned per
   BC7) carrying `dailyId`, `accountId`, `saveId`, `turnNumber`, `choiceKey`,
   and a `freeForm` flag. Recording is best-effort: a failure never blocks or
   fails the turn (BC5 spirit).
2. `choiceKey` SHALL be derived by a pure function from the committed
   choice's reader-facing label (the same string persisted as
   `turn_history.choiceLabel`): trim, lowercase, collapse whitespace, strip
   punctuation, slugify, clamp to 64 chars. Free-form ("write your own")
   turns SHALL record the reserved key `free-form` with `freeForm: true`; the
   reader's typed text SHALL NOT be stored in the row (privacy + spoilers —
   other readers must never receive it, so it is never persisted here).
3. Rows SHALL be UPSERTED keyed by (`dailyId`, `accountId`, `turnNumber`): a
   replayed turn (rewind → re-choose) replaces the previous bucket, so each
   reader counts at most once per turn. A row whose stored `saveId` differs
   from the recording save (e.g. a forked copy of a daily save) SHALL NOT be
   overwritten — the account's first daily run wins.
4. WHEN a rewind deletes `turn_history` rows THEN the matching
   `daily_choice_results` rows for those turn numbers SHALL be deleted in the
   same mutation, so an abandoned rewind never leaves a stale vote.
5. Non-daily saves, authored (non-llm) saves, co-op follower submissions, and
   turns past the cap SHALL never be recorded.
6. Analytics (fire-and-forget, `analytics_events` pattern):
   `daily.choice_recorded` with payload `dailyId`, `turnNumber`, `choiceKey`,
   `freeForm` — fired from the turn mutation (queries cannot write; see
   design DK2).

### R2 — The pulse: spoiler-safe aggregation

User story: after I choose, I learn how many of today's readers walked the
same way — and nothing about the paths I haven't seen.

1. A new query `dailyFunctions:getChoicePulse` SHALL return, for each early
   turn the READER has a recorded row for, ONLY the reader's own bucket:
   `turnNumber`, `sharePct` (0–100, server-rounded), `sameCount`,
   `totalReaders`, and a server-authored `phrase`. The full per-bucket
   distribution, other buckets' keys, and other readers' labels SHALL NEVER
   be returned (BC10: the reader never saw other runs' choice text — a
   foreign label is a spoiler for a scene that was never theirs).
2. WHEN `totalReaders` at (`dailyId`, `turnNumber`) is under
   `KILLCAM_MIN_READERS` (10) THEN that turn SHALL be omitted from the
   response entirely — silence, not a low-confidence percentage.
3. All percentage math SHALL happen server-side (existing `dailyApi.ts`
   discipline: "server-computed — BC10, never raw math").
4. The `phrase` SHALL come from a pure, table-driven tier map (design §4):
   e.g. share of 60+ reads "the well-worn path", 25–59 "a common thread",
   under 25 "the road less traveled"; the `free-form` bucket always reads
   "wrote their own page". Copy lives in one table so tone edits are
   one-line.
5. Authorization mirrors `getResults` (`loadAndAuthorizeAccount`); guests are
   first-class. Because `claimGuest` patches the SAME account row
   (`convex/accountFunctions.ts:134`), rows keyed by `accountId` survive
   claim with zero migration — a fake-ctx test SHALL prove the pulse resolves
   identically post-claim (R13.4 attach-on-claim, by construction).

### R3 — Client surfaces

User story: the pulse reads like a marginal note in the tome, not a poll
widget.

1. Reading surface: on a Daily save, after a recorded early turn completes
   and its pulse entry is available, the reader's choice-history echo area
   SHALL show ONE quiet chip for that turn — percentage + phrase (e.g.
   "62% of today's readers · the well-worn path"). It attaches only to the
   reader's own committed choice, never to offered/uncommitted choices, and
   renders nothing (zero layout shift) when absent.
2. The Daily results screen (`DailyResults`) SHALL gain an "Opening forks"
   strip above the ending distribution: up to 3 tiles (one per recorded early
   turn) showing the reader's own choice label (already client-known from
   their history) + `sharePct` + phrase — the Wordle-square recap of the
   day's opening moves. The strip hides when no entry meets the threshold.
3. To know a save is a Daily, the scene projection SHALL be widened with an
   optional `dailyId` (a reader-known fact — they tapped the Daily card;
   spoiler-neutral under BC10). Legacy/non-daily projections omit the field
   (BC9, conditional spread per BC4).
4. Copy SHALL always scope claims to "today's readers" — never "all readers"
   — because buckets are approximate by design (label normalization across
   independently generated scenes) and thin with depth.

### R4 — Honest mechanics and bounds

1. `KILLCAM_TURN_CAP` SHALL be 3 and `KILLCAM_MIN_READERS` SHALL be 10, both
   named constants in the pure module with the rationale documented beside
   them: past turn 3 the shared-seed runs diverge enough that label buckets
   stop meaning "the same fork", and under 10 readers a percentage is noise
   and deanonymizable.
2. Aggregation SHALL be computed at read time from the day's rows (bounded by
   daily participation × 3). This is acceptable at current scale; a
   counter-row design is explicitly documented as the scale follow-up
   (Non-Goals) — do not build it now.

## Non-Goals (explicit)

- **Full per-turn distributions** (all buckets, all labels) — spoilers and
  noise; only the reader's own bucket ships.
- **Extending past turn 3, or to non-daily saves** — the mechanic is honest
  only on the shared opening forks.
- **Emoji-grid / image share export of the opening forks** — natural
  follow-up once the pulse proves engagement; separate spec.
- **Leaderboard changes** — first-finder/rarest-path surfaces (R13.3) are
  untouched.
- **Counter-row aggregation** — revisit when a day's participation makes the
  read-time scan expensive.
- **Any UI on co-op reads** — the Daily is a solo race today.

## Non-Functional Requirements

### Performance
- Recording adds one indexed read + one upsert inside an existing turn
  mutation — no extra LLM calls, no reader-visible latency.
- `getChoicePulse` performs at most `KILLCAM_TURN_CAP` bounded index reads
  (`by_daily_turn`), each proportional to the day's participants.

### Reliability
- Recording and pulse are decorative: any failure degrades to "no chip",
  never a turn failure or an error surface (BC5 discipline).

### Code Architecture
- All bucketing/aggregation/phrase logic is pure and table-driven-tested in
  `convex/daily.ts` (BC6, R16.4); handlers get fake-ctx tests; the
  `daily_choice_results` table and reserved-file wiring are integrator-owned
  (BC7); `exactOptionalPropertyTypes` conventions throughout (BC4).

### Security / Safety
- No new text-policy surface: no other reader's text is ever displayed, and
  free-form typed text is never persisted in killcam rows. Rows are scoped by
  account ownership like `daily_results`; `deleteAccount` must purge them
  (design §5).
