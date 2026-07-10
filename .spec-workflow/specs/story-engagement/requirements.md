# Requirements — Story Engagement ("Make the Tome Grip You")

Status: APPROVED FOR BUILD PLANNING (2026-07-10). Companion docs: `plan.md`
(brainstorm + diagnosis), `design.md` (architecture), `tasks.md` (agent tasks).

Grounding: this spec operationalizes product principles 3–4
(`steering/product.md:72-73` — "a flavor-only choice is an anti-feature",
"consequences are immediate and felt") and completes/extends core-read-loop
Req 31 (NPCs), Req 32 (arc beats — unbuilt tasks 60–63), Req 8.4 (hardcore),
Req 19 (endings), Req 23 (seasons). Where this doc conflicts with older specs,
THIS DOC WINS for the story-engagement scope.

Waves: W1 "The Spine" → W2 "Teeth & Hearts" → W3 "Return". Ship in order.

---

## WAVE 1 — THE SPINE

### R1 — Story Arc: dramatic question + beat sheet (builds Req 32)

User story: as a reader I always know what I'm playing FOR, and the story
visibly builds toward it.

1. WHEN an llm-driven save's OPENING scene (turn 1) is proposed THEN the
   proposal SHALL include a `storyArc` object: `dramaticQuestion` (8–160
   chars, phrased as a question or charge), `protagonistWant` (8–120),
   `stakes` (8–160, what is lost on failure), `beats` (3–5 entries of
   `{id, label ≤80, kind: inciting|midpoint|dark_night|climax|custom,
   priorityHint: early|mid|late, requiredBeforeEnding: boolean}`), and
   `candidateEndings` (2–4 of `{id (slug ≤48), label ≤80, hint ≤120}`).
   At least the `climax` beat SHALL be `requiredBeforeEnding: true`.
2. WHEN the model omits or malforms `storyArc` THEN the engine SHALL
   synthesize a deterministic minimal arc from the premise (1 required climax
   beat, generic question) so every save has an arc — never a hard failure.
3. WHEN any subsequent scene is prompted THEN the prompt SHALL carry an ARC
   section: the dramatic question, want, stakes, current act, beats already
   fired, and the SINGLE "beat to steer toward" (selected by priorityHint ×
   turn band), with the instruction to steer subtly — not every turn must
   advance it, but no more than 2 consecutive scenes may ignore it.
4. WHEN a scene lands the target beat THEN the proposal SHALL carry
   `beatFired: <beatId>`; the ENGINE marks it fired (idempotent; unknown ids
   dropped), records `firedAtTurn`, and advances the act
   (act 1 → 2 when `inciting` fires; act 2 → 3 when `midpoint` fires or 2+
   mid beats fire; see design).
5. The reader-visible projection SHALL expose `dramaticQuestion`, current act
   (number + generated act label), and beat progress as COUNT ONLY
   (`beatsFired/beatsTotal`) — pending beat labels and candidate endings are
   spoilers and SHALL NOT reach the client until fired/reached.
6. Old saves without an arc SHALL continue playing under legacy behavior (no
   arc section, no ending gate change) — arcs are not retro-synthesized.

### R2 — Earned endings (replaces the turn-count gate; Req 32.6/32.7)

User story: an ending feels like a climax I reached, not a place the narrator
got tired.

1. WHEN the LLM proposes `terminal.kind = success|safe` AND the save has an
   arc with unfired `requiredBeforeEnding` beats THEN the engine SHALL drop
   the terminal (keep the prose as a normal scene) and the NEXT prompt SHALL
   instruct the model to surface the outstanding beat.
2. WHEN the LLM proposes `terminal.kind = death` THEN: engine-forced death
   (vitality 0) is ALWAYS honored; LLM-proposed death before the arc's
   midpoint beat has fired SHALL be converted to a severe setback (terminal
   dropped, prompt told to narrate a costly survival). Death after midpoint is
   honored (death is a valid dramatic outcome).
3. `MIN_TURN_BEFORE_TERMINAL = 6` remains as a floor for arc-less saves; for
   arc saves the beat gate is primary. A hard cap SHALL allow any terminal at
   turn ≥ 30 (runaway protection).
4. WHEN a terminal is accepted on an arc save THEN `terminal.endingId` SHALL
   be normalized to one of the arc's `candidateEndings` ids when the model's
   id fuzzy-matches one; otherwise the model's id is kept (freeform endings
   remain legal) — but the prompt SHALL instruct choosing from the candidate
   list.
5. The ending scene prompt SHALL require the prose to answer the dramatic
   question explicitly.

### R3 — Chekhov Threads (delayed effects, live)

User story: my early choices come back — I feel the story remembering.

1. The LLM effect vocabulary SHALL include `delayed` (currently validated then
   dropped at `packages/engine/src/llm.ts` applyEffect): `{kind:"delayed",
   delayNodes 1–12, note ≤120 (foreshadow text), effects: 1–3 leaf effects}`.
   Guidance: at most ONE delayed effect per scene.
2. WHEN a turn is applied on the llm path THEN pending delayed effects SHALL
   tick and fire exactly as on the authored path (`delayed.ts` semantics),
   with fired effects clamped identically to direct LLM effects.
3. WHEN a thread fires THEN (a) the diff surface marks it `threadFired` with
   its `note`, (b) the NEXT scene prompt carries "A THREAD FIRES: <note> —
   narrate the callback this scene", (c) the client shows a "🧵 An earlier
   choice echoes" badge.
4. The projection SHALL expose pending threads as COUNT + the notes ONLY of
   threads scheduled ≥? no — notes are spoiler-adjacent: expose count and a
   fixed teaser string; full note revealed only when fired.

### R4 — Locked & conditional choices on the LLM path

User story: I see doors I cannot open yet — and want to.

1. `llmChoiceSchema` SHALL accept optional `conditions` (0–2 per choice) from
   the subset: `{kind:"stat_at_least"|"stat_at_most", statId, value}`,
   `{kind:"has_item"|"missing_item", itemId}`, `{kind:"flag_equals", flag,
   value}`, `{kind:"currency_at_least", value}` — plus optional `lockedHint`
   (≤90 chars, shown on the locked card).
2. Conditions referencing state that does not exist (unknown statId/itemId/
   flag) SHALL be dropped (choice stays available) — same tolerant-drop
   pattern as effects; drops logged at the convex parse boundary.
3. The projection SHALL evaluate conditions server-side via the existing
   visibility layer and emit each choice as `visible` or `locked` (+hint).
   Locked choices render with the 🔒 affordance and are NOT submittable: the
   choice mutation SHALL reject a locked/unknown choiceId
   (`choice_not_available`).
4. At most ONE locked choice per scene (extra gated choices beyond the first
   have conditions dropped). Prompt guidance: roughly every 2–4 scenes, gate
   one choice on state the reader actually has or could get.
5. NEVER fewer than 2 available (non-locked) choices on a non-terminal scene
   (engine enforces by un-locking the least-restricted gated choice if
   needed).

### R5 — Felt consequence: the signed echo (fix)

User story: every choice visibly did something.

1. WHEN a turn completes on the llm path THEN the server SHALL persist the
   visible-tier engine diffs (signed stat deltas, currency delta, items
   gained/lost, threads set/fired, disposition shifts W2) on the turn record,
   and the projection SHALL expose them (`recentDiffs`).
2. The client echo (`deriveRemoteEcho` in `apps/app/hooks/useTurn.ts`) SHALL
   render the SIGNED CHANGES ("+2 Nerve · −1 Vitality · + Bone Key"), not a
   stat snapshot. Hidden-tier changes stay hidden ("something shifted…" only
   when a hidden change occurred and no visible one did).
3. The chapter consequence reel SHALL use the same diff records.

### R6 — Prompt contract re-centered on pursuit (scene.ts)

1. `buildLlmDrivenPrompt` SHALL gain a PURSUIT & STAKES section (arc, target
   beat, clock W2, threads) placed ABOVE the memory window; the existing
   anti-repetition / choice-divergence / stat-narration rules are KEPT.
2. Choice framing rule updated: each choice should visibly advance the quest,
   trade a resource for progress, or accept a risk — a choice with no
   mechanical or arc consequence is a defect (product principle 3).
3. Effect vocabulary text updated to include `delayed` (+ W2 verbs when
   shipped). Token budget: the added sections SHALL stay ≤ 900 tokens.

---

## WAVE 2 — TEETH & HEARTS

### R7 — Skill checks with visible risk

User story: some choices are dice I choose to roll — my pulse goes up.

1. `llmChoiceSchema` SHALL accept optional `skillCheck`: `{statId,
   difficulty: "easy"|"risky"|"desperate", successNote ≤90, failNote ≤90}`.
   Max ONE checked choice per scene.
2. The ENGINE resolves the check deterministically (seeded per-turn RNG,
   existing `resolveSkillCheck` + companion contribution Req 31.5) at choice
   submission — BEFORE the next scene is generated; the outcome
   (`success|partial|fail`, margin, breakdown) is injected into the scene
   request so the model narrates a result it cannot overrule.
3. Outcome effects are ENGINE-authored from a fixed table by difficulty
   (design §skill-checks): success grants a small boon; fail costs (vitality/
   currency/clock W2); partial mixes. The LLM's own effects on a checked
   choice are applied only on success.
4. The choice card SHALL show the check before picking: stat, difficulty tag,
   and derived odds phrase ("Nerve 4 — likely" / "Nerve 1 — desperate").
   After resolution a result banner shows success/partial/fail (dice
   animation; reduced-motion: static stamp).
5. Checked choices and locked choices are mutually exclusive on one choice.

### R8 — NPCs, lights on (completes Req 31 content + LLM reach)

User story: there are people in this story whose feelings about me change
because of what I do — and I can lose them.

1. `llmEffectSchema` SHALL gain: `npc_disposition_delta {npcId, delta}`
   (clamped ±15/turn/NPC), `npc_learn_fact {npcId, fact ≤120}` (cap 12
   facts/NPC, FIFO), and `npc_spawn {id slug, name ≤48, role, description
   ≤160}` (roster cap 8; duplicate id → drop; disposition starts 0).
   npc_* effects referencing unknown npcIds are dropped (tolerant pattern).
2. All three llm-driven starter stories (`bone-cathedral`, `iron-court`,
   `ashfall`) SHALL declare `initialNpcs` (1 companion-role + 1
   rival/antagonist-role each) — finishing core-read-loop task 59. The
   creator seed flow already collects NPCs (keep).
3. Disposition shifts SHALL be narrated (prompt rule) and SHALL surface in
   the echo ("Mira −5 ▾ wary") and the NPC roster (trend arrow since last
   scene). Facts learned surface as "Mira will remember that."
4. `npcMentions` extraction (core-read-loop task 55) SHALL be finished:
   mentions persist to `turn_history.mentionsExtracted` and feed the
   NPC-sheet recency window.
5. Prompt SHALL carry a RELATIONSHIPS line per active NPC (role, disposition
   band, top facts) and the rule: at least one choice every 2–3 scenes should
   meaningfully involve an NPC.

### R9 — The Guttering Candle (doom clock)

User story: I can't dawdle — the world moves without me.

1. Arc saves SHALL carry a clock: `{label (themed, from storyArc.clockLabel
   or default "The candle burns"), value 0..max, max default 12}`.
2. Advancement: ENGINE auto-advances +1 every 3 completed turns (deterministic
   floor); the LLM may additionally emit `clock_advance {amount 1|2, reason
   ≤80}` (≤1 per scene) for fictionally-costly choices. Clock never retreats
   except via a rare engine-authored boon (skill-check critical success).
3. Thresholds: at 50% and 75% the prompt receives escalation directives (the
   antagonist/world closes in; prose must show it). At 100% the engine sets
   `clockExpired`: the next prompt MUST steer directly into the climax beat
   under degraded circumstances, and `dark_night`-kind beats auto-fire.
4. Client: a candle/segment indicator in the HUD (subtle; peek drawer detail),
   pulse animation on advance (reduced-motion: none), and the reason string in
   the echo.
5. Non-arc (legacy) saves have no clock.

### R10 — Scarcity & resource meaning

1. Starters SHALL seed non-zero currency (design values) and the prompt SHALL
   frame currency uses with explicit prices ("the ferryman wants 15 gold")
   paired with `currency_at_least` locks (R4) and negative currency effects on
   purchase.
2. Wound persistence: significant harm SHOULD be expressed as vitality loss
   PLUS a delayed drain thread (R3) — prompt guidance with an example.
3. The prompt SHALL treat inventory as keys: items gained should later gate a
   locked choice or a skill-check advantage (+1 shift when a named item
   applies — engine table, design).

### R11 — The Codex (visible world-truths)

1. String-valued `flag_set` effects are the codex: the projection SHALL
   expose `codex: [{flag, text, turnNumber}]` for flags whose value is a
   string (order: newest first, cap 40).
2. Client: a Codex tab in the full sheet ("Truths the tome recorded") + a
   "✒️ New truth recorded" pip when one lands. Boolean/numeric flags remain
   invisible mechanics.
3. Prompt rule tightened: durable world facts MUST be recorded as short
   sentence-valued flags (this is already half-instructed; make it the codex
   contract).

---

## WAVE 3 — RETURN

### R12 — Keepsakes & New Game+ ("the tome remembers")

1. WHEN an ending is unlocked THEN the ending scene proposal MAY include
   `keepsake {id slug, label ≤48, description ≤160}`; absent that, the engine
   derives one deterministically from the ending (id = ending id, label from
   ending label). Keepsakes persist on the ending-unlock record
   (account-scoped, dedup by id).
2. WHEN creating a new llm-driven save THEN the reader MAY carry exactly ONE
   owned keepsake: it is injected as an inventory item (tagged `keepsake`)
   and the opening prompt carries "the reader carries <label>, an echo of
   another life — weave it in subtly; it may unlock one gated choice."
3. Account profile SHALL show a Librarian Rank derived from
   (endings unlocked, beats fired lifetime, tales published) — display-only,
   thresholds in design.

### R13 — The Daily Tale (shared seed + ending leaderboard)

1. A daily cron SHALL mint one `daily_tales` row per UTC day: a curated
   premise (rotating tone table) + a PRE-GENERATED storyArc with fixed
   `candidateEndings` (so all readers share the question and the ending
   space).
2. Any account/guest MAY start at most one Daily run per day; the run is a
   normal llm-driven save flagged `dailyId`, arc injected (turn-1 arc
   generation skipped).
3. WHEN a Daily run reaches a terminal THEN a `daily_results` row records
   (dailyId, accountId, endingId, turnCount, finishedAt); the results screen
   shows the reader's ending vs the global distribution ("7% of readers found
   this"), first-finder flags, and rarest-path callouts (extends Req 23
   surfaces).
4. The home screen SHALL show today's Daily card (title, question teaser,
   countdown to next). Guests can play; results attach on claim.
5. Mature-gating: daily premises are always all-ages.

### R14 — What-Might-Have-Been (replay bait at endings)

1. WHEN an arc save ends THEN the ending screen SHALL show 1–2 UNREACHED
   `candidateEndings` as fogged cards: label + hint only ("Had you trusted
   the ferryman… — The Drowned Crown"), never full spoilers.
2. Each card offers "Fork from a decision" (existing Req 21 fork flow) and
   "Begin again" CTAs. Endings-map nodes for unreached candidates render
   fogged (extends Req 19 fog-of-war with candidate ghosts).

### R15 — Hardcore mode & difficulty presets (unlocks Req 8.4)

1. Save creation SHALL offer Story (default) / Hardcore. Hardcore: no rewind
   affordances, permadeath (save purged on death — engine path exists),
   clock max −25%, skill-check difficulty shifted one band harder, and
   hardcore-only ending unlock flag (Req 8.4) honored on the trophy crypt.
2. Mid-run downgrade Hardcore→Story is allowed with the specced caveat
   (hardcore-only unlocks disabled for that save); upgrade is not offered
   mid-run (matches steering product.md:27).
3. A clear consent screen precedes Hardcore ("this tome does not forgive").

### R16 — Cross-cutting (all waves)

1. Analytics events: `arc.created`, `arc.beat_fired`, `arc.ending_gated`,
   `thread.set`, `thread.fired`, `choice.locked_shown`, `choice.locked_denied`,
   `check.resolved` (outcome), `npc.disposition_shift`, `clock.advanced`,
   `clock.expired`, `codex.recorded`, `keepsake.granted`, `keepsake.carried`,
   `daily.started`, `daily.finished` — same `analytics_events` fire-and-forget
   pattern as `cinematic.*`.
2. Safety: arc text, beat labels, thread notes, keepsake text, codex strings
   pass `evaluateTextPolicy` before persistence (same as the cinematic beat
   timeline); blocked → replaced with neutral text, never a turn failure.
3. Back-compat: EVERY new state/schema field is optional; saves without them
   behave exactly as today. No migration rewrites.
4. All engine additions are pure + unit-tested (vitest); convex handlers get
   fake-ctx tests; client logic (echo, choice states, clock, codex) gets
   node/vitest tests. Full-suite green is the merge gate per wave.
5. Token budget: total prompt growth across all waves ≤ 1,600 tokens over
   today's baseline; measured in a prompt snapshot test.
