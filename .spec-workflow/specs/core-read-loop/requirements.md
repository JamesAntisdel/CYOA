# Requirements Document — Core Read Loop

## Introduction

The **core read loop** is the foundation of CYOA, but this specification covers the full day-one application: a visitor lands on the URL, passes the age gate, opens the tutorial adventure ("Escape the Training Room"), reads AI-generated prose, makes choices, watches their stats change in real time, can save or claim an account, can hit daily-turn monetization, can publish or share a tale, can play co-op, and can return across web or native surfaces.

This spec exists to prove the architecture end-to-end while also defining the product-critical surfaces that make the app shippable. It exercises:

- The deterministic **engine** (`packages/engine/`) implementing Game Spec §2 (branching, attributes, scene effects).
- The **Convex backend** (`convex/`) orchestrating the LLM call loop, persisting save state, and pushing reactive updates.
- The **LLM provider router** (Anthropic quality-first, Vertex AI Gemini fallback, DeepSeek cost-optimized where eligible) generating streaming prose bound to engine-decided choices.
- The **narrative safety guardrail** that keeps generated scenes away from depressive, self-harm, and suicide-adjacent storylines, and offers a graceful story ending before unsafe content is generated.
- The **age gate** that requires a visitor to confirm they are 13 or older before a playable guest session or save can be created.
- The **mature-content gate** that keeps adult language, adult subject matter, and adult imagery out of the default product unless the user is paid, 18+, and has explicitly opted in.
- The **account, billing, co-op, publishing, creator, settings, native, infrastructure, and operator surfaces** required for the app to work as a real product rather than a demo.
- The **Expo web/native client** rendering the reader, settings, co-op, publishing, account, paywall, library, endings, and admin surfaces from one component tree.
- The **shared types** package (`packages/shared/`) carrying API contracts.
- The **starter story** for the tutorial (`packages/stories/training-room/`) authored as TS data conforming to engine types.

The first playable flow remains **guest-first**, but not guest-only: guests can start immediately after age confirmation, then claim their saves into an account when they want sync, sharing, publishing, co-op persistence, or subscription continuity.

## Alignment with Product Vision

This spec is the structural foundation for nearly every feature in `product.md`:

- **Game Spec §2 features (1–3 in product.md)** — Narrative branching, player attributes, scene-level effects — implemented and exercised end-to-end here.
- **Key Feature 4 (AI-generated narrative with persistent memory)** — implemented with current scene seed, recent turn summaries, and vector-search memory retrieval over past scene summaries.
- **Key Feature 5 (Curated starter adventures)** — the tutorial story is authored as a first-class adventure in the stories package.
- **Key Feature 6 (Story Mode / Hardcore Mode)** — Story and Hardcore modes are both represented in the engine and UI, including the mid-game mode-switching caveats from product direction.
- **Key Feature 8 (Dynamic stat feedback)** — required end-to-end; this is the load-bearing UX that makes stats feel like consequences.
- **Key Feature 10 (Endings tracking)** — endings are recorded, synced, rendered in the trophy crypt, and visualized in the branching endings map.
- **Safety as product trust** — gothic, dangerous fiction is allowed, but the product must never produce depressive, self-harm, suicide, or player-directed despair storylines. The book should close gently before it crosses that line.
- **Age-appropriate access** — the product is not available to children under 13; the first-run flow must verify age eligibility before play starts.
- **Mature content is opt-in and paid-only** — adult language, adult subject matter, and adult imagery are not available by default and require paid entitlement, `18+` age band, and explicit 18+ agreement.
- **Product principles 1, 3, 4, 5** — Story first, agency is the point, consequences immediate, story↔inventory instantaneous — these are explicit acceptance criteria below.
- **Tech-stack decisions 1, 2, 3, 4, 5, 6** — Convex backend, server-authoritative engine, LLM-as-content-provider, provider routing with Anthropic/Gemini/DeepSeek slots, Expo+RNW, TypeScript-everywhere — all exercised by this spec.

This spec includes Key Features 11–17 (co-op, publishing, authoring, ambient sound, achievements, billing, Stripe-first monetization with native purchase support) as requirements. Implementation can still be phased through design and task breakdown, but the requirements document treats them as part of the target app.

---

## Requirements

### Requirement 1 — Age gate and guest session bootstrap

**User Story:** As a first-time visitor, I want to start playing immediately without signing up, so that there is zero friction between landing and the first scene.

#### Acceptance Criteria

1. WHEN a visitor loads the root URL with no existing age confirmation THEN the client SHALL show an age selector before any "Open the book" CTA is actionable.
2. WHEN the age selector is shown THEN it SHALL require the visitor to choose one of: "Under 13", "13-17", or "18+"; the client SHALL NOT default to an eligible choice.
3. IF the visitor selects "Under 13" THEN the client SHALL block play, SHALL NOT request a playable guest session, SHALL NOT create a save, and SHALL render a short non-game message that the story is only available for ages 13 and older.
4. WHEN a visitor selects "13-17" or "18+" THEN the client SHALL persist only the age-band confirmation, not date of birth, and SHALL allow guest-session bootstrap to proceed.
5. WHEN a visitor loads the root URL with no existing session token and an eligible age confirmation THEN the client SHALL request a new guest session from Convex and receive an opaque guest session token within 500ms p50, 1500ms p95.
6. WHEN a guest session token is issued THEN the client SHALL persist it in platform-appropriate storage (web MVP: localStorage or a Convex-set same-site cookie; native-ready abstraction: secure-store) so that a reload resumes the same session.
7. IF a guest session token is present in client storage THEN on page load the client SHALL re-attach to that session without prompting the visitor, provided an eligible age confirmation is also present.
8. WHEN a guest session is created THEN Convex SHALL store an `accounts` row with `kind = "guest"`, `ageBand` of `"13-17"` or `"18+"`, a hashed session-token identifier, a creation timestamp, and a TTL of 7 days from last activity.
9. IF a guest session has been inactive for more than 7 days THEN a Convex scheduled function SHALL purge the session, its saves, and any unlocked endings for that guest.
10. WHEN a visitor reloads with a purged-or-invalid session token THEN the client SHALL clear the stale token, request a new guest session only after confirming age eligibility, and SHALL NOT surface an error.
11. WHEN Convex receives any save-creation or turn-submission request for a session without an eligible `ageBand` THEN Convex SHALL reject the request with an `age_gate_required` error.

### Requirement 2 — Start the tutorial adventure

**User Story:** As a new player, I want to start the "Escape the Training Room" tutorial, so that I learn how the choice / consequence / stat loop works.

#### Acceptance Criteria

1. WHEN a guest with no active save loads the root URL THEN the client SHALL render the cover surface with a single primary CTA labeled "Open the book" pointing to the tutorial adventure.
2. WHEN the visitor activates the primary CTA THEN the client SHALL call a Convex mutation that creates a new save row with `storyId = "training-room"`, `mode = "story"`, the engine's initial state for the tutorial (vitality, currency, inventory, flags as defined in `packages/stories/training-room/`), and `nodeId` set to the tutorial's start node.
3. WHEN the save is created THEN the client SHALL navigate to `/read/{saveId}` and SHALL render the start node shell within 1500ms p50 of the CTA activation, with LLM streaming beginning inside this window when generated prose is not already cached.
4. IF a guest already has an active save for the tutorial THEN the cover SHALL show a secondary CTA labeled "Continue your tale" that resumes the existing save instead of starting a new one.
5. WHEN the tutorial save is created THEN the engine SHALL emit an `entered` event for the start node so any Auto-Modifiers on it fire immediately (Game Spec §2.C).

### Requirement 3 — Render the current scene

**User Story:** As a player, I want to see the current scene as readable prose, so that I am immersed in the tale.

#### Acceptance Criteria

1. WHEN `/read/{saveId}` mounts for an authorized guest THEN the client SHALL subscribe to a Convex reactive query that returns the current scene's prose, the visible/locked choices, the visible stats, and the player's name (if any).
2. WHEN scene data arrives THEN the client SHALL render the **Book** reading layout (centered column, generous margins, paged) per the wireframe `Read_Book` and SHALL apply the **Sepia** theme by default.
3. WHEN a scene's prose is being generated by the LLM for the first time THEN the client SHALL render an in-character placeholder ("the candle is being lit…") and SHALL stream prose tokens into the page as they arrive over the SSE stream from a Convex HTTP action.
4. WHEN streamed tokens arrive THEN the client SHALL render the new tokens within 100ms of receipt without re-rendering already-displayed prose.
5. WHEN a scene's prose has been generated and persisted on a previous turn THEN the reactive query SHALL return the persisted text immediately (no LLM call) and the client SHALL render it without the placeholder.
6. WHEN scene rendering completes THEN the client SHALL keep the prose pinned to a single readable column ≤640px wide on web and the device width on native.
7. IF the same node is revisited via a return-loop in the story THEN Convex SHALL either return the persisted prose for the existing scene instance or create a new scene instance keyed by `{saveId, nodeId, turnNumber, stateFingerprint}`; the same scene instance SHALL never be regenerated after prose has been persisted.
8. WHEN a story or node declares `sceneLength` THEN Convex SHALL pass that prose budget into the LLM prompt; tutorials and fallbacks may use `brief`, normal adventures use `standard`, richer scenes use `rich`, and chapter-scale beats use `chapter`.

### Requirement 4 — Choices reflect engine-evaluated visibility

**User Story:** As a player, I want to see which choices are available, locked, or hidden based on my current state, so that I understand my world without being able to cheat.

#### Acceptance Criteria

1. WHEN the engine evaluates a scene's choices via `evaluateConditions(state, choice)` THEN each choice SHALL be classified as `"visible"`, `"locked"`, or `"hidden"` per Game Spec §2.A.
2. WHEN a choice is `"visible"` THEN the client SHALL render it as an active, tappable choice card (per `Choice` primitive in the wireframes).
3. WHEN a choice is `"locked"` THEN the client SHALL render it dimmed with a small hint of why it is locked (e.g. "needs Cathedral Key", "Strength too low") and SHALL NOT permit selection.
4. WHEN a choice is `"hidden"` THEN the client SHALL NOT render it at all.
5. WHEN the visible/locked classification depends on inventory THEN the engine's check SHALL be against the canonical inventory in the save, not a client-supplied copy.
6. WHEN the visible/locked classification depends on a hidden stat (e.g. Morality) THEN the locked hint SHALL NOT name the hidden stat (it may say "you do not have the resolve" rather than "Morality < 5").
7. WHEN a save reaches a node with no `"visible"` choices THEN the engine SHALL treat that as a Game Over / The End state per Game Spec §2.A and SHALL transition to the appropriate ending node.

### Requirement 5 — Submit a choice → engine + LLM read loop

**User Story:** As a player, I want to make a choice and see the story respond in seconds, so that the book feels alive.

#### Acceptance Criteria

1. WHEN the player selects a `"visible"` choice THEN the client SHALL call the Convex mutation `game.beginStreamingChoice({ saveId, choiceId, requestId })` immediately and SHALL render an optimistic disabled state on all choices.
2. WHEN `game.beginStreamingChoice` is invoked THEN Convex SHALL load the save, call `engine.applyChoice(state, choice) → state'`, and call `engine.enterNode(state', nextNode) → state''` (which fires Auto-Modifiers per Game Spec §2.C) in a single transactional mutation **before** invoking the LLM or opening the HTTP stream.
3. WHEN the post-engine state has `vitality ≤ 0` THEN Convex SHALL transition the save to the designated Death node per Game Spec §2.B, persist the death, record the ending unlock, and SHALL NOT call the LLM for the chosen-but-now-dead branch.
4. WHEN the post-engine state is non-terminal THEN Convex SHALL build a memory window (the current node's authored seed + the last N turn summaries) and SHALL call the LLM provider router (Anthropic quality-first, Vertex AI Gemini fallback, DeepSeek cost-optimized where eligible) to generate prose for the new scene around the engine-computed state and engine-computed available choices.
5. WHEN the LLM begins streaming THEN the first prose token SHALL arrive at the client within 1500ms p50, 3000ms p95, of the choice submission.
5a. WHEN the LLM stream HTTP endpoint is called directly THEN Convex SHALL verify the caller can access the requested account/save and that the save has a current pending scene before invoking any provider; unauthenticated, mismatched, or non-pending requests SHALL return 401/403-equivalent errors and SHALL NOT spend provider tokens.
5b. WHEN provider streaming fails before completion THEN Convex SHALL mark the pending scene failed, clear the active turn request lock, redact raw provider error details from the SSE response, and allow the client to recover without trapping the save in an in-progress state.
5c. WHEN the reader submits a free-form ("Option D") typed action THEN the client SHALL call `game.beginStreamingChoice` with the existing arguments plus a `userText` string carrying the trimmed input AND a synthetic `choiceId` (`"freeform:<requestId>"`); Convex SHALL validate length (1–200 chars trimmed), run `evaluateTextPolicy` against the text in the `publishing` surface (so a safety block becomes a hard block rather than a safe ending), reject scripted/local-engine stories with `freeform_not_supported_for_story`, persist the trimmed text to `turn_history.choiceLabel` so the next memory beat reads naturally, and advance the LLM-turn cursor without looking the synthetic id up in the prior proposal's choice list; the free-form path SHALL NOT be tier-gated.
6. WHEN the LLM completes generation THEN Convex SHALL parse the model's output against a Zod schema and discard any field outside that schema. In `authored` mode the schema yields ONLY prose text plus optional presentation metadata for engine-provided choices (e.g. tone labels). In `llm-driven` mode the schema additionally accepts proposed choices with bounded `effects`, which the engine validates, clamps, and applies per Requirement 9 (the engine — not the raw LLM payload — remains the sole authority that mutates state).
7. WHEN the LLM's output cannot be parsed against the schema after 1 retry THEN Convex SHALL fall back to the secondary provider; if both fail twice THEN Convex SHALL persist a deterministic default scene ("the candle gutters; the page is blank...") with the canonical engine-provided choices and a flag for retry.
8. WHEN a turn completes successfully THEN Convex SHALL append a `turn_history` row containing the prior state, the chosen choice id, the engine-applied diffs, the LLM provider used, and the resulting prose; the row SHALL be append-only.
9. WHEN the LLM provider router selects a model THEN it SHALL support quality-first, fallback, and cost-optimized provider slots; DeepSeek SHALL be treated as an eligible cost-optimized text provider if it passes the same parsing, safety, mature-content, latency, and privacy gates as other providers.

### Requirement 6 — Stats and inventory are visible and update with feedback

**User Story:** As a player, I want my stats and inventory always reachable in one tap and visibly changing when consequences fire, so that the game feels responsive and fair.

#### Acceptance Criteria

1. WHEN the reading view mounts THEN the client SHALL render a **peek-drawer** stats HUD per the wireframe `Stats_PeekDrawer`: a small persistent corner sigil showing the most-critical numbers (♥ vitality, ◈ currency, ✦ inventory count); tapping the sigil SHALL slide in a fuller list within ≤16ms (one frame; per Game Spec §6 Flow).
2. WHEN a visible stat changes as a result of a choice, Auto-Modifier, or Delayed Consequence THEN the client SHALL render an animated pip (`+10 Gold`, `♥ -5`) within ≤100ms of receiving the corresponding structured engine event or prose-anchor metadata (Game Spec §4 and §6).
3. WHEN a stat-change pip appears THEN it SHALL fade after ~3s but SHALL also be reflected in the corner sigil's number immediately and persistently.
4. WHEN inventory changes (item added or removed) THEN the corner sigil's `✦` count SHALL update immediately and a brief item-name pip SHALL appear (`+ Rusty Key`).
5. IF a stat is a **hidden stat** (e.g. Morality, Infamy) THEN no pip SHALL be shown for changes to it and it SHALL NOT be visible in the peek drawer.
6. WHEN the player is reading THEN the peek drawer SHALL be reachable on every reading-view route without a route change (it is a UI overlay, not navigation).
7. WHEN a turn introduces both visible-stat changes and a node transition THEN pip animations and node prose SHALL be coordinated so pips appear at the nearest available prose anchor; if no anchor is supplied, pips SHALL appear when the first prose token for the new scene arrives rather than all at page load.

### Requirement 7 — Auto-Modifiers and Delayed Consequences fire correctly

**User Story:** As a player, I want the world to react to me — entering rooms causes things, and earlier choices have late consequences — so that play feels deeper than picking the next paragraph.

#### Acceptance Criteria

1. WHEN the engine transitions into a node that declares Auto-Modifier effects (Game Spec §2.C) THEN those effects SHALL be applied to the state **before** any LLM call for that node, atomically with the node entry.
2. WHEN an Auto-Modifier reduces vitality to ≤0 on entry THEN the engine SHALL immediately route to the Death scene per Game Spec §2.B without rendering the entered node's prose.
3. WHEN a choice declares a **Delayed Consequence** (e.g. "fire flag X N nodes from now") THEN the engine SHALL register the scheduled effect on the save and SHALL fire it precisely on the Nth subsequent node entry, regardless of which branch the player took to get there (Game Spec §2.C).
4. IF a Delayed Consequence's target node is reached via a Common Result node (Game Spec §5) THEN the consequence SHALL still fire correctly (the scheduler is keyed on turn count, not node identity).
5. WHEN any effect (Auto-Modifier, choice effect, Delayed Consequence) fires THEN it SHALL produce a structured engine event (e.g. `{ kind: "stat", attr: "vitality", delta: -5 }`) that the client uses to drive the corresponding pip animation.

### Requirement 8 — Death scene is brutal, terminal, and ending-tracking

**User Story:** As a player, when my vitality drops to zero, I want a death screen that feels final and dramatic, and I want my path to be remembered, so that mortality has weight.

#### Acceptance Criteria

1. WHEN vitality reaches ≤0 (via choice effect, Auto-Modifier, or Delayed Consequence) THEN Convex SHALL persist a `"dead"` status on the save, record an `endings_unlocked` row keyed on the guest account id and the death-ending id, and SHALL render the **Brutal full-screen** death screen per the wireframe `Death_Brutal`.
2. WHEN the death screen renders THEN it SHALL display the configured death-ending name (e.g. "ENDING #1: Killed by the trap"), the turn number, and a primary CTA labeled "Begin again."
3. WHEN the player activates "Begin again" THEN the client SHALL call a Convex mutation that creates a new save with the same `storyId`, `mode`, and freshly initialized engine state, and SHALL navigate to the new save's reading view.
4. IF the save is in `mode = "hardcore"` (not selectable in this spec but supported by the engine) THEN on death the save SHALL be purged from the database (Game Spec §3 Hardcore Mode permadeath); in `mode = "story"`, the save SHALL be marked terminal but retained for history.
5. WHEN the death screen is rendered THEN no further turn submissions for the dead save SHALL be accepted by Convex; the action SHALL return an error if attempted.
6. WHEN an ending is unlocked for the first time for this guest account THEN the unlock SHALL be marked `firstSeen` so the trophy crypt and endings map can surface "★ NEW" badges.

### Requirement 9 — The engine is the sole authority for state mutation; LLM proposals are bounded

**User Story:** As a player and as the operator, I want the LLM to be unable to grant me capabilities the rules don't allow, so that the game cannot be cheated by prompt injection.

> **Design note (2026-07 reconciliation).** In the `llm-driven` story mode the model DOES propose structured choices that carry `effects` (stat / currency / inventory / flag deltas and a bounded `delayed` wrapper) — this is the shipped, intended architecture, not a violation. The security guarantee is not "the LLM emits no effects" but "**the engine is the only component that validates, clamps, and applies them, and every proposed value is bounded before it can touch state.**" A prompt-injected model therefore cannot exceed the per-turn/per-effect bounds below. The earlier "prose only, reject all effects" wording described an authored-mode-only design that predates `llm-driven` mode and has been superseded by the criteria below. The `authored` mode retains the stricter contract (the LLM only layers prose over engine-authored choices/effects).

#### Acceptance Criteria

1. WHEN Convex calls the LLM for a turn THEN the prompt SHALL provide the engine-computed current state summary, the authored scene seed (or reader premise), and — in `authored` mode — the valid next-choice candidates; the model writes prose and, in `llm-driven` mode, MAY propose next choices with attached effects.
2. WHEN parsing LLM output THEN the engine's Zod schema (`llmSceneOutputSchema` / `llmChoiceSchema` / `llmEffectSchema`) SHALL be the single validation boundary and SHALL hard-clamp every proposed value at parse time: stat deltas to `±10` (`STAT_DELTA_BOUND`), currency deltas to `±100` (`CURRENCY_DELTA_BOUND`), at most `6` effects per choice (`MAX_EFFECTS_PER_CHOICE`), a `delayed` horizon of at most `12` nodes (`DELAYED_MAX_HORIZON`), and all string/id fields to their declared max lengths (over-length values truncate rather than reject). Deltas SHALL be coerced to finite integers (`clampDelta`); non-finite values become `0`. In `authored` mode the parsed shape SHALL still contain ONLY prose + presentation metadata (no effects).
3. WHEN LLM output references a stat that does not exist in the engine's registry THEN the engine SHALL register it as a visible attribute with engine-spec bounds (non-vitality stats `0–5`, vitality `0–10`) before applying any delta, so subsequent turns clamp it correctly; inventory and flag references SHALL respect the same item-registry and length checks. The engine — never the raw LLM payload — SHALL be the component that applies the mutation to `PlayerState`.
4. IF the LLM produces narrative prose that asserts a state change ("…and you now have 999 gold") that the engine did not independently apply THEN the HUD SHALL reflect the engine's clamped state, not the prose's assertion; the discrepancy is an acceptable soft signal, and the **state itself SHALL never reflect an unbounded or unapplied LLM assertion**.
5. WHEN any LLM output triggers a non-narrative parser or provider safety filter THEN Convex SHALL retry once on the secondary provider; narrative self-harm, suicide, depressive, or player-directed despair triggers SHALL follow Requirement 11's stronger safe-closure flow.
6. WHEN saving a turn THEN the persisted prose SHALL be exactly what was streamed to the client (no post-hoc edits) so that re-rendering on reload is byte-identical to the original session.

### Requirement 10 — One starter story is authored and playable end-to-end

**User Story:** As the development team, I want the "Escape the Training Room" tutorial fully authored as engine-data in `packages/stories/`, so that the entire spec can be exercised by playing it.

#### Acceptance Criteria

1. WHEN the stories package is built THEN it SHALL export a `training-room` story conforming to the engine's `Story` type and SHALL be registered in `packages/stories/index.ts`.
2. WHEN the tutorial is loaded THEN it SHALL contain at minimum: a start node, ≥3 distinct rooms (per the chat transcript design "tutorial · room 1 of 3"), ≥2 inventory items used as keys, ≥1 stat-changing choice on each room, ≥1 Auto-Modifier (e.g. a poisoned-floor Auto-Modifier in one room), ≥1 Delayed Consequence (e.g. "the candle stub you took will burn out 3 turns later"), ≥1 hidden-stat-influenced choice, ≥1 death ending, and ≥1 successful escape ending.
3. WHEN the tutorial is played end-to-end via the success path THEN the player SHALL reach the escape ending in ≤8 turns.
4. WHEN the tutorial is played end-to-end via a death path THEN the player SHALL be able to die in ≤4 turns.
5. WHEN the tutorial defines initial state THEN starting vitality SHALL be such that careless choices can plausibly kill the player but careful choices cannot (i.e. there is at least one solvable death path).
6. WHEN the tutorial story declares its prose seeds for the LLM THEN those seeds SHALL be tone-consistent with the gothic / candlelit voice from `product.md` and from the design wireframes.
7. WHEN the engine computes the tutorial's `endings_unlocked` list THEN the success ending and the death ending SHALL be registered in the story's ending registry so they can be tracked separately.

### Requirement 11 — Narrative safety prevents self-harm and depressive storylines

**User Story:** As a player, I want dark adventure without self-harm, suicide, or depressive storylines, so that the experience stays fictional, bounded, and safe.

#### Acceptance Criteria

1. WHEN any authored story seed, choice label, player-supplied input, memory-window summary, or LLM output is prepared for use in the read loop THEN Convex SHALL run it through a narrative-safety classifier before it is included in a prompt, persisted as prose, or shown to the player.
2. WHEN the classifier detects self-harm, suicide, suicidal ideation, self-injury instructions, encouragement of self-harm, depressive hopelessness, or player-directed despair THEN Convex SHALL NOT send that content to the LLM, SHALL NOT persist it as scene prose, and SHALL NOT render it to the client.
3. WHEN the classifier detects borderline safety risk (for example grief, isolation, captivity, fatalism, or death imagery trending toward hopelessness or self-harm) THEN Convex SHALL replace the next available choices with a safe set that includes a strong "end the story" option and at least one safe redirection option (for example "close the book for now", "let dawn end the tale", or "turn toward the door and leave").
4. WHEN the player selects an "end the story" safety option THEN Convex SHALL transition the save to a non-punitive safe-ending node, persist `status = "ended_safely"`, record an ending unlock with `safetyEnding = true`, and SHALL NOT describe the unsafe theme in detail.
5. WHEN the LLM output trips a safety filter during streaming THEN Convex SHALL stop streaming immediately, discard the unsafe completion, and persist a safe bridge scene that briefly closes or redirects the story without mentioning self-harm, suicide, or depressive content.
6. WHEN Convex retries after a safety-triggered generation failure THEN the retry prompt SHALL include a stricter safety instruction and SHALL steer toward adventure, escape, mystery, or neutral closure rather than mental-health crisis themes; after one safety-triggered retry failure, Convex SHALL use the safe-ending fallback instead of trying more providers.
7. WHEN the tutorial story is authored THEN its tone may include danger, traps, death endings, and gothic atmosphere, but SHALL NOT include self-harm, suicide, depressive hopelessness, player-directed despair, or choices that invite the player character to harm themself.
8. WHEN a death ending is rendered THEN it SHALL be framed as external adventure consequence (trap, monster, hazard, failed escape) and SHALL NOT portray self-inflicted harm, suicide, or emotionally hopeless narration.
9. WHEN safety moderation logs are written THEN they SHALL record only metadata (`saveId`, `storyId`, turn number, classifier category, provider, action taken) and SHALL redact the unsafe text by default; raw unsafe content SHALL NOT be stored in analytics events.
10. WHEN safety logic blocks or redirects content THEN the client SHALL present the result in-world and calmly, without medical advice, crisis counseling language, shame, or alarmist copy; the product response is to close or redirect the fiction, not to diagnose the player.

### Requirement 12 — Mature content requires paid 18+ opt-in

**User Story:** As the operator, I want adult-only content locked behind paid 18+ opt-in, so that the default app remains appropriate for teens and general audiences.

#### Acceptance Criteria

1. WHEN a user has not selected `ageBand = "18+"` THEN the app SHALL NOT generate, display, publish, fork, recommend, or store adult-only language, adult subject matter, or adult imagery for that user.
2. WHEN a user is `18+` but does not have an active paid entitlement THEN the app SHALL NOT generate, display, publish, fork, recommend, or store adult-only language, adult subject matter, or adult imagery for that user.
3. WHEN a user is `18+` and paid but has not explicitly agreed to an 18+ mature-content setting THEN the app SHALL keep mature content disabled and SHALL use the same general-audience prompt and safety profile as unpaid users.
4. WHEN a user is `18+`, paid, and has explicitly enabled mature content THEN Convex SHALL store `matureContentEnabled = true` with timestamp, account id, and entitlement source; guest sessions SHALL NOT be allowed to enable mature content.
5. WHEN any authored seed, player prompt, memory summary, generated prose, generated image prompt, generated video prompt, title, synopsis, or published tale metadata is prepared THEN Convex SHALL classify it for mature content before prompting, persistence, publishing, or rendering.
6. IF mature content is detected and the active account does not satisfy paid 18+ opt-in THEN Convex SHALL block or rewrite the content into general-audience form and SHALL NOT show an upsell that describes the blocked adult content in detail.
7. WHEN mature content is enabled THEN Requirement 11 still applies fully: self-harm, suicide, depressive hopelessness, and player-directed despair remain prohibited and SHALL NOT be unlocked by mature-content opt-in.
8. WHEN generated images or videos are requested THEN adult imagery SHALL be disabled unless paid 18+ opt-in is active; provider prompts SHALL include the current mature-content allowance explicitly.
9. WHEN a published tale contains mature content THEN it SHALL be marked mature, excluded from general discovery, blocked for under-18 or unpaid readers, and unavailable to anonymous guests.
10. WHEN a user disables mature content or loses paid entitlement THEN subsequent generation, discovery, read-along, fork, and media rendering SHALL immediately return to the general-audience profile.

### Requirement 13 — Engine package is pure, fully unit-tested, and the executable spec

**User Story:** As the development team, I want `packages/engine/` to be the executable Game Spec — no I/O, no React, no Convex — fully tested, so that the rules are an auditable artifact independent of the rest of the system.

#### Acceptance Criteria

1. WHEN `packages/engine/` is built THEN it SHALL have zero runtime dependencies on `react`, `convex`, `@anthropic-ai/sdk`, `@google/generative-ai`, `expo`, or any I/O library; only `zod` and pure TypeScript primitives are permitted.
2. WHEN linting `packages/engine/` THEN any import of `fetch`, `Date.now()`, `process.env`, `console.log`, or `crypto.randomUUID()` (without a passed-in clock/RNG) SHALL fail the lint check.
3. WHEN tests run for `packages/engine/` THEN line coverage SHALL be ≥95% for `apply.ts`, `visibility.ts`, `enterNode` logic in `apply.ts`, `delayed.ts`, `death.ts`, `flags.ts`, `inventory.ts`, `stats.ts`, and `endings.ts`.
4. WHEN tests run for `packages/engine/` THEN every Game Spec §2 acceptance behavior SHALL have at least one corresponding test case (branching, conditional visibility, global flags, vitality-zero-triggers-death, currency math, inventory key checks, hidden-stat math, Auto-Modifiers, Delayed Consequences).
5. WHEN the engine is invoked with a clock-dependent operation (e.g. Delayed Consequences turn count) THEN the clock/turn counter SHALL be read from the passed-in state, not from a global, so tests are deterministic.
6. WHEN the engine produces state diffs THEN diffs SHALL be structured (`{ kind, target, delta }`) and serializable as JSON without any function values, so they can be persisted in Convex `turn_history` and replayed.

### Requirement 14 — Reactive client state mirrors the server save exactly

**User Story:** As a player, I want my UI to always reflect what the server says is true, so that reload, multi-tab, or background work doesn't desync the game.

#### Acceptance Criteria

1. WHEN the reading view subscribes to its Convex query THEN any mutation that changes the save SHALL push an updated query result to all subscribed clients within Convex's normal reactivity SLA (sub-second).
2. WHEN the player reloads the page mid-turn THEN the client SHALL re-attach to the same save, fetch the persisted current scene (and any in-flight stream if available), and SHALL not double-apply any choice.
3. WHEN the player opens the same save in a second browser tab THEN both tabs SHALL render the same scene; submitting a choice in one tab SHALL update the other tab's prose and stats reactively.
4. IF a turn submission is in flight when a duplicate submission for the same save arrives THEN Convex SHALL accept only one (the first to acquire the save's mutation lock); the second SHALL receive a `"turn_in_progress"` error and the client SHALL display nothing (the reactive query will deliver the in-flight result).
5. WHEN Convex pushes an updated save state to the client THEN the client SHALL never derive game-relevant facts (locked/hidden choices, current vitality, inventory) from local memory in preference to the server snapshot; local memory exists only for animation orchestration, not truth.

### Requirement 15 — Internal observability of the read loop

**User Story:** As the operator, I want every turn's lifecycle to be observable so I can debug and measure the loop without relying on third-party trackers.

#### Acceptance Criteria

1. WHEN any Convex function in the read loop runs THEN it SHALL emit structured logs at key stages: `turn.received`, `engine.applied`, `llm.requested`, `llm.first_token`, `llm.completed`, `turn.persisted`, plus any error/fallback events.
2. WHEN a turn completes THEN Convex SHALL append an `analytics_events` row with: event name, guest account id, save id, story id, turn number, LLM provider used, tokens consumed (input / output), latency at each stage, and whether a fallback occurred.
3. WHEN an `analytics_events` row is appended THEN no third-party tracking script SHALL be loaded by the client and no data SHALL leave Convex / GCP for tracking purposes (per the in-house-analytics directive in `product.md` and `tech.md`).
4. WHEN the operator runs an in-house analytics query from `apps/app/app/admin/` THEN the schema of `analytics_events` from this spec SHALL be sufficient to compute: turns per session, time-to-first-token p50/p95, fallback rate, tokens per session, cost-per-turn-by-provider.
5. WHEN a turn fails THEN the failure SHALL be logged with sufficient detail (sanitized inputs, LLM provider response code, parser error message) for an operator to reproduce it; raw LLM output that triggered safety filters SHALL be redacted.
6. WHEN a narrative-safety event occurs THEN Convex SHALL append a redacted `analytics_events` row with event name `safety.redirected`, `safety.ended`, or `safety.blocked`, the classifier category, the action taken, and latency impact, without storing the unsafe content.
7. WHEN privacy-sensitive events are logged THEN analytics SHALL store account ids, save ids, tale ids, and room ids only as internal ids; it SHALL NOT store email addresses, OAuth profile fields, raw payment details, raw unsafe text, raw mature text, or private co-op invite URLs.

### Requirement 16 — Authentication, account claiming, and sync

**User Story:** As a guest player, I want to claim my tale into an account when I care about it, so that my saves, endings, subscriptions, and shared content persist across devices.

#### Acceptance Criteria

1. WHEN a guest reaches the soft-signup prompt or tries to publish, share, subscribe, join persistent co-op, or sync across devices THEN the client SHALL offer account creation without interrupting the current scene.
2. WHEN a guest signs in or creates an account THEN BetterAuth SHALL claim the guest `accounts` row, saves, turn history, endings, published tales, and age band into the authenticated account without data loss.
3. WHEN an authenticated user signs in on another device THEN Convex SHALL expose their saves, endings, subscriptions, settings, published tales, and co-op rooms through reactive queries.
4. WHEN a user authenticates THEN the app SHALL support Google, Apple, GitHub, Microsoft, Discord, and email magic link as configured providers.
5. WHEN a user requests account export or deletion THEN Convex SHALL provide export and deletion actions that include saves, turn history, endings, settings, analytics rows tied to the account, and published content ownership metadata.
6. WHEN a guest-owned account operation is requested THEN Convex SHALL require the opaque guest token proof tied to that `accounts` row; `accountId` alone SHALL NOT authorize profile, library, save, turn, creator, export, delete, or stream operations.
7. WHEN an authenticated user-owned account operation is requested THEN Convex SHALL authorize with `ctx.auth.getUserIdentity().subject` matching `accounts.userId`; guest token proof SHALL NOT authorize user-owned rows.

### Requirement 17 — Daily turn limits, subscriptions, and billing

**User Story:** As a free player, I want to play a fair amount each day and subscribe when I want more, so that monetization feels like more story rather than blocked entry.

#### Acceptance Criteria

1. WHEN a guest or free account submits turns THEN Convex SHALL decrement a daily turn allowance and reset it on the configured daily schedule.
2. WHEN the daily allowance is exhausted THEN the client SHALL render an in-world paywall moment that preserves the book metaphor and SHALL NOT stop mid-stream without persisting the current scene.
3. WHEN a player subscribes on web THEN Stripe SHALL be the primary billing system for checkout, subscriptions, invoices, customer portal, metered usage, credits, upgrades, downgrades, cancellations, and tax-supported invoice records.
4. WHEN a player subscribes on iOS or Android THEN native IAP SHALL be supported where app-store policy requires it, but Convex SHALL normalize all purchase sources into the same entitlement model used by Stripe.
5. WHEN a player has Unlimited entitlement THEN Convex SHALL allow unlimited text turns subject only to abuse and provider-cost rate limits.
6. WHEN a player has Pro entitlement THEN the app SHALL unlock generated illustrations, scene-cinematic videos, and ambient soundscape features.
7. WHEN a player exceeds included Pro media or premium-model usage THEN the app SHALL offer transparent upgrades, one-time credit packs, or metered overage opt-in before additional billable usage is incurred.
8. WHEN any paid plan is changed mid-cycle THEN Stripe proration or credit behavior SHALL be shown before confirmation and reflected in Convex entitlements only after webhook-confirmed state changes.
9. IF a higher "Max" media tier is introduced THEN it SHALL be represented as a distinct entitlement tier with explicit image/video quotas, safety gates, and Stripe/native product ids before the UI advertises it.

### Requirement 18 — Reader settings, themes, typography, and layout modes

**User Story:** As a reader, I want to tune the reading experience, so that the app remains comfortable across mood, device, and accessibility needs.

#### Acceptance Criteria

1. WHEN the user opens settings THEN the client SHALL provide Day, Night, and Sepia themes; Sans, Serif, and Mono typography; and a text-size control.
2. WHEN a setting is changed THEN the client SHALL apply it immediately and persist it to guest storage or the authenticated account.
3. WHEN the user changes reading layout THEN the client SHALL support Book, Modern App, Graphic Novel, Journal, and mobile-optimized layouts from the design bundle directions.
4. WHEN the user changes stats visibility THEN the client SHALL support persistent, peek-drawer, contextual, and on-demand full-sheet HUD modes.
5. WHEN the user enables reduced motion or system accessibility preferences indicate reduced motion THEN animations, page transitions, pips, generated video autoplay, and ambient motion SHALL reduce or disable accordingly.

### Requirement 19 — Endings map and trophy crypt

**User Story:** As a player, I want to see the branches I have taken and endings I have unlocked, so that my choices feel collectible and replayable.

#### Acceptance Criteria

1. WHEN a save reaches any ending THEN Convex SHALL record the ending against the guest or authenticated account with story id, ending id, firstSeen, mode, and path metadata.
2. WHEN the player opens the endings map THEN the client SHALL render a fog-of-war branching graph showing visited paths, current path, unlocked endings, and undiscovered branches without revealing hidden choice text.
3. WHEN the player opens the trophy crypt THEN the client SHALL render unlocked endings as collectible entries and undiscovered endings as hidden placeholders.
4. WHEN an ending is first unlocked THEN the death or ending screen SHALL mark it as new and make it shareable if the account is eligible to share.
5. WHEN endings sync across devices THEN the authenticated account SHALL show the same trophy crypt and map state on web and native.

### Requirement 20 — Co-op play and remote rooms

**User Story:** As a group of readers, we want to share a tale locally or remotely, so that choosing together feels like a campfire reading.

#### Acceptance Criteria

1. WHEN a host starts co-op THEN Convex SHALL create a co-op room tied to a save, host account or guest session, room code, participant list, and turn arbitration mode.
2. WHEN participants join by URL THEN they SHALL be able to read along without an account, subject to age gate and room permissions.
3. WHEN pass-the-controller mode is active THEN the client SHALL indicate whose turn it is and only that participant or the host SHALL submit the next choice.
4. WHEN vote mode is active THEN the client SHALL collect votes reactively, show vote progress, and submit the winning choice when the vote closes or the host resolves a tie.
5. WHEN the host leaves or disconnects THEN Convex SHALL preserve the room state and apply host-recovery rules so the tale is not lost.
6. WHEN a participant joins a co-op room THEN Convex SHALL expose only room display name, avatar/initial, presence, votes, and read-along state; it SHALL NOT expose account email, billing state, mature-content setting, private saves, or unrelated endings.
7. WHEN a co-op room contains mature content THEN every participant SHALL be authenticated, paid, `18+`, and explicitly opted in before the room can continue with mature content.

### Requirement 21 — Publish, share, read-along, and fork tales

**User Story:** As a player, I want to publish the tale I experienced, so that friends can read it, share it, and fork from a decision point.

#### Acceptance Criteria

1. WHEN a player publishes a tale THEN Convex SHALL snapshot generated prose, choices taken, stat trajectory, ending state, cover, title, synopsis, privacy mode, and fork policy.
2. WHEN a tale is public or unlisted THEN anyone with access SHALL be able to read it in a paged read-only view without mutating the original save.
3. WHEN a reader forks from a decision THEN Convex SHALL create a new save initialized from the original engine state at that decision point and continue with fresh LLM generation.
4. WHEN a publisher edits cover, title, synopsis, privacy, or fork policy THEN Convex SHALL update metadata without rewriting the immutable turn snapshot.
5. WHEN a tale is friends-only THEN access SHALL require authentication and an allowed account relationship.
6. WHEN a tale is unpublished, deleted, or made private THEN public read-along and fork URLs SHALL stop resolving immediately, while internal immutable audit records remain access-controlled for owner export/deletion workflows.

### Requirement 22 — Creator authoring and seeded adventures

**User Story:** As a creator, I want to publish seeded adventures, so that other players can launch AI-continuable stories from my authored premise and rules.

#### Acceptance Criteria

1. WHEN a creator authors a seed THEN the app SHALL capture opening premise, tone, safety constraints, initial state, rule overrides, starter nodes, endings registry, and allowed media style.
2. WHEN a seed is published THEN Convex SHALL validate it against engine schemas and narrative safety rules before making it launchable.
3. WHEN a player launches a creator seed THEN Convex SHALL create a new save whose story id references the authored seed and whose continuation uses the same server-authoritative engine.
4. WHEN creator revenue share is enabled THEN play-time and subscription-attribution events SHALL be recorded for payout calculations.
5. WHEN a creator views their dashboard THEN the app SHALL show plays, completions, deaths, forks, ending distribution, and estimated earnings.
6. WHEN an account has published creator seeds THEN the library SHALL surface those account-backed seeds across browser reloads/devices, and launching one SHALL create a normal remote save instead of relying on browser-local draft state.
7. WHEN the reader submits a Seed-an-Adventure form (starter + title + premise + tone) from the creator surface THEN the client SHALL pass the title/premise/tone alongside the starterId to `game.createSave`; Convex SHALL run `evaluateTextPolicy` against the trimmed premise in the `publishing` surface (block → hard `seed_premise_blocked` AppError, same surface the free-form choice flow uses) and SHALL persist `seedPremise`, `seedTitle`, `seedTone` on the save record. The LLM scene-generation paths (`beginStreamingChoice`, `runLlmDrivenBeginStreaming`, `runLlmDrivenSubmitChoice`) SHALL prefer `save.seedPremise` over the starter node's hardcoded `seed`, `save.seedTitle` over `story.title`, and `save.seedTone` over `summary?.tone` when these fields are present, so the reader's typed premise — not the starter's default seed — drives the generated prose.

### Requirement 23 — Seasons, achievements, and leaderboards

**User Story:** As a returning player, I want time-limited tales and achievements, so that there are reasons to come back beyond a single story.

#### Acceptance Criteria

1. WHEN a season is active THEN the library SHALL surface the seasonal tale, remaining time, rules, and available achievements.
2. WHEN a player unlocks a seasonal ending or achievement THEN Convex SHALL record it with timestamp, account id, story id, rarity, and leaderboard eligibility.
3. WHEN leaderboards are shown THEN they SHALL display first-to-find, rarest-path, and completion milestones without exposing hidden paths or unsafe content.
4. WHEN a season ends THEN historical achievements SHALL remain in the trophy crypt and seasonal leaderboards SHALL become read-only.

### Requirement 24 — Pro media and ambient soundscape

**User Story:** As a Pro player, I want illustrations, short cinematic moments, and ambient sound, so that the story feels richer without slowing the read loop.

#### Acceptance Criteria

1. WHEN a Pro-entitled scene qualifies for illustration THEN Convex SHALL schedule Vertex AI image generation asynchronously and attach the resulting asset when ready.
2. WHEN a chapter beat or death screen qualifies for cinematic media THEN Convex SHALL schedule Veo generation asynchronously and never block text streaming on video completion.
2a. WHEN Veo is scheduled for a scene that already has a generated Imagen still THEN Convex SHALL pass the Imagen image to Veo as the first-frame `image` reference (i2v) so the generated clip opens on the same still the reader sees in the image plate; when the still is unavailable (placeholder fallback or Imagen failure) Convex MAY fall back to a text-only Veo request so the reduced-motion / placeholder case still produces a clip. All Veo i2v queueing SHALL flow exclusively through the post-Imagen chain in `runImagenJob`; the turn orchestrator SHALL NOT call `queueSceneVideo` in parallel with `queueSceneImage`, so each scene incurs exactly one Veo job rather than a text-only race plus the i2v chain.
3. WHEN generated media is shown THEN the client SHALL fade it in only after the prose is readable and SHALL respect reduced-motion and mute preferences.
4. WHEN ambient sound is enabled THEN the client SHALL play scene-tagged loops, respect system mute and user mute, and continue appropriately on native background rules.
5. WHEN generated media is persisted THEN Convex SHALL store provenance, prompt metadata, provider, asset URL, entitlement requirement, and safety classification outcome.

### Requirement 25 — Native iOS and Android apps

**User Story:** As a mobile player, I want the same app on iOS and Android, so that my tales, subscription, and settings travel with me.

#### Acceptance Criteria

1. WHEN the app is built with Expo THEN the same React Native component tree SHALL support web, iOS, and Android.
2. WHEN native apps authenticate THEN they SHALL use secure token storage and the same BetterAuth account identity as web.
3. WHEN native purchases occur THEN iOS SHALL use Apple IAP and Android SHALL use Google Play Billing where app-store policy requires native payment, and Convex SHALL verify receipts server-side before normalizing them into the same entitlement model used by Stripe.
4. WHEN the daily candle relights or a co-op turn is waiting THEN native apps SHALL be able to receive push notifications after user opt-in.
5. WHEN native builds are released THEN EAS Build, EAS Submit, and EAS Update SHALL be configured for development, staging, and production channels.

### Requirement 26 — Starter adventure library

**User Story:** As a player, I want multiple high-quality starter adventures, so that the app has replay value from day one.

#### Acceptance Criteria

1. WHEN the library loads THEN it SHALL show `training-room`, `bone-cathedral`, `iron-court`, and `ashfall` starter adventures with title, cover, tone, difficulty, estimated length, and entitlement requirements.
2. WHEN a starter adventure is launched THEN it SHALL conform to the same engine schema, safety rules, endings registry, and LLM continuation contract as the tutorial.
3. WHEN starter adventures are tested THEN each SHALL include at least one success ending, one death ending, inventory-gated choices, stat changes, hidden-state influence, and replayable branching.

### Requirement 27 — Operator dashboard

**User Story:** As an operator, I want to monitor activation, cost, safety, billing, and live reads, so that the product can be operated without third-party trackers.

#### Acceptance Criteria

1. WHEN an admin opens the dashboard THEN the app SHALL verify an admin claim before showing any operator data.
2. WHEN funnel metrics are viewed THEN the dashboard SHALL show landing, age gate, first scene, tutorial completion, signup, paywall, subscription, Pro upgrade, publish, and co-op conversion.
3. WHEN cost metrics are viewed THEN the dashboard SHALL show LLM, image, video, and storage cost per session, provider, story, and cohort.
4. WHEN safety metrics are viewed THEN the dashboard SHALL show redacted counts and rates for safety blocked, redirected, and ended events without exposing unsafe raw text.
5. WHEN live metrics are viewed THEN the dashboard SHALL show active reads, active co-op rooms, turn latency, provider fallback rate, and error rates via Convex reactive queries.

### Requirement 28 — Infrastructure, deployment, and environment management

**User Story:** As the development team, I want repeatable infrastructure and deployment, so that web, native, Convex, AI providers, and billing can ship reliably.

#### Acceptance Criteria

1. WHEN infrastructure is provisioned THEN Pulumi SHALL create GCP project resources for Vertex AI, Cloud Storage, Cloud CDN, Cloud DNS, Secret Manager, IAM, and monitoring.
2. WHEN Convex deploys THEN environment variables SHALL be sourced from GCP Secret Manager or approved deployment secrets and SHALL never be committed to the repo.
3. WHEN web deploys THEN Expo web export SHALL publish to GCP Cloud Storage behind Cloud CDN and the configured domain.
4. WHEN CI runs THEN GitHub Actions SHALL execute lint, typecheck, unit tests, Convex tests, web build, and deployment steps appropriate for the target branch.
5. WHEN production deploy completes THEN uptime checks and alert policies SHALL monitor static web availability, Convex function errors, provider fallback spikes, and Vertex AI errors.

### Requirement 29 — Save versioning and migration

**User Story:** As the development team, I want saves to survive engine evolution, so that players do not lose tales when schemas change.

#### Acceptance Criteria

1. WHEN a save is created THEN it SHALL store an engine schema version and story schema version.
2. WHEN Convex loads an older save THEN it SHALL run registered migration functions before engine evaluation and persist the upgraded version atomically.
3. WHEN a migration fails THEN Convex SHALL leave the original save unchanged, log a redacted migration error, and show a recoverable client state.
4. WHEN migrations are added THEN tests SHALL cover representative old saves, turn history replay, endings state, inventory, flags, delayed consequences, and published tale snapshots.

---

## Non-Functional Requirements

### Code Architecture and Modularity

- **Single Responsibility Principle**: each engine module owns exactly one concept (`visibility.ts`, `inventory.ts`, `delayed.ts`, etc.); each Convex function file owns one feature (`turn.ts`, `saves.ts`); each React component file owns one component.
- **Engine purity**: `packages/engine/` SHALL NOT import from `react`, `convex/*`, `expo`, `@anthropic-ai/sdk`, `@google/generative-ai`, or any I/O module — enforced by lint rule.
- **Modular design**: client components for stats HUD, choice list, prose stream, and pip animation SHALL be independently testable with mocked save state.
- **Dependency direction**: `apps/app/* → packages/* → (nothing)`; `convex/* → packages/* → (nothing)`. The engine never imports from `apps/` or `convex/`.
- **Clear interfaces**: API contracts between the client and Convex SHALL be defined as Zod schemas in `packages/shared/api/`; Convex generated `api` types SHALL be the only path through which the client calls server functions.

### Performance

- **Time-to-first-scene** ≤ 1500ms p50 of cover-CTA activation (excluding LLM stream which begins inside this window).
- **Time-to-first-token** ≤ 1500ms p50, ≤ 3000ms p95, of accepted choice submission.
- **Stat pip latency** ≤ 100ms after the corresponding structured engine event or prose-anchor metadata is received by the client.
- **Stats peek-drawer reveal** ≤ 16ms (one frame).
- **Reactive query push** ≤ 1s from server mutation to client render.
- **Engine evaluation** for any single turn (`applyChoice` + `enterNode` + `evaluateConditions` for all next-step choices) SHALL complete in ≤5ms p99 on a developer laptop, so engine time is not part of the user-visible latency budget.

### Security

- **Server-authoritative state**: every state-changing operation SHALL go through a Convex mutation/action authorized by the guest session token; the client cannot mutate save state directly.
- **LLM output is untrusted text**: parsed only against a strict Zod schema; rendered as plain text (no HTML, no `dangerouslySetInnerHTML`). In `llm-driven` mode the model may propose choices with `effects`, but the engine's schema hard-clamps every value at parse time (stat `±10`, currency `±100`, ≤6 effects/choice, ≤12-node delayed horizon, all strings length-bounded) and the engine is the exclusive applier of state mutations — a prompt-injected model cannot exceed those bounds (see Requirement 9).
- **Prompt-injection defense**: structurally enforced by Requirement 9 — the LLM's output is reduced to prose plus optional display metadata for engine-owned events and choices; it never names or applies the stat patch.
- **Narrative safety defense**: structurally enforced by Requirement 11 — unsafe self-harm, suicide, depressive, or player-directed despair content is blocked before prompting, before persistence, and before rendering.
- **Mature-content defense**: structurally enforced by Requirement 12 — adult-only language, subject matter, and imagery are blocked unless the account is paid, `18+`, and explicitly opted in.
- **Age gate enforcement**: structurally enforced by Requirement 1 — under-13 visitors cannot create playable sessions or saves, and eligible visitors store only an age band rather than date of birth.
- **Guest sessions**: opaque, randomly generated, tied to a single `accounts` row; not crawlable; not enumerable; required as proof for guest-owned reads, mutations, and LLM stream authorization.
- **No secrets in the client bundle**: Anthropic and Vertex AI keys live exclusively in Convex env (sourced from GCP Secret Manager).

### Reliability

- **Provider fallback**: an Anthropic outage or single-call failure SHALL trigger provider-router fallback within Requirement 5.7's parameters; Anthropic, Vertex AI Gemini, and DeepSeek slots must be plumbed in from day one of this spec, with DeepSeek limited to eligible cost-optimized text.
- **Deterministic fallback**: if both providers fail, Convex persists canonical default prose with engine-provided choices so the loop never blocks the player permanently.
- **Safety fallback**: if safety classification or provider moderation blocks a turn, Convex SHALL choose safe redirection or safe story closure over repeated generation attempts.
- **Save durability**: every accepted turn SHALL be persisted in `turn_history` (append-only) before the response returns to the client; a crash mid-turn SHALL leave the save resumable from the last persisted state.
- **Idempotent retries**: turn submission SHALL accept an optional client-generated request id; duplicate ids within 60s SHALL return the original result without re-running the engine or LLM.

### Usability

- **Story first**: the prose SHALL be the visual focal point of the reading view at all times; HUD chrome SHALL never compete with prose for attention (Game Spec §6, product.md principles 1, 5) and the default layout SHALL align with the `ReadBook` wireframe direction from `design-bundle/project/surfaces-reading.jsx`.
- **Agency is felt**: per product.md principle 3, no scene in the tutorial may have all three flavor choices in a row (no choice without at least a stat / flag / inventory / ending consequence).
- **Safe closure is available**: when content approaches a safety trigger, the player's strongest available path SHALL be a clear in-world option to end the story safely and without penalty.
- **Reload safety**: a reload mid-prose-stream SHALL never lose the player's progress; the persisted prose-so-far is restored and the stream resumes (or completes silently if it has finished server-side).
- **Accessibility**: all interactive elements (choices, peek-drawer trigger, "Begin again" CTA) SHALL be keyboard-reachable and have screen-reader labels; prose and pip animations SHALL respect `prefers-reduced-motion` (instant state changes rather than animated transitions when set).

---

## Delivery and Agent-Team Handoff

All requirements above are in scope for the product. During the Design and Tasks phases, implementation SHALL be split into parallelizable workstreams with clear ownership boundaries: engine, Convex read loop, LLM/safety, client reader UI, auth/accounts, billing, co-op, publishing/creator, media, native, infrastructure, analytics/admin, and content/stories. Each task prompt SHALL include file ownership, leverage points, requirement references, test expectations, and implementation-log instructions so downstream agent teams can work without duplicating APIs or crossing module boundaries.

---

### Requirement 30 — Visual design contract and asset pipeline

**User Story:** As an implementer, I want a frozen visual contract — tokens, fonts, icons, logos, covers — so the production app matches the approved hi-fi design without me having to re-derive values.

#### Acceptance Criteria

1. WHEN `apps/app/theme/` is built THEN it SHALL import color, spacing, radius, shadow, and font tokens from `apps/app/assets/design/tokens/tokens.json` (or a generated TS module derived from it) and SHALL NOT define inline color or font values that conflict with the token file.
2. WHEN any production component references a color THEN it SHALL use a semantic alias (`paper`, `paper2`, `paper3`, `ink`, `inkSoft`, `inkFaint`, `inkGhost`, `candle`, `candleSoft`, `danger`, `success`, `night`, `day`, `shadow`) and SHALL NOT reference primitive scales (`paper.50`, `ember.700`, etc.) directly.
3. WHEN any production component references the danger token (`#7a2218`, alias `danger`) THEN the use SHALL be a death surface, locked choice, paywall surface, or mature opt-in surface; ambient gold accents SHALL use `candle` instead. Lint or visual review SHALL flag other uses.
4. WHEN three themes are configured (Requirement 18.1) THEN their canonical names SHALL be `sepia`, `night`, and `day`; the back-compat aliases `parchment` (→`sepia`) and `midnight` (→`night`) MAY resolve via the token file but SHALL NOT appear in new code.
5. WHEN the reader font setting is rendered THEN options SHALL be `Serif` (default Lora), `Sans` (Atkinson Hyperlegible), and `Mono` (JetBrains Mono); the display face for chapter titles, ending names, and death plates SHALL be `IM Fell English` independent of the reader-font setting.
6. WHEN icons are required THEN the production app SHALL use the 16-icon set in `apps/app/assets/design/icons/` for `candle`, `book`, `heart`, `coin`, `skull`, `eye`, `key`, `flame`, `compass`, `crown`, `hourglass`, `scroll`, `quill`, `sack`, `people`, and `sparkle`; lucide-react-native MAY be used as fallback only for icons not in this set.
7. WHEN starter adventures are listed in the library (Requirement 26.1) THEN their cover assets SHALL be loaded from `apps/app/assets/design/covers/cover-{training-room,bone-cathedral,iron-court,ashfall}.{svg,png}`.
8. WHEN the app's brand mark is rendered (header lockup, splash, share card, favicon) THEN it SHALL be loaded from `apps/app/assets/design/logos/` and `apps/app/assets/design/marketing/`; the production app SHALL NOT inline a regenerated SVG of the wordmark or candle glyph.
9. WHEN a Pro media frame is rendered (Requirement 24.1, 24.2) THEN it SHALL implement the four-state upgrade pattern (Skeleton → Image ready → Video buffering → Video playing) defined in design.md "MediaPlate Upgrade Pattern"; reduced-motion preference SHALL keep the frame on state 2 (image) and SHALL NOT advance to video.
10. WHEN any visual surface differs between `apps/app/assets/design/design-system.html` and the implemented production component THEN the canvas is the reference rendering — the discrepancy SHALL be either patched in production or, if the canvas itself is wrong, patched in the canvas with a token/spec change ratified in this document. Drift SHALL NOT be left silent.

### Requirement 31 — NPCs and Companions

**User Story:** As a reader, I want the world to be populated by named characters I can travel with, befriend, antagonize, and talk to, so that the story has relationships and not just rooms.

#### Acceptance Criteria

1. WHEN the engine constructs `PlayerState` THEN it SHALL carry an optional `npcs: Record<string, NpcState>` field where each `NpcState` SHALL contain `id`, `name`, `role` (one of `"companion"`, `"ally"`, `"rival"`, `"neutral"`, `"antagonist"`), `disposition` (integer in `-100..100`), optional `location` (node-id-like tag), `attributes` (same `{ id, label, value, visibility }` shape as player attributes), optional `inventory` (same shape as player inventory), `knownFacts` (`string[]` of short tags surfaced to the LLM), optional `relationships` (`Record<otherNpcId, dispositionDelta>`), and `flags` (`Record<string, boolean | number>`).
1a. WHEN saves are persisted THEN the `npcs` field SHALL be stored inside the existing `saves.state` JSON column without a hard Convex schema bump for the column itself.
1b. WHEN the engine's `schemaVersion` is incremented for this feature THEN `migrateEngineState` SHALL add an empty `npcs: {}` object to legacy `PlayerState` snapshots that lack the field, leaving all other fields untouched, and the migration SHALL be covered by Requirement 29.4's representative-save test set.
2. WHEN the LLM returns a turn proposal THEN that proposal SHALL only carry presentation metadata about NPCs — NPC names appearing in prose and an optional `npcMentions: string[]` for prompt-anchor metadata — and SHALL NOT carry any NPC state mutation; consistent with Requirement 9, all NPC state changes SHALL flow through engine-authored effects.
2a. WHEN the engine processes scene or choice effects THEN it SHALL recognize the new effect kinds `npc_spawn`, `npc_despawn`, `npc_relocate`, `npc_disposition_delta`, `npc_attribute_delta`, `npc_inventory_add`, `npc_inventory_remove`, `npc_flag_set`, and `npc_learn_fact`, and SHALL validate each: unknown NPC ids SHALL reject the effect, disposition deltas SHALL be clamped into `-100..100`, attribute deltas SHALL respect the same bounds as player attribute deltas, and inventory mutations SHALL respect the same item-registry checks as player inventory effects.
3. WHEN the engine resolves the current scene for the prompt builder THEN the builder SHALL include a compact NPC sheet for each NPC whose `location` matches the current scene/node OR who has been referenced in the last N turns of the memory window (N configurable, default 3); the sheet SHALL contain `{ name, role, disposition, knownFacts (top 3), visible attributes }` and SHALL omit NPCs that are out of scope so the prompt does not bloat with the full roster.
4. WHEN an authored choice declares `requiresNpc: <npcId>` THEN the engine's visibility evaluator SHALL hide the choice when that NPC is not present in the current scene (per Requirement 4); WHEN a choice declares `targetNpc: <npcId>` THEN the prompt builder SHALL tell the LLM the choice acts on that specific NPC; WHEN the free-form "Option D" path is used THEN the reader's prose MAY reference NPCs by name and the LLM MAY return `npcMentions: string[]` so the engine surfaces those NPCs in subsequent prompts per Requirement 31.3.
5. WHEN a `skill_check` effect declares `includeCompanions: true` AND one or more NPCs in scope have `role === "companion"` THEN the engine SHALL aggregate each companion's visible attribute matching the check's `statId` into the player's effective check total; the engine SHALL still evaluate terminal vitality and death conditions on the player alone, and companion death SHALL be modeled as a separate `npc_despawn` effect that MAY trigger an authored terminal scene.
6. The conversation surface SHALL be governed by these rules:
6a. WHEN a reader addresses an NPC by name through the existing free-form "Option D" path THEN the prompt builder SHALL include the addressed NPC's sheet (per Requirement 31.3) so the LLM responds in character; no new dedicated conversation UI surface is required for v0.
6b. (Phase 2 — stretch) WHEN a "Talk to <NPC>" choice variant is offered THEN selecting it SHALL open a focused turn loop where the next scene is constrained to dialogue with that NPC and at most one `npc_*` effect, and a fixed "End conversation" choice SHALL always be present; the reader MAY also leave the conversation by using the free-form path.
6c. WHEN a conversation turn is submitted THEN it SHALL still consume the reader's daily-turn allowance per Requirement 17 and, if typed, SHALL still pass `evaluateTextPolicy` on the `publishing` surface per Requirement 22.7.
7. WHEN an authored story in `packages/stories` declares `initialNpcs: Record<string, NpcState>` THEN the engine SHALL merge that map into the initial `PlayerState.npcs` when the save is created; the "Seed an Adventure" creator flow (Requirement 22.7) MAY add an optional NPC-roster builder in a future iteration and SHALL be explicitly out of scope for v0.
8. WHEN a save uses co-op THEN the existing `coop_rooms` table (Requirement 20) SHALL NOT be conflated with `npcs`: NPCs are state-driven AI actors and co-op participants are real human accounts; both SHALL be able to coexist in the same save (e.g. two human readers and one NPC companion).
9. WHEN NPC dialogue prose is generated THEN it SHALL pass the same `evaluateTextPolicy` gates as other scene prose per Requirement 11; WHEN a reader types an NPC name through the free-form path THEN the typed text SHALL be validated under the `publishing` surface per Requirement 22.7; the engine SHALL NOT auto-assign `role === "antagonist"` from reader-typed input — antagonist roles SHALL be authored or pass through policy review before persistence.
10. WHEN the engine's test suite is run THEN `applyChoiceAndEnterNode` SHALL include cases for each `npc_*` effect kind (spawn, despawn, relocate, disposition delta, attribute delta, inventory add/remove, flag set, learn fact); the LLM router test SHALL include both a case where the player-state snapshot contains `npcs` and a back-compat case where `npcs` is absent.

### Requirement 32 — Story Arc Beats

**User Story:** As an author, I want to declare specific narrative moments my story must hit (a beat the protagonist must experience, a revelation that must occur, a confrontation that must happen), so the LLM can't end the story by skipping past authored plot points.

#### Acceptance Criteria

1. WHEN an authored story declares `arcBeats: ArcBeat[]` THEN each `ArcBeat` SHALL contain `id` (string), `name` (string, short label for tooling), `description` (string, the prose-level intent the LLM should aim to surface), `requiredBefore` (optional discriminated union: `{ kind: "ending" }` | `{ kind: "endingId"; endingId: string }` | `{ kind: "death" }` | `{ kind: "turn"; turnNumber: number }`), and `priorityHint` (optional `"early"` | `"mid"` | `"late"`).
2. WHEN the engine constructs `PlayerState` THEN it SHALL track `completedArcBeats: Record<string, { completedAt: number; turnNumber: number }>` and SHALL expose a derived `pendingArcBeats(story, state)` helper that returns beats not yet in `completedArcBeats`.
3. WHEN a scene prompt is built for an LLM-driven story THEN the prompt builder SHALL include a "Pending arc beats" section listing the top 3 highest-priority pending beats with their `name` + `description`, instructing the model to aim to surface one this turn if narratively appropriate. The model is NEVER required to surface a beat in any single turn — this is a soft nudge.
4. WHEN the LLM returns a proposal THEN it MAY include an optional `arcBeatCompletions: string[]` field listing the ids of beats it intended to surface this turn (purely presentational; the engine validates).
5. WHEN the engine validates a proposal THEN any `arcBeatCompletions` ids MUST match a known `arcBeats[].id` for the active story; unknown ids SHALL be silently dropped. The engine SHALL append all valid ids to `state.completedArcBeats` with the current `turnNumber` and timestamp.
6. WHEN a terminal/ending is about to fire (player vitality drops to 0 OR an authored ending scene is reached OR the LLM proposes a `terminal` field) THEN the engine SHALL check `pendingArcBeats(story, state)` filtered to those whose `requiredBefore.kind` matches the imminent terminal (e.g. `{ kind: "ending" }` blocks any non-safe ending; `{ kind: "endingId", endingId: "ending-cathedral" }` blocks specifically that ending). If any such pending required-before beats exist, the engine SHALL reject the terminal (`arc_beats_pending`) and force another scene; the next prompt SHALL prepend a stronger directive: "Required before ending: <pending beat name(s) + description(s)>. Surface this beat now."
7. WHEN the engine forces a "must-surface-beat" turn THEN it SHALL set `state.forcedBeatTurn = true` and the prompt builder SHALL include the stronger directive (above). The flag clears once the next valid proposal lands.
8. WHEN a beat's `requiredBefore.kind === "turn"` AND the save's `state.turnNumber >= requiredBefore.turnNumber` AND the beat is not yet completed THEN the engine SHALL set `state.forcedBeatTurn = true` on the NEXT prompt (one-turn warning before forcing), and on the turn after that SHALL still allow the LLM to proceed even if the beat wasn't surfaced (a turn-bound beat is a "should have surfaced by now" warning, not a hard ending gate).
9. WHEN the engine's `schemaVersion` is incremented for this feature THEN `migrateEngineState` SHALL add `completedArcBeats: {}` and `forcedBeatTurn: false` to legacy `PlayerState` snapshots that lack the fields, leaving all other fields untouched, and the migration SHALL be covered by Requirement 29.4's representative-save test set.
10. WHEN the engine's test suite runs THEN `applyChoiceAndEnterNode` SHALL include cases for (a) beat completion via valid `arcBeatCompletions`, (b) unknown beat id silently dropped, (c) terminal rejection when required-before beats pending, (d) terminal allowed when all required-before beats complete, (e) `forcedBeatTurn` flag lifecycle.
11. WHEN the "Seed an Adventure" creator surface (Requirement 22.7) is used THEN the open premise SHALL launch with no arc beats by default; future authored seed-flow iterations MAY allow the reader to author a 3-beat sketch (out of scope for v0 — explicitly noted alongside Requirement 31.7's NPC-roster-builder deferral).

### Requirement 33 — Running story summary (breadcrumb)

**User Story:** As a reader, I want the story to remember what's already happened across many turns so the writer doesn't loop on the same actions (e.g. asking me to open a coconut for the third time in a beach story), so each turn feels like it's building on the canonical history of my save.

#### Acceptance Criteria

1. WHEN a save is persisted THEN `SaveRecord` SHALL carry an optional `storySummary?: string` field (declared in `convex/schema.ts` `saves` table and mirrored in `convex/saves.ts:SaveRecord`) holding the most recently computed canonical-state summary; the field MAY be absent on freshly-created saves and on legacy saves before this feature lands.
2. WHEN a scene completes through `convex/game.ts:completeSceneStream` THEN that action SHALL schedule a parallel, non-blocking summarizer action (`convex/llm/summarizer.ts`) that re-derives `save.storySummary` from the prior summary plus the just-completed scene's prose and effects; the summarizer SHALL NOT block the user-visible turn return.
3. WHEN the summarizer action runs THEN it SHALL call the same provider router used for scene generation (Anthropic primary, Vertex Gemini fallback) with a tight system prompt that produces canonical-facts-only prose (named NPCs, current location, key inventory, established world facts, completed beats) and explicitly drops transient texture (weather, mood, single-line dialogue beats that did not change state).
4. WHEN the summarizer call succeeds THEN the new summary SHALL be capped at ~500 characters (hard truncate at the last sentence boundary at or before the cap) and SHALL be persisted to `save.storySummary` via a mutation atomically with no other state changes.
5. WHEN the summarizer call fails (provider error, parse error, safety block, or any thrown exception) THEN the engine SHALL keep the prior `save.storySummary` value untouched (failure-safe — never blank an existing summary because of a transient provider hiccup) and SHALL log a redacted summarizer-failed metric for the operator dashboard (Requirement 27.5).
6. WHEN `convex/llm/prompts/scene.ts` builds the scene prompt for an LLM-driven turn THEN it SHALL surface `save.storySummary` (when present) as a `Story so far: <summary>` block placed ABOVE the memory window and BELOW the player-state snapshot and NPC-sheet sections, so the LLM sees canonical state before transient recent-turn texture; the block SHALL be omitted entirely when `storySummary` is absent or empty.
7. WHEN `SceneGenerationRequest` (declared in `convex/llm/types.ts`) is built THEN it SHALL carry an optional `storySummary?: string` field threaded from the save record; the Zod validator SHALL accept the field as optional so back-compat saves without a summary continue to validate.
8. WHEN the engine's test suite runs THEN the summarizer SHALL be covered by (a) a happy-path test verifying the summary updates after a scene completes, (b) a failure-safe test verifying the prior summary is preserved when the provider call throws, (c) a cap test verifying summaries longer than 500 chars are truncated at a sentence boundary, and (d) a prompt-shape snapshot test pinning the `Story so far:` block placement relative to the memory window.

### Requirement 34 — Stat / inventory change narration

**User Story:** As a reader, when my vitality, currency, attributes, or inventory change, I want to understand WHY from the prose I'm reading — not see numbers jump silently while the narrator talks about something unrelated.

#### Acceptance Criteria

1. WHEN `convex/llm/prompts/scene.ts` builds the scene prompt THEN the rule-7 (stat-effect) directive SHALL be strengthened from a soft "you may narrate" to a mandatory "the prose MUST narrate the cause of any stat, currency, or inventory change that the engine applies this turn — if the engine reports a vitality loss, the prose must surface the in-world reason (injury, hunger, fatigue, etc.); if currency rises, the prose must surface the transaction or find that produced it".
2. WHEN the reader's prose stream renders any scene that produced a non-zero engine echo (i.e. `deriveEngineEcho` or `deriveRemoteEcho` returned a non-empty string) THEN a new `<EffectBadge>` UI component SHALL render inline near the prose, surfacing the most recent change in human-readable form (e.g. "−1 vitality", "+3 wits", "+ Iron Key").
3. WHEN `<EffectBadge>` is rendered THEN it SHALL color-tone the badge by direction: positive changes use `success` (token alias), negative changes use `danger` (token alias, consistent with the Ember Rule from Requirement 30.3), and neutral changes (pure inventory swaps, flag sets) use `candleSoft`; no hex literals SHALL appear in the component source.
4. WHEN `prefers-reduced-motion` is set (Requirement 18.5, NFR Usability) THEN `<EffectBadge>` SHALL render as a static block with no entry/exit animation; otherwise it MAY use the same brief candle-flicker entry the stat-pip uses, capped at the 100ms pip-latency budget (NFR Performance).
5. WHEN the projection returned by `apps/app/hooks/useTurn.ts` is consumed by the reading layouts THEN that projection SHALL expose the most recent echo string AND a structured `recentEffect` payload (`{ kind: "vitality" | "currency" | "attribute" | "inventory" | "flag"; label: string; delta?: number; tone: "positive" | "negative" | "neutral" }`) derived from the same `deriveEngineEcho` / `deriveRemoteEcho` helpers; no new server-side state or schema change SHALL be required — this is a pure client-side projection of data the hook already receives.
6. WHEN every reading layout in `apps/app/components/reading/layouts/*.tsx` renders THEN it SHALL position `<EffectBadge>` consistent with that layout's existing stat-HUD placement: `Book` and `Journal` render it inline within the prose column; `GraphicNovel` and `ModernApp` render it floating near the stat-HUD; `Mobile` renders it as a thin strip immediately above the choice list. The badge SHALL never compete with prose for primary focus (NFR Usability — "story first").

### Requirement 35 — Visual consistency via reference image anchors

**User Story:** As a reader, I want the protagonist and the setting to look consistent from scene to scene — same face, same clothing, same world — so the story feels like a real illustrated book and not a sequence of unrelated paintings.

#### Acceptance Criteria

1. WHEN a scene image is requested for any turn after turn 1 of a save THEN the primary generation path SHALL call **Gemini Flash Image** (`gemini-3.1-flash-image` — Nano Banana 2, now GA; overridable via `GEMINI_FLASH_IMAGE_MODEL`, e.g. `gemini-3-pro-image` for the premium tier or `gemini-3.1-flash-lite-image` for cost) via the `convex/media/geminiImageClient.ts` wrapper, passing the scene's text prompt PLUS the save's stored protagonist anchor and setting anchor image bytes as `inline_data` parts in the multi-modal request, so the model conditions on those references when synthesizing the scene image.
2. WHEN the LLM scene proposal is generated on turn 1 of a save (initial scene only) THEN the proposal schema (in `packages/engine/src/llm.ts`) SHALL accept two new optional string fields, `protagonistAnchor` and `settingAnchor`, each ≤500 chars, describing respectively a portrait-style image of the protagonist and an establishing-shot image of the world's signature setting; these fields are presentational-only (consistent with Requirement 9 and the `npcMentions` precedent from Requirement 31) and SHALL NOT mutate engine state.
3. WHEN the engine processes the turn-1 proposal AND either anchor field is present THEN `convex/game.ts:completeSceneStream` SHALL schedule a new `queueAnchorImage` job (in `convex/media/sceneMedia.ts`) in parallel with the turn-1 scene image and Veo jobs, generating each anchor as a standalone Imagen 4 fast call (text-only, since no prior anchors exist yet) and persisting the resulting bytes as an `assets` row.
4. WHEN an anchor `assets` row is created THEN the `assets` table (in `convex/schema.ts`) SHALL carry a new `referenceKind?: "protagonist" | "setting"` field to distinguish anchors from scene plates; the save record SHALL store `anchorProtagonistAssetId?: Id<"assets">` and `anchorSettingAssetId?: Id<"assets">` (declared in `convex/schema.ts` saves table and mirrored in `convex/saves.ts:SaveRecord`) pointing at the two anchor rows.
5. WHEN `convex/media/sceneMedia.ts:queueSceneImage` runs for any turn ≥ 2 AND both anchor assets exist on the save THEN it SHALL fetch the anchor bytes from Convex storage, base64-encode them, and pass them as `inline_data` parts on the Gemini Flash Image request alongside the scene text prompt; the resulting bytes are stored via the existing `ctx.storage.store` + asset-row pipeline and chained into `queueSceneVideo(imageStorageId)` for i2v (unchanged from Requirement 24.2a).
6. WHEN the Gemini Flash Image call fails (provider error, safety block, network timeout, or quota exhausted) THEN `runImagenJob` SHALL fall back to the current Imagen 4 fast (text-only) path so scene image generation never breaks the read loop; the fallback SHALL be logged as a `gemini_anchor_fallback` metric for the operator dashboard.
7. WHEN turn 2 fires BEFORE the turn-1 anchor generation has completed (race condition — anchor jobs are parallel and may take 3-10s while the reader is already reading turn 1) THEN `queueSceneImage` SHALL detect the missing anchors and proceed without references (calling Gemini Flash Image text-only, or falling back to Imagen 4 fast); the engine SHALL NOT block turn 2 on anchor availability. Once anchors land, every subsequent scene benefits.
8. WHEN scene image generation has produced a still THEN the Veo i2v chain (Requirement 24.2a) SHALL remain unchanged: `queueSceneVideo(imageStorageId)` still passes the anchored still as the Veo first-frame, so video inherits the same character + setting consistency the still already has. No Veo-side changes are required to honor anchors.
9. WHEN `convex/llm/prompts/scene.ts` is built on turn 1 of any LLM-driven save THEN the prompt SHALL include a rule instructing the model: "If this is the opening scene of the story, also include `protagonistAnchor` (a portrait description of the protagonist suitable for image generation: ~2-3 sentences, focus on face, clothing, signature props, lighting) and `settingAnchor` (an establishing-shot description of the world's signature setting: ~2-3 sentences, focus on architecture, mood, color palette, distinctive geography). These describe images and SHALL NOT include action or dialogue."
10. WHEN the engine's test suite runs THEN `convex/tests/sceneMedia.test.ts` SHALL include an end-to-end test verifying that (a) turn-1 anchor fields on a proposal trigger `queueAnchorImage` jobs that persist `assets` rows with `referenceKind: "protagonist" | "setting"` and update the save's `anchorProtagonistAssetId` / `anchorSettingAssetId`, (b) a turn-2 `queueSceneImage` call reads those assets and passes their bytes as `inline_data` parts on the Gemini Flash Image request, (c) a simulated Gemini failure falls back to Imagen 4 fast text-only without breaking the turn, and (d) a turn-2 that fires before anchors land continues without references and does not throw.
