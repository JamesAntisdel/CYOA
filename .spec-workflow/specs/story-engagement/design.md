# Design — Story Engagement

Companion to `requirements.md` (R1–R16) and `tasks.md`. Audience: the Opus
agent teams implementing each wave. Read the BUILD CORRECTIONS first — they
encode every integration bug class we actually hit shipping omni-cinematics.

---

## 0. BUILD CORRECTIONS (authoritative — read before coding)

- **BC1 — Convex function paths include the directory.** A function in
  `convex/media/x.ts` registers as `media/x:fn`. Client `convexHttp` calls
  MUST use the full path (we shipped a silent 3-day bug calling
  `cinematicFunctions:getSaveCinematics` without `media/`). New functions in
  this spec live at top level (`convex/arcFunctions.ts` → `arcFunctions:fn`)
  or under a dir — either way the client string must match exactly. Add a
  smoke test asserting each new client path string appears in a registered
  function spec.
- **BC2 — `convexHttp` casts, it does not validate.** Client↔server view
  shape mismatches typecheck clean and fail at runtime. EVERY new
  client-facing query/mutation gets its wire shape written in THIS doc (§7)
  and adapted at the `apps/app/lib/*Api.ts` boundary (server null-for-absent →
  client optional-field), exactly like `cinematicApi.ts`.
- **BC3 — Convex arg validators reject unknown args.** If the client sends a
  new field to an existing mutation, that mutation's `args` MUST be widened in
  the same wave (we hit this with `cinematicMode` on `setMediaPrefs`).
- **BC4 — `exactOptionalPropertyTypes` is ON in the app.** Optional props are
  `T | undefined` and conditional-spread (`...(x ? {x} : {})`) is the house
  pattern.
- **BC5 — Tolerant-drop at the LLM boundary.** Malformed/unknown LLM output
  (effects, conditions, beatFired ids, npcIds, arc fields) is DROPPED, never a
  turn failure — `llmChoiceSchema.effects` already does this (reduce +
  safeParse in `packages/engine/src/llm.ts`); extend the same pattern. Log
  drops at `convex/llm/parse.ts` (`logDroppedLlmEffects` precedent) so model
  drift stays visible. `llm_scene_invalid_shape` remains only for
  missing/broken prose+choices.
- **BC6 — The engine package is pure.** No `console`, no Date.now() hidden
  deps — engine functions take `now`/`rngSeed` via ctx (existing pattern in
  `applyLlmSceneToState({ctx:{now,rngSeed}})`). Logging happens in convex.
- **BC7 — Schema/table changes are integrator-owned.** `convex/schema.ts`,
  `convex/crons.ts`, and `convex/index.ts` are RESERVED files; agents report
  needed fields, the integrator lands them (prevents the parallel-edit
  clobbering we saw).
- **BC8 — Deploy flow is dockerized** (`cyoa-local` compose): convex restarts
  re-push (`docker compose restart convex`); web needs
  `docker compose restart app` (re-exports); env changes need `.env` +
  `push_env` in `scripts/dev/convex-local-dev.sh` + container recreate. Tests:
  convex/engine/packages = vitest, apps/app = `node --test` (plus the app
  vitest config for `components/media/__tests__`).
- **BC9 — Old saves must keep working untouched.** Every new field on
  `saves.state` / schema is optional; every code path branches
  `if (arc) … else legacy`. `MIN_TURN_BEFORE_TERMINAL` guard stays for
  arc-less saves.
- **BC10 — Spoiler discipline in projections.** `projectLlmDrivenScene`
  (convex/saves.ts) is the single choke point deciding what the client sees.
  Pending beat labels, candidate endings (pre-terminal), un-fired thread
  notes, hidden stats: NEVER projected. Add a projection test per wave
  asserting the spoiler fields are absent.

---

## 1. Data model

### 1.1 Engine state additions (`packages/engine/src/types.ts`, all optional)

```ts
// PlayerState additions
arc?: StoryArc;
threads?: DelayedThread[];        // wraps existing delayed-effect records w/ note
clock?: StoryClock;               // W2

type StoryArc = {
  dramaticQuestion: string;       // 8–160
  protagonistWant: string;        // 8–120
  stakes: string;                 // 8–160
  act: 1 | 2 | 3;
  actLabel?: string;              // generated on act advance
  beats: ArcBeat[];               // 3–5
  candidateEndings: CandidateEnding[]; // 2–4
  antagonistNpcId?: string;       // W2 (C2)
  clockLabel?: string;            // W2
  source: "llm" | "synthesized" | "daily";
};
type ArcBeat = {
  id: string; label: string;
  kind: "inciting" | "midpoint" | "dark_night" | "climax" | "custom";
  priorityHint: "early" | "mid" | "late";
  requiredBeforeEnding: boolean;
  status: "pending" | "fired";
  firedAtTurn?: number;
};
type CandidateEnding = { id: string; label: string; hint: string };
type StoryClock = { label: string; value: number; max: number; expired: boolean };
```

`DelayedThread` = the existing delayed record shape + `note?: string`. Reuse
`delayed.ts` storage (state.delayed / pendingDelayed — match existing field
name in `state.ts`); do NOT create a parallel store, only extend the record.

### 1.2 New engine module `packages/engine/src/arc.ts` (pure)

```ts
synthesizeFallbackArc(premise: string, seedTitle?: string): StoryArc
validateProposedArc(raw: unknown): StoryArc | null       // clamp lengths, dedupe ids, force ≥1 required climax
nextTargetBeat(arc, turnNumber): ArcBeat | null           // priorityHint × band (early≤4, mid 5–9, late 10+), pending only
fireBeat(arc, beatId, turn): { arc, fired: boolean }      // idempotent, unknown id → fired:false
advanceActIfDue(arc): StoryArc                            // act1→2 on inciting fired; act2→3 on midpoint fired
arcAllowsEnding(arc): boolean                             // all requiredBeforeEnding fired
normalizeEndingId(arc, proposedId): string                // fuzzy match candidateEndings (slug distance), else proposedId
// W2:
tickClock(clock, turnNumber): StoryClock                  // +1 every 3rd completed turn
applyClockAdvance(clock, amount): StoryClock
clockDirective(clock): "none" | "escalate_50" | "escalate_75" | "climax_now"
```

### 1.3 LLM schema additions (`packages/engine/src/llm.ts`)

- `llmSceneOutputSchema` += optional:
  - `storyArc` (turn-1 only; validated via `validateProposedArc`; ignored on
    later turns — same one-time pattern as `protagonistAnchor`),
  - `beatFired: clampedString(1..48)`,
  - `keepsake {id,label,description}` (W3; only honored on terminal scenes).
- `llmChoiceSchema` += optional `conditions` (0–2, tolerant-drop per entry),
  `lockedHint`, `skillCheck` (W2), all length-clamped.
- `llmEffectSchema` changes:
  - **stop dropping `delayed`** in `applyEffects` — apply via existing
    delayed scheduling, carrying `note`;
  - W2 adds: `npc_disposition_delta` (±15 clamp), `npc_learn_fact` (≤120,
    12-cap FIFO), `npc_spawn` (roster cap 8, slug id, disposition 0),
    `clock_advance {amount 1|2, reason ≤80}` (≤1/scene — extra dropped).
- `applyLlmSceneToState` additions, in order: tick delayed (fire due threads
  → diffs `thread_fired`), apply chosen-choice effects, apply beatFired →
  `fireBeat` + `advanceActIfDue` (diff `beat_fired`), W2 tick/apply clock
  (diffs `clock_advanced`, `clock_expired`), terminal gating (see §2).
- **EngineDiff** gains kinds: `thread_set{note}`, `thread_fired{note}`,
  `beat_fired{label}`, `act_advanced{act}`, `clock_advanced{amount,reason}`,
  `disposition_shift{npcId,delta}` (W2), `fact_learned{npcId}` (W2),
  `check_resolved{outcome}` (W2). Each carries `visibility: "visible"`
  except where noted; hidden-stat diffs remain hidden-tier.

### 1.4 Convex schema additions (integrator-owned; all optional)

```
saves:            dailyId?: v.string()            // W3
                  keepsakeCarried?: v.string()    // W3 (keepsake id)
turn_history:     visibleDiffs?: jsonValue        // W1 (redacted signed diffs)
                  mentionsExtracted (exists — verify) 
endings_unlocked: keepsake?: v.object({id,label,description})  // W3
daily_tales:      NEW table {date (yyyy-mm-dd, unique index), premise, tone,
                  title, storyArc: jsonValue, createdAt}        // W3
daily_results:    NEW table {dailyId, accountId, endingId, turnCount,
                  finishedAt} + by_daily index                  // W3
```

`saves.state` is already an opaque json blob — arc/threads/clock ride inside
it with NO schema change (BC9).

---

## 2. Turn-loop wiring (`convex/game.ts`)

All in the llm-driven branch of `completeSceneStream` (+ the non-streaming
mirror), where `guardEarlyTerminal` currently lives (~game.ts:2330):

1. **Arc creation (turn 0/1):** if proposal has `storyArc` →
   `validateProposedArc`; else `synthesizeFallbackArc(premise)`. Persist into
   `nextState.arc` BEFORE terminal gating. Safety: question/want/stakes/beat
   labels/candidate labels through `evaluateTextPolicy`; blocked strings →
   neutral placeholders (never fail the turn) — same pattern as
   `buildBeatTimeline` in `convex/media/cinematics.ts`.
2. **Terminal gate (replaces guardEarlyTerminal for arc saves):**
   - vitality-0 death → always honored (engine already forces).
   - proposed death, midpoint not fired → strip terminal, set
     `pendingDirective = "narrate_costly_survival"` on the save (read by next
     prompt build, then cleared).
   - proposed success/safe, `!arcAllowsEnding(arc)` and turn < 30 → strip
     terminal, `pendingDirective = "surface_beat:<beatId>"` +
     analytics `arc.ending_gated`.
   - accepted terminal → `normalizeEndingId`; ending scene directive already
     satisfied by prompt rule (R2.5).
   - arc-less saves: legacy `guardEarlyTerminal` unchanged.
3. **Diff persistence (R5):** `applyLlmSceneToState` returns diffs; filter to
   visible tier, redact hidden stats, write `turn_history.visibleDiffs` on
   the row already inserted per turn. Cap 12 diffs/turn.
4. **Chapter cinematic unification:** `maybeScheduleChapterCinematic` fires
   on `act_advanced` diffs (primary) with the existing turn-cadence as
   fallback for arc-less saves; the existing per-run cap/dedupe stands.
5. **W2 skill checks:** in `beginStreamingChoice` (before LLM call): if the
   stored proposal's chosen choice has `skillCheck` → resolve via
   `resolveSkillCheck` with the per-turn seed; outcome effect deltas from the
   fixed table below applied by engine; outcome + margin injected into the
   scene request (`checkOutcome` field on the request → prompt section). The
   choice's own LLM effects apply only on success (R7.3).

   Outcome table (engine constant): success → intended effects + nothing
   extra; partial → intended effects halved (round toward 0) + clock +1 (W2)
   or −1 vitality; fail → no intended effects, −1 vitality OR −10 currency OR
   clock +2 (pick by what the save can afford, in that order), plus
   `failNote` surfaced. Odds derivation for the UI: stat 0–1 desperate /
   2–3 risky-even / 4–5 likely, shifted one band by difficulty.
6. **W2 clock:** `tickClock` every completed turn; `clockDirective` result
   stored on save → prompt escalation section; `clock_expired` diff triggers
   auto-fire of `dark_night` beats.
7. **W3 keepsake grant:** in `recordEndingUnlock`, attach proposal keepsake
   (validated/clamped) or derived default to the unlock row.
8. **W3 daily:** `createSave` accepts optional `dailyId`; validates one/day
   per account (index probe), injects the daily's pre-built arc
   (`source:"daily"`), skips turn-1 arc generation (prompt told the arc is
   fixed). Terminal on a daily save → insert `daily_results` (idempotent per
   accountId+dailyId).

---

## 3. Prompt contract (`convex/llm/prompts/scene.ts`)

New sections in `buildLlmDrivenPrompt`, placed ABOVE the memory window
(canonical state before texture, matching the Req 33 placement rule):

```
== YOUR PURSUIT (the spine — this outranks variety) ==
Dramatic question: <q>
The protagonist wants: <want>   Stakes if they fail: <stakes>
Act <n>. Beats already landed: <fired labels or "none">.
STEER TOWARD (subtly, within 1–2 scenes): "<target beat label>".
When THIS scene lands that beat, set "beatFired": "<id>".
[if pendingDirective=surface_beat] The story tried to end too early — this
scene must put "<beat label>" on stage.
[if pendingDirective=narrate_costly_survival] The reader survives, barely —
narrate a costly escape; no terminal.
[W2, by clockDirective] The <clockLabel> is at <value>/<max> — <escalation
copy per band; at climax_now: move directly into the climax, degraded>.
[threads] A THREAD FIRES THIS SCENE: "<note>" — narrate the callback.
```

Rules block edits (keep every existing rule; renumber):
- CHOICE CONSEQUENCE (replaces the tail of the divergence rule): every choice
  should advance the pursuit, spend/risk a resource, or change a
  relationship; label costs concretely ("(−15 gold)").
- GATED CHOICE: every 2–4 scenes include ONE choice with `conditions` +
  `lockedHint` referencing state the reader has or nearly has; ≤1 per scene.
- THREADS: `delayed` effect vocabulary + "use for foreshadowing, ≤1/scene,
  note = the foreshadow line."
- ENDINGS: choose `terminal.endingId` from CANDIDATE ENDINGS <list>; the
  final scene must answer the dramatic question. (Candidate list appears
  ONLY in this rule, never echoed in prose verbatim.)
- W2 RELATIONSHIPS / CHECKS / CLOCK / SCARCITY rules per R7–R10 (facts,
  disposition narration, one NPC-involving choice per 2–3 scenes, prices).
- W3 KEEPSAKE rule (terminal scenes may name one).

Token budget test: `promptBudget.test.ts` snapshots a worst-case prompt and
asserts ≤ baseline+1600 tokens (rough 4-chars/token heuristic).

Turn-1 additions: STORY ARC instruction block (produce storyArc JSON per R1.1
— schema mirrored in the JSON contract section of the prompt).

---

## 4. Client design (`apps/app`)

### 4.1 Wave 1 surfaces
- **QuestLine** (`components/reading/QuestLine.tsx`): one-line italic serif
  strip under AppNav on all layouts: "❝<dramaticQuestion>❞ · Act II ·
  ●●○○ beats". Data from projection.arc. Hidden when absent (legacy saves).
  Tap → opens peek drawer arc panel (question, want, stakes, act, fired-beat
  list with turn numbers, thread count, W2 candle).
- **ActHeader**: the existing `ChapterEnd` interstitial gains
  `actLabel`/`actNumber` props — shown as "Act II — <label>" stamp when the
  boundary coincides with an act advance (server diff `act_advanced` recorded
  in visibleDiffs; client reads from the turn's diffs).
- **ThreadsPill**: subtle pill near the HUD: "🧵 2 threads yet to pull";
  fires a one-shot "An earlier choice echoes" toast on `thread_fired` diff.
- **Echo fix**: `deriveRemoteEcho` consumes `projection.recentDiffs` → signed
  chips (`+2 Nerve`, `−1 ♥`, `+ Bone Key`, `🧵 set`, `⭑ beat`). Falls back to
  today's snapshot when diffs absent (old turns).
- **Locked choices**: `ChoiceList` renders `state:"locked"` choices with 🔒,
  muted card, `lockedHint` caption; presses show a shake + hint (no submit).
  Choice submission already round-trips choiceId — server rejects locked
  (`choice_not_available`) and the client toasts it defensively.

### 4.2 Wave 2 surfaces
- **CheckChip** on choice cards: `⚄ Nerve — risky`; post-resolution
  **CheckBanner** (success/partial/fail stamp + margin phrase; dice roll
  animation web-only, reduced-motion → static). Data: choice.skillCheck in
  projection + `check_resolved` diff on the following turn.
- **CandleClock**: segmented candle in StatsHud peek drawer + tiny inline
  flame at 75%+; advance animation on `clock_advanced` diff.
- **NPC pips**: EffectBadge renders `disposition_shift` ("Mira ▾ wary") and
  `fact_learned` ("Mira will remember that"); NpcRoster rows get trend arrows
  (compare disposition vs `prevDisposition` carried in the diff).
- **Codex tab** in FullSheet: list of `{text, turnNumber}`; "✒️ New truth"
  pip via `codex`-derived diff (string flag_set).

### 4.3 Wave 3 surfaces
- **KeepsakePicker** in the new-story flow (chips of owned keepsakes, ≤1);
  keepsake item badge in inventory.
- **DailyCard** on home (`app/index.tsx`): title, question teaser, countdown,
  played-state; **DailyResults** screen: your ending vs distribution bars,
  first-finder badge — wire shapes §7.
- **WhatMightHaveBeen**: on `EndingPanel`, 1–2 fogged candidate cards with
  fork/replay CTAs (fork flow exists in tale/fork path — reuse).
- **HardcoreSelect** at save creation + consent screen; death screen in
  hardcore shows the purge ("the tome closes forever").
- Librarian rank chip on profile.

---

## 5. Skill-check math (W2, engine constant)

`score = stat + companionBonus + itemBonus(+1 if a tagged item applies) `
`roll = seededRand(0..5)`; thresholds by difficulty: easy 4, risky 6,
desperate 8. `score+roll ≥ t` → success; `≥ t−2` → partial; else fail.
Odds phrase precomputed server-side (BC10: client gets the phrase, not the
math): `likely | even | risky | desperate`.

---

## 6. Daily Tale generation (W3)

Cron `mint-daily-tale` (daily 00:05 UTC, integrator wires in crons.ts):
pick tone from a 14-entry rotation table, build premise from a curated
template bank (no LLM needed for v1 — deterministic + reviewable), then ONE
LLM call (same router, `deterministic` fallback) to author the storyArc
(question/beats/candidateEndings). Persist `daily_tales`. Failure → retry
next hour via scheduler; the card hides if no row for today.

---

## 7. Wire contracts (client `lib/*Api.ts` ↔ convex) — BC2 shapes

New/changed projection (`game:getCurrentScene` value, additive):
```
projection.arc?: { dramaticQuestion: string; act: 1|2|3; actLabel: string|null;
                   beatsFired: number; beatsTotal: number;
                   threadsPending: number;
                   clock?: { label: string; value: number; max: number } }   // W2
projection.recentDiffs?: Array<
  | {kind:"stat", statId, label, delta}
  | {kind:"currency", delta}
  | {kind:"item", op:"add"|"remove", label}
  | {kind:"thread", op:"set"|"fired", note: string|null}   // note null until fired
  | {kind:"beat", label}
  | {kind:"act", act}
  | {kind:"clock", amount, reason}                          // W2
  | {kind:"npc", npcId, name, deltaBand:"up"|"down", fact: string|null}  // W2
  | {kind:"check", outcome:"success"|"partial"|"fail", statId, margin}   // W2
>
projection.codex?: Array<{flag: string; text: string; turnNumber: number}>   // W2
projection.scene.choices[i].state: "visible"|"locked" (+ lockedHint: string|null)
projection.scene.choices[i].check?: {statId, label, difficulty, odds:
  "likely"|"even"|"risky"|"desperate"}                                        // W2
projection.ending.whatMightHaveBeen?: Array<{label, hint}>                    // W3
```
Server emits null-for-absent; each `lib/*Api.ts` adapter maps to optional
fields (BC2/BC4).

New functions (full registered paths — BC1):
```
dailyFunctions:getToday        query  {} → {daily: {dailyId, date, title,
                                       questionTeaser, played: boolean} | null}
dailyFunctions:startDaily      mutation {accountId, guestTokenHash?} →
                                       {saveId} | AppError daily_already_played
dailyFunctions:getResults      query  {dailyId, accountId, guestTokenHash?} →
                                       {yours: {endingId,label} | null,
                                        distribution: [{endingId,label,count,pct,
                                        firstAccountName?}]}
accountFunctions (widen)       profile projection += {librarianRank: {tier,
                                        label, endings, beats, tales},
                                        keepsakes: [{id,label,description}]}
game:createSave (widen args)   += keepsakeId?, mode? ("story"|"hardcore"),
                                  dailyId?   (BC3)
```

---

## 8. File ownership map (per wave — BC7)

RESERVED (integrator only): `convex/schema.ts`, `convex/crons.ts`,
`convex/game.ts` §terminal-gate + diff-persist blocks are owned by the SERVER
agent but merged last; `packages/engine/src/index.ts` barrel.

Wave 1 (3 agents + integrator):
- **W1-ENGINE**: `packages/engine/src/arc.ts` (new), `types.ts`, `llm.ts`
  (schema ext, delayed enable, diffs), `delayed.ts` (note field), engine tests.
- **W1-SERVER**: `convex/game.ts` (gate, directives, diffs, chapter-on-act),
  `convex/llm/prompts/scene.ts` (pursuit contract + turn-1 arc block),
  `convex/llm/parse.ts` (drop-logging for conditions/beatFired),
  `convex/saves.ts` (projection: arc, recentDiffs, choice states), convex tests.
- **W1-CLIENT**: `QuestLine.tsx`, `ChapterEnd.tsx` (act props),
  `ThreadsPill.tsx`, `EffectBadge`/`useTurn.ts` echo fix, `ChoiceList` locked
  rendering, `lib/gameApi.ts` projection types, client tests.
- **INTEGRATOR**: schema.ts (`turn_history.visibleDiffs`), contract
  reconciliation (BC1/BC2 smoke tests), full sweep, deploy.

Wave 2 (4 agents + integrator):
- **W2-ENGINE**: skill-check resolution wiring + outcome table, clock module
  fns, npc_* LLM effects + clamps, codex derivation helper, tests.
- **W2-SERVER**: `beginStreamingChoice` check resolution + request injection,
  clock tick/directives, prompt sections (relationships/checks/clock/
  scarcity/codex), starter `initialNpcs` + currency seeds
  (`packages/stories/*` — owned here to avoid engine-agent overlap), task-55
  mentions wiring, projection additions, tests.
- **W2-CLIENT**: CheckChip/CheckBanner, CandleClock, NPC pips + roster trends,
  Codex tab, tests.
- **W2-CONTENT** (optional 4th): starter-story NPC/currency/tone passes +
  prompt-copy review (can fold into SERVER).
- **INTEGRATOR**: schema (none expected W2), contracts, sweep.

Wave 3 (3 agents + integrator):
- **W3-SERVER-META**: keepsakes (recordEndingUnlock, accountFunctions
  projection, createSave carry), hardcore mode flow (createSave args, death
  purge path — engine purge exists), librarian rank calc, tests.
- **W3-SERVER-DAILY**: `convex/dailyFunctions.ts` (new), daily mint logic
  (`convex/daily.ts` pure + cron handler), daily_results insert on terminal
  (small owned hook in game.ts terminal block — coordinate with integrator),
  tests.
- **W3-CLIENT**: KeepsakePicker, DailyCard/DailyResults, WhatMightHaveBeen on
  EndingPanel + fogged endings-map ghosts, HardcoreSelect + consent + death
  variant, profile rank/keepsakes, `lib/dailyApi.ts` (BC1 paths!), tests.
- **INTEGRATOR**: schema (daily tables, endings_unlocked.keepsake, saves
  fields), crons.ts (mint-daily-tale), createSave arg widening (BC3), sweep.

---

## 9. Testing strategy (per wave, merge gate = all green)

- Engine: pure unit tests per module (arc selection/firing/gating table
  tests; delayed tick w/ notes; clamps; check outcome table; clock bands).
- Convex: fake-ctx handler tests (terminal gate matrix: arc/no-arc ×
  death/success × beats fired/not; diff persistence; locked-choice
  rejection; daily one-per-day; keepsake dedupe). Prompt tests: snapshot the
  pursuit section, token-budget test, spoiler-absence test (BC10).
- Client: node/vitest for pure logic (echo derivation from diffs, choice
  state rendering model, clock/odds display mapping); existing suites stay
  green.
- Cross: BC1 path smoke test (each `lib/*Api.ts` function-path string exists
  in convex function spec dump).

## 10. Rollout & metrics

- Each wave ships behind nothing (no flag) EXCEPT: arcs apply to NEW saves
  only (natural flag); Daily card hides without a row; hardcore is opt-in.
- Watch: activation (≥5 turns), turns/session, endings/account,
  `arc.ending_gated` rate (target: >0 but <30% of terminals — too high means
  the model fights the gate), `choice.locked_shown`→conversion, D1/D7.
- Cost: prompt +≤1.6k tokens ≈ negligible at flash-lite input pricing; no new
  media spend. Daily mint = 1 LLM call/day.
