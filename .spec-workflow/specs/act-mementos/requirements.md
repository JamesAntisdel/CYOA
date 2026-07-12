# Requirements — Act Mementos ("pressed between the pages")

Status: DRAFT FOR REVIEW (2026-07-11). Companion docs: `design.md`
(architecture), `tasks.md` (agent tasks).

Grounding: this spec extends story-engagement R12 (keepsakes are
ENDING-scoped today per R12.1 — `deriveDefaultKeepsake`,
`convex/keepsakes.ts:48`, minted only in the terminal path) and R12.3 (the
Librarian Rank, `packages/engine/src/rank.ts`, display-only). It closes a
retention gap the current build measures but does not reward: activation is
"≥5 turns" (steering `product.md` Success Metrics) and endings land around
turn 12–15+, so a new reader's first fifteen turns earn NOTHING durable — no
keepsake, no crypt entry, and even the rank's "beats fired" metric is
computed by summing LIVE saves (`convex/accountFunctions.ts:92-94`), so
deleting a save (or hardcore permadeath, R15.1) silently erases that
progress. Act boundaries already exist and are already celebrated
transiently: `act_advanced` diffs stamp the ChapterEnd recap
(`ReaderScreen.tsx:104` + `:461`) and force a chapter cinematic
(`game.ts:2106-2113`). This spec makes that moment durable. Story-engagement
cross-cutting rules (R16.1–R16.5) and design §0 BC1–BC10 apply unchanged.

## Introduction

Two additions, one loop:

1. **Act mementos** — when a run crosses an act boundary (act 1→2, 2→3), the
   server mints a small, durable, account-scoped collectible derived
   deterministically from what the reader just lived through: the act
   number, the arc's `actLabel`, the story title, and the fired beat. No LLM
   call, no media. Mementos survive save deletion, rewind, and hardcore
   permadeath — they are the pressed flowers of runs that may never finish.
2. **Rank-progress ticker** — the profile's Librarian Rank chip currently
   shows totals only (`librarianRankProgressLine`,
   `apps/app/lib/storyEngagementW3.ts:154`). The ticker adds the NEXT tier
   and the per-metric distance to it ("Keeper in 2 more endings"), and echoes
   one line of it at the act-boundary ChapterEnd, so the mid-run moment that
   mints a memento also shows the ladder moving.

### The open product question, answered head-on

**Do mid-run mementos dilute ending keepsakes?** They could, if they competed
on the same shelf for the same meaning. This spec's position — the proposal
the founder is approving or amending:

- **Separate shelves, explicit hierarchy.** Keepsakes remain the profile's
  primary trophies (unchanged position, unchanged visual weight); mementos
  render on their own shelf BELOW keepsakes, in a smaller, quieter card
  style. An ending says "I finished a story"; a memento says "I was there".
- **Keepsakes keep their exclusive power.** Only keepsakes are carriable into
  New Game+ (R12.2). Mementos are display-only in v1 — no inventory
  injection, no prompt effect, no gate key. The mechanical moat around
  endings is untouched.
- **Scarcity by construction.** At most 2 mementos per run (two act
  boundaries), versus a potentially unbounded shelf — the shelf shows the
  newest page and the total count.

**Marked alternative (NOT chosen, kept for the dashboard decision):** split
the Novice rank into sub-tiers (e.g. Novice → Novice II at 3 lifetime beats →
Novice III at 10) so early progress ticks without any new collectible. It is
a smaller change, but it RENAMES the reader instead of REWARDING the run, it
leans on the beats metric that save-deletion erodes (see Grounding), and it
crowds the tier ladder that "The Unwritten" tops. If the founder prefers it,
it replaces R1–R2 below and shrinks this spec to R3 plus a `TIERS` edit; the
ticker (R3) is worth shipping under either choice.

## Alignment with Product Vision

- **Consequences are immediate and felt** (principle 4): the act boundary
  becomes a reward beat, not just a stinger.
- **Endings-tracking moat** (business objectives): mementos extend the
  collectible surface backward into the first session, where activation is
  won or lost.
- **Story first** (principle 1): mementos are named by the story's own
  words (act labels, beat labels) — a bookmark, not a badge.
- **Agency is the point** (principle 3): untouched — mementos observe act
  crossings; they never gate or steer them.

---

## Requirements

### R1 — Minting at act boundaries

User story: as a reader, crossing into Act II leaves something in my library
even if I never finish the tale.

1. WHEN a completed llm-path turn carries an `act_advanced` diff on an
   arc-bearing save THEN the server SHALL mint one memento row (new
   `mementos` table, integrator-owned per BC7) in the same mutation,
   deterministically and without any LLM call: `act` (the new act number),
   `label` ("Act II — " + the arc's `actLabel` when present, else
   "Act II of " + story title), `description` derived from the most recently
   fired beat's label when available (else a fixed book-voice line), plus
   `storyTitle`, `saveId`, `storyId`, and `dailyId` when the run is a Daily.
2. Minting SHALL be idempotent per (`accountId`, `saveId`, `act`) — a rewind
   that re-crosses the same boundary does not duplicate, and the original row
   survives (durability beats replay bookkeeping; see R2).
3. Label and description strings SHALL be clamped (label ≤80,
   description ≤160) and SHALL pass `evaluateTextPolicy` before persistence
   (R16.2 — arc strings are already policy-gated at arc persistence, but the
   memento composes them into new display text, so gate again; blocked →
   neutral fallback text, never a mint failure).
4. Arc-less/legacy saves, authored (non-llm) saves, safety-forced paths with
   no arc, and co-op follower clients SHALL never mint (BC9 — those saves
   behave exactly as today).
5. Minting is best-effort: a failure never blocks or fails the turn (BC5
   spirit). Analytics `memento.granted` fires fire-and-forget with payload
   `saveId`, `act`, `dailyId?` (R16.1 pattern).

### R2 — Durability and lifecycle

User story: the tome remembers I reached Act III even after the tale itself
is gone.

1. Memento rows SHALL be account-scoped and independent of the save row:
   deleting a save, rewinding past the boundary, and hardcore permadeath
   (save purged, R15.1) SHALL all leave existing mementos intact. This is the
   spec's core promise — the FIRST durable reward a brand-new reader can earn
   inside their first session.
2. Because `claimGuest` patches the same account row
   (`convex/accountFunctions.ts:134`), guest-earned mementos survive claim
   with no migration; a fake-ctx test SHALL prove it.
3. `deleteAccount` SHALL purge the account's mementos; `exportAccount` SHALL
   include them in the bundle (same posture as `endings_unlocked`).
4. The profile projection SHALL cap the mementos it returns (newest 12, plus
   a `total` count) so the read stays bounded as shelves grow.

### R3 — Rank-progress ticker

User story: I can always see the next rung of the Librarian ladder and how
far away it is.

1. A pure engine helper (`rankProgress`, in `packages/engine/src/rank.ts`)
   SHALL compute, from a `LibrarianRank`, the NEXT tier in `TIERS` order and
   the per-metric deficits (endings/beats/tales still needed, zero-floored).
   At the top tier it SHALL return null. `TIERS` stays module-private — the
   helper is the only new export, keeping the ladder's single source of
   truth (rank.ts:34-36) intact.
2. `accountFunctions:getProfile` SHALL include the server-computed
   `rankProgress` beside the existing `librarianRank` (BC2 wire shape in
   design §3; display-only per R12.3 — no rank formula change).
3. The profile rank block SHALL render the ticker line under the existing
   chip: "Next: Keeper — 2 more endings" (multi-metric tiers list each
   remaining metric). At the top tier it renders the existing totals line
   unchanged.
4. WHEN ChapterEnd shows an act stamp (`actNumber` present) THEN it SHALL
   also show (a) a one-line memento acknowledgement ("A memento is pressed
   between the pages") and (b) the ticker line, sourced from the same
   profile query the app already uses (`useAccountProfile`). Both lines are
   optional props that self-hide (zero layout shift) when data is absent —
   non-act boundaries and legacy saves render exactly as today (BC9).
5. Rank inputs (endings, beats, tales) are UNCHANGED in v1 — mementos do not
   feed the rank. Folding memento counts into a future tier ladder is a
   marked follow-up, not this spec.

### R4 — Mementos shelf on the profile

User story: my mementos read like pressed pages, below my trophies, never
competing with them.

1. The profile screen SHALL render a "Mementos" shelf BELOW the keepsakes
   shelf: quiet cards showing `label`, `description`, `storyTitle`, and a
   relative date, with the section header carrying the total count. The
   keepsakes shelf and trophy crypt are visually and structurally untouched
   (the dilution answer, enforced in layout).
2. WHEN the account has no mementos THEN the shelf SHALL not render at all —
   no empty-state upsell in v1.
3. Mementos never appear in inventory, prompts, or gates (display-only,
   R12.2 exclusivity preserved).

## Non-Goals (explicit)

- **Carriable mementos / New Game+ effects** — keepsakes keep that power
  exclusively (the dilution firewall).
- **LLM-authored or media-backed mementos** — deterministic text only; no
  new LLM calls, no cinematics (story-engagement cost discipline).
- **Rank formula changes** — including the Novice sub-tier split (marked
  alternative above, founder's call) and memento-fed tiers.
- **Retroactive minting** for act boundaries crossed before this ships.
- **Sub-act collectibles** (per-beat, per-turn) — if act mementos prove out,
  that is a data-informed follow-up.
- **Memento sharing/links** — profile-local in v1.

## Non-Functional Requirements

### Performance
- Minting adds one indexed dedupe read + one insert inside an existing turn
  mutation; the profile addition is one bounded indexed read (newest 12).
  No new LLM calls anywhere.

### Reliability
- Every path degrades to today's behavior: no arc → no memento; mint failure
  → turn unaffected; missing profile fields → client surfaces self-hide
  (BC5/BC9 end to end).

### Code Architecture
- Derivation/validation logic is pure and table-driven-tested in a new
  `convex/mementos.ts` mirroring `convex/keepsakes.ts`; the engine gains only
  the pure `rankProgress`; schema and `game.ts` wiring are integrator-owned
  (BC7); `exactOptionalPropertyTypes` conventions (BC4).

### Security / Safety
- Memento text passes `evaluateTextPolicy` before persistence (R1.3); rows
  are account-scoped with the same authorization as keepsakes; purge/export
  parity with `endings_unlocked` (R2.3).
