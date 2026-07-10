# Tasks — Story Engagement

Execution: three sequential waves, each a parallel Opus agent team with
disjoint file ownership + an integrator. Every agent MUST read
`design.md` §0 BUILD CORRECTIONS before its first edit. Requirement ids
(R1–R16) refer to `requirements.md`. Merge gate per wave: full monorepo
typecheck + full test suite green, then dockerized deploy
(`docker compose restart convex` / `restart app`).

Conventions for every task: tolerant-drop at LLM boundaries (BC5), optional
fields + legacy branch (BC9), engine purity (BC6), conditional-spread (BC4),
wire shapes exactly per design §7 (BC2), full function paths (BC1).

---

## WAVE 1 — THE SPINE

### Agent W1-ENGINE — owns `packages/engine/src/{arc.ts,types.ts,llm.ts,delayed.ts}` + engine tests

- [ ] **W1-E1 — Arc types + module** (R1). Create `arc.ts` with the types and
  pure functions from design §1.1–1.2 (`synthesizeFallbackArc`,
  `validateProposedArc`, `nextTargetBeat`, `fireBeat`, `advanceActIfDue`,
  `arcAllowsEnding`, `normalizeEndingId`). Clamps: question 8–160, want
  8–120, stakes 8–160, beats 3–5 (labels ≤80, ids sluggified ≤48, dedup),
  candidateEndings 2–4 (ids slug ≤48, labels ≤80, hints ≤120). Force ≥1
  `requiredBeforeEnding` (promote `climax` if none). `nextTargetBeat` bands:
  early ≤ turn 4, mid 5–9, late ≥10; pending beats only; tie-break by beats
  array order. Export from `types.ts`/barrel (report barrel need to
  integrator — BC7). Tests: table-driven for every function incl. malformed
  input → null, idempotent fireBeat, act advancement matrix.
- [ ] **W1-E2 — llmSceneOutputSchema: storyArc + beatFired** (R1.1, R1.4).
  Optional `storyArc` raw field (validated later via `validateProposedArc` —
  schema-level only shape-checks strings/arrays loosely, tolerant), optional
  `beatFired` clampedString(1–48). Mirror the `protagonistAnchor` turn-1
  one-time doc comment style. Tests: valid arc round-trips; garbage arc →
  field dropped, scene survives (BC5).
- [ ] **W1-E3 — Enable delayed effects + notes** (R3.1–R3.2). In
  `llm.ts` applyEffects: stop dropping `delayed`; schedule via the existing
  delayed store with `note` (extend the delayed record type in
  `delayed.ts`/`types.ts`, optional). Enforce ≤1 delayed effect per proposal
  (extras dropped). In `applyLlmSceneToState`: tick delayed BEFORE choice
  effects each turn (reuse the authored tick fn); fired effects go through
  the same clamps as direct effects; emit diffs `thread_set{note}` /
  `thread_fired{note}`. Tests: schedule→N-turn fire with note; clamp on
  fire; ≤1/scene enforcement; legacy saves with no threads unaffected.
- [ ] **W1-E4 — Conditional choices in llmChoiceSchema** (R4). Optional
  `conditions` (0–2, subset per R4.1, each entry individually
  tolerant-dropped), optional `lockedHint` ≤90. New pure
  `evaluateLlmChoiceVisibility(choice, state)` mapping conditions →
  `"visible" | "locked"` by adapting `visibility.ts` predicates
  (stat_at_least/at_most, has/missing_item, flag_equals, currency_at_least —
  add the currency predicate if absent). Unknown-referent conditions dropped
  at evaluation (choice visible). Enforce: ≤1 locked choice per scene, ≥2
  visible choices on non-terminal scenes (unlock least-restricted overflow).
  Tests: each predicate, unknown-referent drop, the ≥2-visible guarantee,
  hint clamp.
- [ ] **W1-E5 — Terminal gate engine-side** (R2). In `applyLlmSceneToState`:
  implement the gate matrix from design §2.2 as a pure decision
  `gateTerminal(arc|undefined, proposal.terminal, turnNumber, vitality)` →
  `{terminal: LlmTerminal|null, directive: "surface_beat:<id>" |
  "narrate_costly_survival" | null}`. Vitality-0 death always passes.
  Arc-less → legacy behavior signal (caller keeps guardEarlyTerminal).
  `normalizeEndingId` on accepted terminals. Emit diffs `beat_fired`,
  `act_advanced` when beatFired lands. Tests: full matrix (arc/no-arc ×
  death/success/safe × beats fired/unfired × turn<6/6–29/≥30).
- [ ] **W1-E6 — EngineDiff extensions** (R5). Add diff kinds per design §1.3
  W1 set; every diff tagged visible/hidden tier; existing diff consumers
  untouched (additive union). Tests: diff emission per new mechanic.

### Agent W1-SERVER — owns `convex/game.ts`, `convex/llm/prompts/scene.ts`, `convex/llm/parse.ts`, `convex/saves.ts` + convex tests

- [ ] **W1-S1 — Arc creation + persistence** (R1.1–R1.2, R16.2). Turn-1
  llm-driven completion: `validateProposedArc(proposal.storyArc)` else
  `synthesizeFallbackArc(premise, seedTitle)`; run every arc string through
  `evaluateTextPolicy` (blocked → neutral placeholder, never fail); persist
  into `nextState.arc`. Analytics `arc.created {source}`. Mirror in the
  non-streaming path. Tests: proposal arc persisted; omitted → synthesized;
  policy-blocked label replaced.
- [ ] **W1-S2 — Terminal gate wiring + directives** (R2). Replace
  `guardEarlyTerminal` call for arc saves with engine `gateTerminal`; store
  `pendingDirective` on the save (string, optional — inside state or a save
  field reported to integrator; prefer `state.pendingDirective` to avoid
  schema change), consumed+cleared by the next prompt build. Analytics
  `arc.ending_gated {beatId}`. Keep legacy guard for arc-less saves. Tests:
  gated success → no terminal persisted + directive stored + next prompt
  contains surface-beat text; death honored at vitality 0.
- [ ] **W1-S3 — Prompt: PURSUIT section + turn-1 arc block + rules** (R6, R1.3,
  R2.5, R3.3, R4 guidance). Implement design §3 exactly: pursuit section
  above memory window; beatFired instruction; pendingDirective injections;
  thread-fires line (from last turn's `thread_fired` diffs); rules updates
  (choice consequence, gated choice, threads vocabulary incl. `delayed` with
  note, endings-from-candidates). Turn-1: STORY ARC production block with the
  JSON contract. KEEP all existing anti-repetition/stat-narration rules.
  Tests: snapshot of pursuit section; spoiler test — candidate endings appear
  only in the endings rule, pending beat labels only in the steer line;
  token-budget test (≤ baseline+900 for W1).
- [ ] **W1-S4 — Diff persistence + projection** (R5.1, R1.5, R4.3, BC10).
  Persist visible-tier redacted diffs (cap 12) to
  `turn_history.visibleDiffs` (field landed by integrator); extend
  `projectLlmDrivenScene`: `projection.arc` (question/act/actLabel/counts +
  threadsPending), `projection.recentDiffs` (wire shape design §7),
  choice `state`/`lockedHint` via `evaluateLlmChoiceVisibility`. NO pending
  beat labels / candidate endings / unfired thread notes in any projection
  (add the spoiler-absence test). Tests: diff redaction (hidden stat →
  dropped), locked choice projected, arc counts correct.
- [ ] **W1-S5 — Locked-choice submission guard** (R4.3). In
  `beginStreamingChoice` (and non-streaming mirror): recompute visibility of
  the submitted choiceId against current state; locked/unknown →
  `AppError("choice_not_available")` (no turn consumed, no daily-cap charge).
  Analytics `choice.locked_denied`. Tests: locked rejected + counter intact;
  race (state changed since render) rejected safely.
- [ ] **W1-S6 — Chapter cinematic on act advance** (design §2.4). Fire
  `maybeScheduleChapterCinematic` on `act_advanced` (primary) with turn
  cadence as arc-less fallback; existing cap/dedupe unchanged. Test: act
  advance schedules once.
- [ ] **W1-S7 — parse.ts drop-logging** (BC5). Extend `logDroppedLlmEffects`
  to also log dropped conditions / storyArc / beatFired (counts + kinds
  only). Test: log fires without throwing on garbage.

### Agent W1-CLIENT — owns `apps/app/components/reading/{QuestLine.tsx,ChapterEnd.tsx,ThreadsPill.tsx}`, `EffectBadge`/`ChoiceList` touchpoints, `apps/app/hooks/useTurn.ts`, `apps/app/lib/gameApi.ts` types + client tests

- [ ] **W1-C1 — Projection types + adapter** (BC2). Extend the projection
  types in `lib/gameApi.ts` per design §7 (null→optional adaptation at the
  boundary). No behavior change yet. Test: adapter maps null fields.
- [ ] **W1-C2 — QuestLine + arc drawer panel** (R1.5). New `QuestLine`
  rendered by `ReaderScreen` under AppNav when `projection.arc` present
  (all five layouts get it via ReaderScreen, not per-layout). Tap opens the
  peek-drawer arc panel (question/want/stakes/act/fired beats w/ turns/
  thread count). Serif italic, muted — the book metaphor rules
  (product principle 1). Tests: hidden for legacy saves; renders counts.
- [ ] **W1-C3 — Signed echo** (R5.2). Rewrite `deriveRemoteEcho` to consume
  `recentDiffs` → signed chips (+2 Nerve · −1 ♥ · + Bone Key · 🧵 · ⭑ beat);
  hidden-only turns → "something shifted…". Snapshot fallback when diffs
  absent. Update `ConsequenceReel` to prefer diffs. Tests: mapping table,
  fallback, hidden-only case.
- [ ] **W1-C4 — Locked choice rendering** (R4). `ChoiceList`: locked cards
  render 🔒 + muted style + `lockedHint`; press → shake + hint reveal, no
  submit; defensive toast on server `choice_not_available`. Accessibility
  labels ("Locked — requires…"). Tests: render model for
  visible/locked, press-no-submit.
- [ ] **W1-C5 — ThreadsPill + act header** (R3.4, R1.5). ThreadsPill near HUD
  ("🧵 N threads yet to pull", hidden at 0); one-shot "An earlier choice
  echoes" toast on a `thread:fired` diff. `ChapterEnd` gains optional
  actNumber/actLabel stamp ("Act II — <label>") when the boundary's diffs
  include `act_advanced`. Tests: pill count, toast one-shot, act stamp.

### INTEGRATOR (W1)

- [ ] **W1-I1 — Schema**: `turn_history.visibleDiffs: v.optional(jsonValue)`;
  confirm no other schema need surfaced by agents (BC7).
- [ ] **W1-I2 — Contract smoke tests** (BC1/BC2): assert every
  `lib/gameApi.ts` path string resolves in the convex function spec; diff
  wire-shape fixture shared by a server test and a client test (same JSON
  file) so drift fails both.
- [ ] **W1-I3 — Full sweep + deploy**: typecheck all workspaces; full tests;
  `docker compose restart convex && restart app`; live-run checklist: new
  save shows QuestLine, echo shows signed deltas, a gated choice appears
  within ~6 scenes, premature ending gets gated (`arc.ending_gated` in
  analytics), thread fires with toast, ending answers the question.
- [ ] **W1-I4 — Metrics baseline**: capture pre/post turns-per-session and
  activation from the ops dashboard for the rollout note.

---

## WAVE 2 — TEETH & HEARTS

### Agent W2-ENGINE — owns engine skill-check/clock/npc/codex extensions + tests

- [ ] **W2-E1 — skillCheck on choices** (R7.1). `llmChoiceSchema` +=
  optional `skillCheck {statId, difficulty easy|risky|desperate,
  successNote ≤90, failNote ≤90}`; ≤1 checked choice/scene (extras
  dropped); mutually exclusive with `conditions` (conditions win, check
  dropped). Tests: clamps, exclusivity, per-scene cap.
- [ ] **W2-E2 — Check resolution + outcome table** (R7.2–R7.3, design §5).
  Pure `resolveChoiceCheck(state, check, rngSeed)` → `{outcome, margin,
  breakdown, engineEffects[]}` using existing `resolveSkillCheck` +
  companion bonus + item bonus (+1 when an inventory item's id/label
  token-matches the statId or check notes — keep dumb + deterministic);
  outcome effect table per design §5 with afford-aware fail cost
  (vitality→currency→clock order). Odds phrase fn for UI. Diff
  `check_resolved`. Tests: threshold matrix, seeded determinism, afford
  fallback, partial halving.
- [ ] **W2-E3 — Clock** (R9). `StoryClock` + `tickClock` (+1 per 3rd
  completed turn), `applyClockAdvance` clamp, `clockDirective` bands,
  `clock_advance` LLM effect (≤1/scene, amount 1|2), expiry → auto-fire
  `dark_night` beats + `clock_expired` diff. Hardcore max reduction hook
  (param, used W3). Tests: band/threshold table, expiry beat auto-fire.
- [ ] **W2-E4 — npc_* LLM effects** (R8.1). Add `npc_disposition_delta`
  (±15/turn/NPC net clamp), `npc_learn_fact` (≤120, 12-cap FIFO),
  `npc_spawn` (slug id, roster cap 8, dup-drop, disposition 0, role enum)
  to `llmEffectSchema`; unknown npcId → drop. Diffs `disposition_shift`
  (with prevDisposition), `fact_learned`. IMPORTANT: update the Req 31.2
  guard tests — spawn/disposition/fact are now LLM-legal; the OTHER npc_*
  kinds (relocate, attribute/inventory/flag mutations, despawn) remain
  dropped. Tests: clamps, caps, dup/unknown drops, guard-test update.
- [ ] **W2-E5 — Codex helper** (R11.1). Pure `deriveCodex(state)` → string-
  valued flags newest-first cap 40 `{flag,text,turnNumber}` (turn recorded
  at set time — store alongside flag or derive from diffs; pick the cheap
  one and document). Tests: ordering, cap, non-string exclusion.

### Agent W2-SERVER — owns `convex/game.ts` check/clock wiring, `convex/llm/prompts/scene.ts` W2 sections, `convex/saves.ts` projections, `packages/stories/*` seeds, task-55 mentions + tests

- [ ] **W2-S1 — Check resolution at submission** (R7.2). In
  `beginStreamingChoice`: chosen choice has skillCheck → `resolveChoiceCheck`
  with the per-turn seed; apply engineEffects immediately (engine-authored);
  stash `{outcome, statId, margin, successNote|failNote}` on the pending
  turn (state or scene row) → injected into the scene request; LLM effects
  of that choice applied only on success (thread through
  applyLlmSceneToState arg). Analytics `check.resolved`. Tests: outcome
  injected into prompt, fail withholds choice effects, deterministic replay.
- [ ] **W2-S2 — Clock wiring** (R9). Tick on turn completion; persist;
  `clockDirective` → prompt escalation section; expiry directive; reason
  strings through text policy. Analytics `clock.advanced/expired`. Tests:
  50/75/100 prompt content, legacy saves untouched.
- [ ] **W2-S3 — Prompt W2 sections** (R7.4-adjacent, R8.5, R9.3, R10, R11.3).
  RELATIONSHIPS lines (role, disposition band word, top 2 facts — reuse NPC
  sheet builder), check-outcome narration block ("the attempt FAILED (Nerve,
  barely) — narrate it; do not undo it"), clock escalation copy, scarcity
  rules (prices + can't-afford locks + wound-thread example), codex contract
  rule (string flags = recorded truths). Token budget test update
  (≤ baseline+1400 cumulative). Tests: snapshots + budget.
- [ ] **W2-S4 — Starters: NPCs + currency** (R8.2, R10.1). Add `initialNpcs`
  (1 companion + 1 rival/antagonist w/ descriptions, dispositions ±20) and
  starting currency (bone-cathedral 15, iron-court 40, ashfall 10 — flavor-
  fit) to the three llm-driven starters in `packages/stories`. Verify
  seed-flow NPCs still merge. Tests: story fixtures load, roster projected.
- [ ] **W2-S5 — Finish mentions wiring (core task 55)** (R8.4). Ensure
  `proposal.npcMentions` persists to `turn_history.mentionsExtracted` and
  the prompt's recent-mentions window consumes it; name-scan fallback from
  freeform text (task 57) if cheap. Tests: mention → next-prompt NPC sheet.
- [ ] **W2-S6 — Projections** (R7.4, R9.4, R11.2). `choices[i].check`
  (with server-computed odds phrase — never raw math), `projection.arc.clock`,
  `projection.codex`, npc diffs in recentDiffs. Spoiler test update. Tests:
  shapes per design §7.

### Agent W2-CLIENT — owns CheckChip/CheckBanner, CandleClock, NPC pips/roster trends, Codex tab + tests

- [ ] **W2-C1 — CheckChip + CheckBanner** (R7.4). Chip on choice cards
  (`⚄ Nerve — risky`); post-turn banner from `check_resolved` diff
  (success/partial/fail stamp + margin phrase; web dice animation;
  reduced-motion static). Tests: odds phrase render, banner from diff,
  reduced-motion.
- [ ] **W2-C2 — CandleClock** (R9.4). Segmented candle in peek drawer +
  inline flame ≥75%; advance pulse (reduced-motion none); reason in echo
  chips. Tests: segment math, threshold states.
- [ ] **W2-C3 — NPC pips + roster trends** (R8.3). EffectBadge renders
  disposition/fact diffs ("Mira ▾ wary", "Mira will remember that"); roster
  rows show trend arrow via prevDisposition. Tests: band mapping, arrows.
- [ ] **W2-C4 — Codex tab** (R11.2). FullSheet tab "Truths" listing codex
  entries + "✒️ New truth recorded" pip on new-entry diff. Tests: list,
  pip one-shot.

### INTEGRATOR (W2)
- [ ] **W2-I1 — Schema**: verify `mentionsExtracted` exists (add if not);
  no other fields expected. Contract smoke tests re-run (BC1/BC2).
- [ ] **W2-I2 — Full sweep + deploy + live checklist**: a checked choice
  shows odds and resolves visibly; failing a check costs; candle advances
  and escalates prose at 75%; companion disposition moves and displays; a
  price appears with a can't-afford lock; codex records a truth.

---

## WAVE 3 — RETURN

### Agent W3-SERVER-META — owns keepsakes, hardcore, librarian rank + tests

- [ ] **W3-M1 — Keepsake grant** (R12.1). `llmSceneOutputSchema` keepsake
  (terminal-only honored — engine clamps; coordinate one-line schema add
  with W1 pattern); in `recordEndingUnlock`: attach validated keepsake or
  ending-derived default to the unlock row (integrator lands
  `endings_unlocked.keepsake`); text policy; dedupe per account by id.
  Analytics `keepsake.granted`. Tests: grant, default derivation, dedupe.
- [ ] **W3-M2 — Keepsake carry** (R12.2). `game:createSave` accepts
  `keepsakeId?` (BC3 — widen args); validates ownership; injects inventory
  item tagged `keepsake`; opening prompt line (scene.ts). One per save.
  Analytics `keepsake.carried`. Tests: carry → inventory + prompt, invalid
  id rejected.
- [ ] **W3-M3 — Hardcore mode** (R15). `createSave` `mode?: "story"|"hardcore"`;
  hardcore: engine clock max −25% (W2-E3 hook), check difficulty +1 band,
  death → purge path (reuse the engine/lifecycle delete cascade; ASSETS TOO —
  reuse the orphan-sweep-safe deletion), hardcore-only unlock flag honored on
  trophy crypt; downgrade flow w/ caveat flag; NO mid-run upgrade. Tests:
  purge cascade, unlock flag, downgrade caveat.
- [ ] **W3-M4 — Librarian rank** (R12.3). Pure rank fn (thresholds:
  Novice 0 / Keeper 3 endings / Archivist 8 endings+10 beats / Librarian 15
  endings+3 tales / Unwritten 30+10+10); expose in profile projection
  (accountFunctions — widen, BC3). Tests: threshold table.

### Agent W3-SERVER-DAILY — owns `convex/daily.ts` (pure), `convex/dailyFunctions.ts` (new), terminal hook + tests

- [ ] **W3-D1 — Daily mint** (R13.1, design §6). Pure premise builder
  (14-tone rotation × template bank, date-seeded deterministic); mint action:
  one router LLM call for the storyArc (deterministic fallback arc on
  failure), all-ages policy check, persist `daily_tales` (integrator lands
  table + cron). Idempotent per date. Tests: determinism per date,
  fallback arc, idempotency.
- [ ] **W3-D2 — dailyFunctions** (R13.2–R13.4, BC1). `getToday` /
  `startDaily` / `getResults` with EXACT wire shapes from design §7;
  startDaily: one-per-day guard (`daily_already_played`), creates save with
  injected arc (`source:"daily"`, skip turn-1 arc gen), guest-compatible
  auth (accountId+guestTokenHash pattern). Tests: one-per-day, guest start,
  results distribution math (pct, first-finder).
- [ ] **W3-D3 — Terminal hook** (R13.3). On accepted terminal for
  `save.dailyId`: insert `daily_results` (idempotent accountId+dailyId);
  analytics `daily.finished`. Coordinate the small game.ts hook with the
  integrator (reserved-adjacent). Tests: idempotent insert.

### Agent W3-CLIENT — owns KeepsakePicker, DailyCard/DailyResults, WhatMightHaveBeen, HardcoreSelect, profile rank + `lib/dailyApi.ts` + tests

- [ ] **W3-C1 — dailyApi + DailyCard + DailyResults** (R13.4, BC1: full
  registered paths `dailyFunctions:getToday` etc.). Home card (title,
  question teaser, countdown, played state); results screen (your ending vs
  distribution bars, first-finder badge, rarest callout). Tests: adapter
  null-mapping, countdown math, distribution render model.
- [ ] **W3-C2 — KeepsakePicker + inventory badge** (R12.2). New-story flow
  chip picker (≤1, owned keepsakes from profile projection); keepsake badge
  in inventory list. Tests: single-select, absent for keepsake-less
  accounts.
- [ ] **W3-C3 — WhatMightHaveBeen** (R14). On EndingPanel for arc saves:
  1–2 fogged unreached candidate cards (label+hint) + "Fork from a
  decision" (existing fork flow) + "Begin again" CTAs; fogged candidate
  ghosts on the endings map. Data: `projection.ending.whatMightHaveBeen`.
  Tests: card selection (unreached only), CTA wiring.
- [ ] **W3-C4 — HardcoreSelect + consent + death variant** (R15). Mode
  select at creation, consent screen copy ("this tome does not forgive"),
  hardcore death screen variant (purge acknowledgment), settings surface
  for downgrade w/ caveat. Tests: consent gate, downgrade caveat display.
- [ ] **W3-C5 — Profile rank + keepsakes shelf** (R12.3). Rank chip +
  keepsake shelf on profile. Tests: render model.

### INTEGRATOR (W3)
- [ ] **W3-I1 — Schema + crons**: `daily_tales` + `daily_results` tables +
  indexes, `endings_unlocked.keepsake`, `saves.dailyId`/`keepsakeCarried`,
  `crons.ts` `mint-daily-tale` (00:05 UTC), `createSave`/`accountFunctions`
  arg widening double-check (BC3).
- [ ] **W3-I2 — Contract smoke tests** for dailyApi paths + profile
  projection; spoiler test extended (candidate endings appear ONLY in
  post-terminal whatMightHaveBeen).
- [ ] **W3-I3 — Full sweep + deploy + live checklist**: play today's Daily to
  an ending → results distribution renders; carry a keepsake into a new run
  and see it woven in; hardcore death purges; fogged what-might-have-been
  cards appear and fork works.
- [ ] **W3-I4 — Metrics review**: D1/D7, daily participation rate,
  keepsake-carry rate, `arc.ending_gated` rate vs W1 baseline; write the
  outcome note at the top of this file.

---

## Cross-wave invariants (every integrator re-verifies)
- Legacy saves: no arc → no QuestLine/clock/gates; play exactly as before.
- No projection ever leaks pending beat labels, candidate endings
  (pre-terminal), unfired thread notes, or hidden stats (BC10 test suite).
- Token budget cumulative ≤ baseline+1600 (R16.5).
- All new analytics events fire-and-forget (never block a turn).
- `pnpm typecheck` + full test suite green before any deploy.
