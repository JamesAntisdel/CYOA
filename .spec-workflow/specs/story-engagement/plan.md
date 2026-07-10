# Story Engagement Plan — "Make the Tome Grip You"

Status: BRAINSTORM + PHASED PLAN (2026-07-10). Source research: full sweep of
`.spec-workflow/steering/product.md`, `core-read-loop` requirements/design/tasks,
`omni-cinematics` spec, `packages/engine/src`, `convex/llm/prompts/scene.ts`,
and the live turn loop in `convex/game.ts`.

## The diagnosis (why it doesn't draw you in)

The media stack is ahead of the game. The three systems the specs *designed* to
make stories compelling are exactly the ones unbuilt, dark, or unreachable:

1. **No pursuit.** Nothing in the product gives a run a goal, dramatic question,
   or win condition — grep for goal/quest/objective returns zero gameplay hits.
   Req 32 (arc beats — the authored plot spine with `requiredBefore` ending
   gates) is ENTIRELY unbuilt (tasks 60–63). The scene prompt optimizes for
   *variety* (anti-repetition is its stated #1 problem) but never for *stakes*.
   Endings are a narrator whim delayed by a turn-count hack
   (`MIN_TURN_BEFORE_TERMINAL = 6`), not a climax that is earned.
2. **Choices have no felt consequence.** The LLM path can fire only 6 of ~20
   engine effect kinds (stat/currency/inventory×2/flag×2). `delayed` effects are
   validated then **discarded** (`llm.ts:422`). Skill checks have zero live call
   sites. LLM choices carry no `conditions`/visibility — the reader never sees a
   locked "🔒 requires the Bone Key" option. Worst: on the LLM path the choice
   echo shows a stat *snapshot*, not the signed delta (`deriveRemoteEcho`), so
   the reader literally cannot see that their pick changed anything. Flags — the
   "durable world state" — are never rendered.
3. **Nobody to care about.** The NPC subsystem (roles, disposition,
   relationships, knownFacts, 9 npc_* effects) is fully built and fully inert:
   no starter story declares `initialNpcs` (task 59), the LLM cannot emit any
   npc_* effect, disposition never moves.
4. **No pressure.** Hardcore/permadeath is engine-supported but "not selectable"
   (Req 8.4). Difficulty is a cosmetic label. Nothing drains resources over
   time; currency is a number with no use; every choice is always available.
5. **No reason to return.** Endings map/trophy crypt record the past but unlock
   nothing. Seasons/leaderboards exist but are thin. "What-might-have-been"
   surfacing (product.md:31) and cross-tale continuity (product.md:93) were
   never built.

## The feature brainstorm — five pillars

### Pillar A — The Spine (pursuit)
- **A1. Dramatic Question + Quest Ledger** — at save creation the LLM authors a
  dramatic question ("Escape the drowning city before the bells toll twelve"),
  a want, and a 3-act beat sheet (inciting incident → midpoint reversal → dark
  night → climax). Engine persists `pendingArcBeats` (build Req 32, tasks
  60–63). Reader sees a quiet quest line in the HUD and an act header
  ("Act II — The Debt Comes Due"). Prompt receives "current act + the beat to
  steer toward."
- **A2. Chekhov Threads** — enable `delayed` effects on the LLM path (engine
  already works; the schema already validates them — we just stop dropping
  them). Surface as a "threads" journal pill: "Something you did in the chapel
  will echo…" → payoff with a callback line N scenes later.
- **A3. Earned Endings** — replace the turn-count ending gate with beat-gated
  endings (Req 32.6/32.7): terminal proposals rejected until required beats
  fire; the ending scene must reference the dramatic question. Endings become
  climaxes, and the ending cinematic's beat-timeline gets real beats.

### Pillar B — Choices with Teeth (felt consequence)
- **B1. Locked & Conditional Choices (LLM path)** — add optional
  `conditions`/`visibility` to `llmChoiceSchema` (has_item / stat_at_least /
  flag_equals; engine `visibility.ts` already resolves locked-with-hint). The
  reader starts seeing "🔒 Bribe the warden — you cannot afford 40 gold" →
  want, FOMO, replay pull, and inventory/stats suddenly *mean* something.
- **B2. Risk-Labeled Choices + Live Skill Checks** — wire `skill_check` into the
  LLM path with visible odds ("Nerve check — risky") resolved deterministically
  by the engine (pass / partial / fail each with authored effect deltas). Dice
  tension at the moment of choice is the single missing thrill mechanic.
- **B3. Fix the Echo (quick win)** — LLM path must show the signed delta
  (+Nerve, −2 Vitality, "new thread"), not a snapshot. Perceived agency for one
  small client change.
- **B4. The Codex** — surface durable flags as discovered "truths" (a journal
  of secrets/places/facts). Collection instinct + proof the world remembers.

### Pillar C — People You Care About (relationships)
- **C1. NPCs, Lights On** — add `npc_disposition_delta`, `npc_learn_fact` (and
  a clamped `npc_spawn`) to the LLM effect schema; seed all starter stories
  with `initialNpcs` (task 59); disposition shifts render as pips ("Mira
  trusts you a little more"). Companion presence + `includeCompanions` skill
  checks make social choices mechanical.
- **C2. A Recurring Antagonist** — the beat sheet names a pursuer whose
  pressure escalates per act (tracked NPC state, not just prose).
- **C3. Talk-to-NPC focused loop** — task 58 (deferred Phase 2), later.

### Pillar D — Pressure (stakes, scarcity, time)
- **D1. The Guttering Candle (doom clock)** — a per-run visible clock, on-theme
  (the candle burns down). Certain beats/choices/turns advance it; at zero the
  climax forces itself in a degraded state. Urgency + fast-risky vs slow-safe
  tradeoffs.
- **D2. Scarcity Pass** — prompt contract for resource meaning: wounds persist
  (delayed drains), currency has uses (bribes/tolls/purchases) with
  can't-afford locks via B1, supplies matter.
- **D3. Hardcore Mode, Selectable + Difficulty Presets** — engine already
  supports permadeath; expose it (Req 8.4), tune clocks/check difficulty/clamps
  per preset. Stakes tier for players who want teeth.

### Pillar E — Reasons to Return (meta/retention)
- **E1. The Tome Remembers** — endings unlock keepsakes/epithets; New Game+
  carries ONE keepsake into the next run (the specs' "tome that remembers
  across volumes," product.md:93); librarian rank across the account.
- **E2. The Daily Tale** — one shared seed per day (same dramatic question for
  everyone), compare endings, "first to find / rarest path" leaderboards
  (Req 23 exists, thin). The Wordle loop.
- **E3. What-Might-Have-Been** — at an ending, reveal 1–2 fogged
  paths-not-taken ("Had you trusted the ferryman…") → direct replay pull
  (product.md:31, never built).
- **E4. Candle-relit push notification** — native retention hook (LR-8), later.

## Phased plan

### Wave 1 — "The Spine" (build first; highest impact per effort)
A1 arc beats + quest surfacing (Req 32, tasks 60–63) · A3 earned endings ·
B3 echo fix · B1 conditional/locked choices · A2 delayed effects live.
Rationale: turns the treadmill into pursuit with felt consequence. Leverage is
extreme — `delayed.ts` and `visibility.ts` already work; the biggest artifact
is the scene-prompt contract + `pendingArcBeats` persistence; UI is a quest
line, act header, threads pill, richer echo.

### Wave 2 — "Teeth & Hearts"
B2 skill checks w/ visible risk · C1 NPCs lights-on (schema + `initialNpcs`
seeds + disposition pips) · D1 doom clock · D2 scarcity pass · B4 codex.

### Wave 3 — "Return"
E1 keepsakes/NG+ · E2 daily tale · E3 what-might-have-been · D3 hardcore +
difficulty · C2 antagonist arc (C3 later).

## Recommendations
1. Build Wave 1 as one multi-agent effort; it is mostly engine-glue + prompt
   contract + light UI, and every piece de-risks the others.
2. Treat the scene prompt as the product's most leveraged file: it currently
   optimizes for variety; Wave 1 re-centers it on pursuit + stakes while
   keeping the anti-repetition rules.
3. Do NOT add new media features until Wave 1 ships — the cinematics are
   already ahead of the gameplay.
4. Measure with the existing analytics: activation (≥5 turns), turns per
   session, endings unlocked per account, D1/D7 — Wave 1 should move all four.
