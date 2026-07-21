# Tasks — Reading Modes

Execution: THREE SEQUENCED WAVES, cheapest-first, so the platform earns each
mode before paying for the next. Each wave is a parallel agent team with
disjoint file ownership plus an INTEGRATOR who solely owns the reserved files
(`convex/schema.ts`, `convex/index.ts`, `convex/game.ts`). Waves run in order
— Wave N+1 does not begin until Wave N's merge gate is green and its
live-verification task has passed on cyoa-local — so a file may be owned by a
different agent in a later wave without conflict (e.g. `ReaderScreen.tsx` is
RM-AUTO's in Wave 1 and RM-NOVEL-UI's in Wave 3). Within a wave, ownership is
strictly disjoint.

- **Wave 1 — Auto-narrator (R1) + Read-runs-as-books (R2).** Lowest risk,
  mostly client, ZERO server surface, ZERO schema change. The whole wave is
  pure presentation over the existing turn path and `getRunHistory`.
- **Wave 2 — Illustrated Book (R3).** Pro / media. A new layout cloned from
  `GraphicNovelLayout` + one MODE-SCOPED media-guarantee fallback; the still is
  already produced, only the credit-exhaustion path is new.
- **Wave 3 — Novel mode (R4).** The deepest, the only contract-moving mode:
  the reserved `readingMode` schema field, an ADDITIVE novel Zod schema, a
  mode-scoped prompt variant, five parse-site selections, and the synthetic
  `turn-page` stamp.

Every agent MUST read story-engagement `design.md` §0 (BC1–BC10) and
reading-modes `design.md` §0 (RM1–RM10) before its first edit. Requirement ids
(R1–R6) refer to this spec's `requirements.md`; design section refs (§0–§7) to
this spec's `design.md`. Merge gate per wave: full monorepo typecheck + full
test suite green, then dockerized deploy (`docker compose restart convex` /
`docker compose restart app`, BC8).

Conventions for every task: every branch keys off an EXPLICIT value
(`readingMode === "novel"`, `cinematicMode === "illustrated_book"`,
`layout === "illustratedBook"`) so absence is always today's exact path
(RM4/BC9); the existing `llmSceneOutputSchema.min(2)` stays byte-identical for
branching (RM2); the deprecated `runLlmDrivenSubmitChoice` (grep
`@deprecated DEAD CODE` — `convex/game.ts` ≈ :4422) is NEVER re-wired (RM1);
`responseSchema.ts` is NEVER edited (RM2, a Non-Goal); conditional-spread +
`cleanDoc` for optional fields, never pass `undefined`
(`exactOptionalPropertyTypes`, BC4); pure modules import nothing from React
Native and carry a `.test.mjs` (BC6); schema.ts / index.ts / game.ts wiring is
integrator-owned (BC7).

---

# WAVE 1 — Auto-narrator (R1) + Read-runs-as-books (R2)

No reserved-file edits this wave (zero server surface, zero schema). The
integrator's job is the merge gate + cyoa-local verification only.

## Agent RM-POLICY — owns `apps/app/components/reading/autoNarrator.ts` (new) + `apps/app/components/reading/__tests__/autoNarrator.test.mjs` (new)

- [x] 1.1 Pure auto-pick policy + pacing constants (R1.3, R1.9)
  Create `autoNarrator.ts` mirroring the existing small-policy modules
  `softSignup.ts` (`apps/app/components/reading/softSignup.ts`) and
  `lockCoach.ts` (`apps/app/components/choices/lockCoach.ts`): the pure
  `pickAutoChoice(choices)` that FILTERS locked rows (the non-submittable
  ones — grep `choice.locked` — `apps/app/components/choices/ChoiceList.tsx` ≈
  :43/:65), selects the "narrator's pick" among the remainder (seeded/weighted
  or uniform — spec's design call; make it deterministic under a seed for
  testability), and returns `null` when EVERY choice is locked (which correctly
  stalls auto and hands control back per R1.2). Export the reduced-motion-aware
  pacing constants (`AUTO_DELAY_MS`, optional per-session advance cap) as named
  constants in this module (R1.9). No React, no timers here — pure functions
  only. Tests: locked-filtering, `null` when all locked, deterministic pick
  under a seed, the narrator's-pick weighting, and the constants' presence.
  - _Leverage: `apps/app/components/reading/softSignup.ts` + its `__tests__/softSignupRibbon.test.mjs` (pure-policy template), `apps/app/components/choices/lockCoach.ts`, `apps/app/components/choices/ChoiceList.tsx` grep `choice.locked` ≈ :43/:65 (the locked-row contract)_
  - _Requirements: R1.3, R1.9_
  - _Prompt: Implement the task for spec reading-modes, first run spec-workflow-guide to get the workflow guide then implement the task: Role: TypeScript developer versed in pure, total functions. Task: create apps/app/components/reading/autoNarrator.ts with pickAutoChoice and the pacing constants exactly per design section 4 (Auto-narrator) and requirements R1.3/R1.9, mirroring softSignup.ts. Restrictions: pure and total — never throw, return null when every choice is locked; import nothing from React Native; the pick is deterministic under a seed; pacing lives as named constants in THIS module (R1.9). Success: vitest/.test.mjs green over the locked-filter, all-locked-null, seeded-determinism, and weighting matrix. Mark the task [-] in tasks.md when starting, log with log-implementation when done, then mark [x]._

## Agent RM-AUTO — owns `apps/app/hooks/useAutoNarrator.ts` (new) + its test + `apps/app/components/reading/ReaderScreen.tsx` (Wave-1 owner)

- [x] 1.2 `useAutoNarrator` hook + guarded advance effect (R1.1, R1.2, R1.4, R1.6, R1.7)
  Create `useAutoNarrator.ts`: session `autoOn` state defaulting OFF and
  resetting OFF when the reader closes the reader (R1.6 — session state ONLY,
  NEVER routed through `useReaderSettings`, which persists localStorage + syncs
  `mediaPrefs` to the server). The timed, guard-gated effect keyed on the
  settled scene id fires `submitChoice(pickAutoChoice(projection.choices))`
  after `AUTO_DELAY_MS` (reduced-motion-aware) through the EXISTING turn path
  (`submitChoice` from `useTurn`, grep `const submitChoice = useCallback` —
  `apps/app/hooks/useTurn.ts` ≈ :459) — the identical path a manual tap uses;
  NO new server function, NO schema, NO save field. The halt guards (R1.2):
  streaming in flight, `pendingChoiceId`, `projection.ending`,
  `chapterBoundary`, `showCandleGutter`, `freeformError`, and "every offered
  choice is locked" (`pickAutoChoice` returns `null`). Re-entrancy is safe with
  ZERO change to `useTurn`: `submitChoice` already self-guards
  `if (choice.locked || pendingChoiceId) return;` (grep at `useTurn.ts` ≈ :460)
  and clears `pendingChoiceId` in its `finally` (RM10, R1.4) — do NOT touch
  `useTurn`. Metering is automatic: each advance is one real
  `daily_turn_counter` turn; on budget rejection `useTurn` sets `freeformError`
  and auto halts (R1.7). Tests: re-entrancy no-op, halt-on-error,
  session-reset, and the guard truth-table (each guard individually blocks).
  - _Leverage: `apps/app/hooks/useTurn.ts` grep `const submitChoice = useCallback` ≈ :459 and its self-guard ≈ :460 (RM10 — the unchanged turn path), `apps/app/components/reading/autoNarrator.ts` (RM-POLICY's pure pick), design §2 R1 call-flow_
  - _Requirements: R1.1, R1.2, R1.4, R1.6, R1.7_
  - _Prompt: Implement the task for spec reading-modes, first run spec-workflow-guide to get the workflow guide then implement the task: Role: React Native hooks developer. Task: create apps/app/hooks/useAutoNarrator.ts per design section 2 (R1 call flow) and RM10. Restrictions: useTurn is RESERVED-BY-CONTRACT — do NOT edit it; autoOn is session state, NEVER routed through useReaderSettings (R1.6); every halt guard from R1.2 gates the effect; re-entrancy relies on submitChoice's existing self-guard (no new locking). Success: node/vitest covers re-entrancy no-op, halt-on-error, session reset, and each guard blocking individually. Mark [-] when starting, log-implementation when done, then [x]._

- [x] 1.3 Reader-chrome toggle + mount + chapter-boundary behavior (R1.5, R1.8)
  Mount `useAutoNarrator` in `ReaderScreen` (it already owns both sides of the
  turn — destructures `submitChoice`, `pendingChoiceId`, `freeformError`,
  `chapterBoundary`, `acknowledgeChapter` from `useTurn` ≈ :287-295 and derives
  `isTerminalView` ≈ :494 / `showCandleGutter` ≈ :502). Add the one-tap toggle
  affordance to the `ReaderSaveActions` pill row (grep `function
  ReaderSaveActions` — `ReaderScreen.tsx` ≈ :717), reachable on any page, so a
  manual choice tap OR the toggle reasserts control (R1.5; whether a manual tap
  also flips auto OFF is OQ8 — implement the design's chosen default and leave a
  one-line seam). At a chapter interstitial (`chapterBoundary` set, ChapterEnd
  replacing the layout at ≈ :596-601) auto SHALL pause OR auto-acknowledge via
  the existing `acknowledgeChapter` after a readable beat (OQ8 default), with
  reduced-motion shortening/removing the pause (R1.8). `ReaderScreen` stays the
  "thin shell" its own doc comment describes. Also pass the read-as-books
  handler to `EndingPanel` here (see RM-ENTRY's prop, task 1.5). Tests: toggle
  renders on every page-state; boundary behavior honors reduced-motion.
  - _Leverage: `apps/app/components/reading/ReaderScreen.tsx` grep `function ReaderSaveActions` ≈ :717 (pill row), `chapterBoundary` / `acknowledgeChapter` destructure ≈ :294-295, `const showCandleGutter` ≈ :502, ChapterEnd mount ≈ :596-601_
  - _Requirements: R1.5, R1.8_
  - _Prompt: Implement the task for spec reading-modes, first run spec-workflow-guide to get the workflow guide then implement the task: Role: React Native client developer on the reading surface. Task: mount useAutoNarrator and add the auto toggle to the ReaderSaveActions pill row per design section 4 (Auto-narrator), R1.5, R1.8. Restrictions: the flag stays ReaderScreen session state (never useReaderSettings — R1.6); reduced-motion shortens/removes the chapter pause; ReaderScreen stays the thin shell. Success: tests prove the toggle is reachable on any page and the chapter-boundary default honors reduced-motion; RM-ENTRY's onReadAsBook prop is wired to EndingPanel. Mark [-] when starting, log-implementation when done, then [x]._

## Agent RM-BOOK — owns `apps/app/hooks/useRunHistory.ts` (new), `apps/app/app/read/[saveId]/book/index.tsx` (new), `apps/app/app/read/[saveId]/history/index.tsx` (refactor to shared hook)

- [x] 1.4 Shared history hook + read-only book route (R2.1, R2.2, R2.3, R2.5, R2.6, R2.8, R2.9)
  Factor the archive route's fetch-state + `loadHistory` into a NEW shared hook
  `useRunHistory(accountId, saveId)` (R2.9) so the archive and book routes never
  diverge, and refactor `apps/app/app/read/[saveId]/history/index.tsx` to use
  it. Build the NEW read-only route `apps/app/app/read/[saveId]/book/index.tsx`
  over that hook, consuming the EXISTING `getRemoteRunHistory` wrapper (grep
  `export async function getRemoteRunHistory` — `apps/app/lib/gameApi.ts` ≈
  :475) → `game:getRunHistory` (owner-authed, entitlement-free, media-rich —
  RM9). Render each turn's prose continuously through the shared `ProseRenderer`
  atom (`apps/app/components/reading/ProseRenderer.tsx`) with book typography
  lifted from `Book.tsx` tokens, an optional inline still via `MediaPlate`, and
  NO rewind controls / NO "Turn N" / NO "You chose:" chrome. The route SHALL
  NEVER import the rewind mutation (`rewindRemoteSaveTurns`) — read-only by
  construction (RM9); enforce with an import-graph test assertion. Choice-free
  treatment: thin scene-break divider OR subtle italic "— you chose to …" from
  `turn.choice.choiceLabel` (OQ5 default). In-progress saves frame as "so far"
  (R2.6). The 200-turn cap (`RUN_HISTORY_MAX_TURNS`, grep — `game.ts` ≈ :780,
  with `hasMore`): lift for this view OR show "earlier chapters not shown" —
  never silent omission (OQ6, R2.8). Reading generates NOTHING and needs NO
  entitlement check (R2.5). Tests: shared-hook parity between the two routes,
  the never-imports-rewind assertion, in-progress "so far" framing, cap
  handling.
  - _Leverage: `apps/app/app/read/[saveId]/history/index.tsx` (the archive route — fetch-state + loadHistory to factor out), `apps/app/lib/gameApi.ts` grep `export async function getRemoteRunHistory` ≈ :475 + `RemoteRunHistoryTurn` ≈ :449 / `RemoteRunHistory` ≈ :466, `apps/app/components/reading/ProseRenderer.tsx`, `apps/app/components/reading/layouts/Book.tsx` (typography tokens — REFERENCE ONLY, not reusable), `convex/game.ts` grep `const RUN_HISTORY_MAX_TURNS` ≈ :780_
  - _Requirements: R2.1, R2.2, R2.3, R2.5, R2.6, R2.8, R2.9_
  - _Prompt: Implement the task for spec reading-modes, first run spec-workflow-guide to get the workflow guide then implement the task: Role: React Native client developer building a read-only surface. Task: factor useRunHistory out of the archive route and build the /read/[saveId]/book route over getRemoteRunHistory per design section 2 (R2) and RM9. Restrictions: getRunHistory is the ONLY read-back source (never the published-tale path — R2.2); the route NEVER imports rewindRemoteSaveTurns (read-only by construction — enforce with an import-graph test); no entitlement check, generates nothing (R2.5); in-progress saves say "so far" (R2.6); the 200-turn cap never silently omits the opening (R2.8). Success: tests cover shared-hook parity, the no-rewind assertion, framing, and cap handling; both routes render identically off the shared hook. Mark [-] when starting, log-implementation when done, then [x]._

## Agent RM-ENTRY — owns `apps/app/components/library/ContinueReading.tsx`, `apps/app/components/death/EndingPanel.tsx`

- [x] 1.5 Read-as-book entry points (R2.7)
  Add a "Read as book" affordance to finished-save rows in the library
  "Continue reading" surface (grep `ContinueReading` —
  `apps/app/components/library/ContinueReading.tsx`), navigating directly to
  `/read/[saveId]/book` via the router (a library surface, no ReaderScreen
  dependency). Add a "Read this tale as a book" action to `EndingPanel` (grep
  `EndingPanel` — `apps/app/components/death/EndingPanel.tsx`) as an OPTIONAL
  `onReadAsBook?` prop following its existing handler-passing convention —
  RM-AUTO wires the handler from `ReaderScreen` in task 1.3 (report the prop
  name to RM-AUTO). Both affordances self-hide when the target is unavailable.
  A trophy-crypt entry point is OPTIONAL and only if the crypt card carries the
  originating `saveId` — verify before relying on it, otherwise skip. Tests:
  the affordances render for finished saves and self-hide otherwise.
  - _Leverage: `apps/app/components/library/ContinueReading.tsx` (finished-save rows + router nav), `apps/app/components/death/EndingPanel.tsx` (handler-passing convention — mirror the existing optional-handler props)_
  - _Requirements: R2.7_
  - _Prompt: Implement the task for spec reading-modes, first run spec-workflow-guide to get the workflow guide then implement the task: Role: React Native client developer on the library + ending surfaces. Task: add the two read-as-book entry points per design section 4 (Read-as-books) and R2.7. Restrictions: ContinueReading navigates directly via router (no ReaderScreen coupling); EndingPanel takes an OPTIONAL onReadAsBook prop via conditional spread (never pass undefined — BC4) and report its name to RM-AUTO; the trophy-crypt entry is optional and only if the card carries saveId — verify first. Success: node/vitest proves the affordances show for finished saves and self-hide otherwise. Mark [-] when starting, log-implementation when done, then [x]._

## INTEGRATOR (Wave 1) — no reserved-file edits this wave; owns the merge gate + live verification

- [ ] 1.6 Wave-1 merge gate (R1, R2, NFR Reliability)
  Confirm Wave 1 introduced ZERO reserved-file edits, NO new Convex function,
  NO schema change, and NO save field (R1.1, R2.1 — the entire wave is client
  presentation over the existing turn path and `getRunHistory`). Run the merge
  gate: full monorepo typecheck + full test suite green, then dockerized deploy
  (`docker compose restart convex` — expected no-op for this wave — /
  `docker compose restart app`, BC8). Do NOT proceed to Wave 2 until green.
  - _Leverage: BC8 deploy flow, existing CI typecheck/test scripts_
  - _Requirements: R1, R2, NFR Reliability_
  - _Prompt: Implement the task for spec reading-modes, first run spec-workflow-guide to get the workflow guide then implement the task: Role: integrator running the wave gate. Task: verify no reserved-file / schema / Convex-function change landed in Wave 1, then run the full typecheck + suites and the dockerized deploy per BC8. Restrictions: nothing merges until typecheck + full suites are green; flag any reserved-file diff as a wave violation. Success: green typecheck + suites, healthy dockerized deploy. Mark [-] when starting, log-implementation when done, then [x]._

- [ ] 1.7 Wave-1 live verification on cyoa-local (R1, R2)
  On cyoa-local: (a) turn auto-narrator ON in a fresh llm save, confirm it
  auto-advances through several real streamed turns (each counts against the
  daily budget), halts at an ending / chapter boundary / guttered candle /
  budget exhaustion, and hands control back on a manual tap and on toggle-OFF
  (R1.2, R1.5, R1.7). (b) Open a finished save's "Read as book" from
  ContinueReading and from the EndingPanel, confirm continuous prose with the
  chosen choice-free treatment, inline stills where present, NO rewind chrome,
  and correct "so far" framing on an in-progress save (R2.3, R2.6, R2.7).
  Confirm the book view generates nothing (no Imagen/Veo/TTS, no ledger writes,
  no daily counter — R2.5). Record in the implementation log whether auto-earned
  turns mint keepsakes/mementos identically to manual turns (OQ3 confirmation).
  - _Leverage: BC8 deploy flow, operator dashboard / analytics_events queries_
  - _Requirements: R1.2, R1.5, R1.7, R2.3, R2.5, R2.6, R2.7_
  - _Prompt: Implement the task for spec reading-modes, first run spec-workflow-guide to get the workflow guide then implement the task: Role: release verifier. Task: drive the auto-narrator and read-as-books loops end to end on the dockerized cyoa-local env. Restrictions: verify through real streamed play; do not ship if auto fails to halt on any guard or if the book view triggers any generation/ledger write (R2.5). Success: documented run covering all halt guards, both book entry points, the free/no-generation check, and the OQ3 keepsake-parity observation in the implementation log. Mark [-] when starting, log-implementation when done, then [x]._

---

# WAVE 2 — Illustrated Book (R3)

Reserved edits are integrator-owned: `convex/schema.ts` (ONE additive
`illustrated_book` `cinematicMode` literal — ONLY if OQ7 resolves to the
distinct-strategy option) and `convex/game.ts` (thread the guaranteed-still
context to the `queueSceneImage` call site in `completeSceneStream`). The
still is ALREADY produced under every Pro strategy (RM8) — no new queue site;
only the MODE-SCOPED credit-exhaustion fallback is new.

## Agent RM-MEDIA — owns `convex/media/sceneMedia.ts`, `convex/media/mediaStrategy.ts`, `convex/account.ts` (CinematicMode half), media tests

- [x] 2.1 Mode-scoped still-guarantee fallback + strategy plumbing (R3.3, R3.4, R3.5, R3.9, RM6, RM8)
  In `queueSceneImage` (grep `export const queueSceneImage` —
  `convex/media/sceneMedia.ts` ≈ :266) add a MODE-SCOPED fallback on
  `chargeMediaSpend` failure: today it `ctx.db.delete(assetId)` and returns
  `{ queued: false, reason }` (grep `ctx.db.delete(assetId)` ≈ :382) — for the
  guaranteed-still mode ONLY, keep a lightweight placeholder asset AND/OR emit
  an `outOfCredits` signal on the `getSceneMedia` projection (grep
  `export const getSceneMedia` ≈ :1395) instead of the silent delete. For every
  OTHER reader the existing delete-and-skeleton behavior SHALL be
  byte-identical (regression-pin this). The placeholder SHALL NOT be metered or
  Pro-gated — model it like the NPC/anchor portraits `chargeMediaSpend` never
  bills (R3.5), else exhaustion cascades. Resolve OQ7: if a distinct
  `illustrated_book` `MediaStrategy` value is chosen, extend the `MediaStrategy`
  union (grep `export type MediaStrategy` — `mediaStrategy.ts` ≈ :31) +
  `computeMediaStrategy` (grep `export function computeMediaStrategy` ≈ :48) +
  the SECOND `CinematicMode` definition (grep `export type CinematicMode` —
  `convex/account.ts` ≈ :13) consumed by `resolveMediaPrefs` (≈ :127) — the two
  `CinematicMode` unions move in LOCKSTEP with RM-LAYOUT's client-side union
  (RM6; report the literal to RM-LAYOUT and the integrator). The still already
  fires under every Pro strategy, so add NO new queue site in `game.ts` (RM8).
  Tests: fallback keeps a placeholder / emits the signal and does NOT bill for
  the guaranteed-still mode; every other mode still deletes and holds at
  skeleton (byte-identical); `computeMediaStrategy` matrix if the strategy value
  is added.
  - _Leverage: `convex/media/sceneMedia.ts` grep `export const queueSceneImage` ≈ :266, the exhaustion path grep `ctx.db.delete(assetId)` ≈ :382 (returns `insufficient_sparks`), grep `export const getSceneMedia` ≈ :1395 (projection to widen), `convex/media/mediaStrategy.ts` grep `computeMediaStrategy` ≈ :48 + `MediaStrategy` ≈ :31, `convex/account.ts` grep `export type CinematicMode` ≈ :13 + `resolveMediaPrefs` ≈ :127_
  - _Requirements: R3.3, R3.4, R3.5, R3.9, RM6, RM8_
  - _Prompt: Implement the task for spec reading-modes, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Convex media backend developer. Task: add the mode-scoped still-guarantee fallback to queueSceneImage and, if OQ7 picks it, the distinct illustrated_book strategy value, per design section 2 (R3 flow) and RM8/RM6. Restrictions: the fallback is MODE-SCOPED — every non-guaranteed reader keeps byte-identical delete-and-skeleton (regression test mandatory); the placeholder is never metered or Pro-gated (R3.5); add NO new queue site (RM8); if a strategy value is added, both CinematicMode unions + MediaStrategy + computeMediaStrategy + the schema literal move in lockstep (RM6 — report to RM-LAYOUT and integrator). Success: fake-ctx tests cover the guaranteed-still placeholder/signal path, the byte-identical other-mode regression, and the strategy matrix. Mark [-] when starting, log-implementation when done, then [x]._

## Agent RM-LAYOUT — owns `apps/app/components/reading/layouts/IllustratedBook.tsx` (new), `apps/app/components/reading/layouts/index.ts`, `apps/app/hooks/useReaderSettings.ts`, `apps/app/components/media/MediaPlate.tsx`

- [x] 2.2 Illustrated Book layout + registration + placeholder plate (R3.1, R3.2, R3.4, R3.6, RM6)
  Create `IllustratedBook.tsx` cloned from `GraphicNovelLayout` (grep
  `export function GraphicNovelLayout` — `layouts/GraphicNovel.tsx` ≈ :30, which
  already wires `SceneMedia` + `ProseRenderer` + `ChoiceList` + endings/HUD/
  freeform), re-weighted image-first: full-bleed plate on top, prose beneath,
  `ChoiceList` as quiet footnotes — consuming the IDENTICAL `ReaderLayoutProps`
  so the turn pipeline never forks (R3.2). Register it: add `illustratedBook` to
  the `ReaderLayoutVariant` union + `READER_LAYOUT_VARIANTS` array +
  `isLayoutVariant` guard (all in `useReaderSettings.ts` — grep
  `export type ReaderLayoutVariant` ≈ :31, `READER_LAYOUT_VARIANTS` ≈ :38,
  `isLayoutVariant` ≈ :213) and the `READER_LAYOUTS` record (grep
  `export const READER_LAYOUTS` — `layouts/index.ts` ≈ :18). If OQ7 adds the
  distinct strategy, add the matching `illustrated_book` literal to the
  CLIENT `CinematicMode` union + `CINEMATIC_MODES` + `isCinematicMode`
  (`useReaderSettings.ts` grep `export type CinematicMode` ≈ :18) in LOCKSTEP
  with RM-MEDIA's server union (RM6). Give `MediaPlate` (grep `MediaPlate` —
  `apps/app/components/media/MediaPlate.tsx`) a mode-aware `placeholder`
  treatment: stylized frame + prose + a soft "out of illustration credits — top
  up" nudge, NEVER a bare skeleton and NEVER a blocked turn (R3.4/R3.6);
  driven by RM-MEDIA's `outOfCredits` signal. Prose stays readable while the
  plate is a placeholder/skeleton (R3.6). Tests: the layout consumes the
  identical `ReaderLayoutProps`; `MediaPlate` renders the placeholder on the
  out-of-credits signal and never a bare skeleton in this mode.
  - _Leverage: `apps/app/components/reading/layouts/GraphicNovel.tsx` grep `export function GraphicNovelLayout` ≈ :30 (clone base — imports ChoiceList/SceneMedia/ProseRenderer at :3/:7/:15), `apps/app/components/reading/layouts/index.ts` grep `export const READER_LAYOUTS` ≈ :18, `apps/app/hooks/useReaderSettings.ts` grep `export type ReaderLayoutVariant` ≈ :31 / `isLayoutVariant` ≈ :213, `apps/app/components/media/MediaPlate.tsx`_
  - _Requirements: R3.1, R3.2, R3.4, R3.6, RM6_
  - _Prompt: Implement the task for spec reading-modes, first run spec-workflow-guide to get the workflow guide then implement the task: Role: React Native client developer on the reading layouts. Task: clone IllustratedBook from GraphicNovelLayout, register it across the ReaderLayoutVariant union + READER_LAYOUTS, and add the mode-aware MediaPlate placeholder per design section 4 (Illustrated Book) and R3.2/R3.4/R3.6. Restrictions: consume the IDENTICAL ReaderLayoutProps so the pipeline never forks (R3.2); prose stays readable over a placeholder — the turn never blocks on media (R3.6); the placeholder is never a bare skeleton in this mode; if OQ7 adds a strategy value, the client CinematicMode union moves in lockstep with RM-MEDIA (RM6). Success: tests prove identical-props consumption and the placeholder treatment on the out-of-credits signal. Mark [-] when starting, log-implementation when done, then [x]._

## Agent RM-PICKER — owns `apps/app/app/settings/index.tsx` (cinematicMode group), `apps/app/components/reading/ReaderSettingsDrawer.tsx` (Reading layout group)

- [x] 2.3 Pro-gating + layout↔strategy coupling in BOTH pickers (R3.7, R3.8, RM7)
  Pro-gate the Illustrated Book option in BOTH pickers — the settings
  `cinematicMode` group (grep `cinematicMode` — `apps/app/app/settings/index.tsx`
  ≈ :234) and the in-reader "Reading layout" group (grep `Reading layout` —
  `apps/app/components/reading/ReaderSettingsDrawer.tsx` ≈ :169): a non-Pro
  reader sees it LOCKED → paywall (or a sample), never selectable into a
  permanent skeleton (R3.7). The dev unlock (`CYOA_DEV_FORCE_PRO_MEDIA` /
  `devForceProMedia`) SHALL still preview the full mode. Enforce the coupling
  (RM7, R3.8): selecting Illustrated Book SHALL set `layout = illustratedBook`
  AND force images-ON + a stills-guaranteeing strategy (the reuse `stills_only`
  or the distinct `illustrated_book` per OQ7) TOGETHER via `updateSettings`
  (which round-trips `mediaPrefs` to the server) — because `layout` is
  client-only localStorage while the still-producing `cinematicMode`
  round-trips, the two selections MUST stay in sync in BOTH pickers, or the
  reader gets a full-bleed plate that never fills. Tests: both pickers Pro-gate
  the option; selecting it in either picker sets layout AND strategy together;
  non-Pro routes to paywall; devForceProMedia previews.
  - _Leverage: `apps/app/app/settings/index.tsx` grep `cinematicMode` ≈ :234 (the cinematicMode selector + updateSettings), `apps/app/components/reading/ReaderSettingsDrawer.tsx` grep `Reading layout` ≈ :169 (the layout group), the existing Pro-gate / paywall + devForceProMedia patterns_
  - _Requirements: R3.7, R3.8, RM7_
  - _Prompt: Implement the task for spec reading-modes, first run spec-workflow-guide to get the workflow guide then implement the task: Role: React Native client developer on the settings surfaces. Task: Pro-gate Illustrated Book in both pickers and enforce the layout↔strategy coupling per design section 4 (Illustrated Book) and RM7/R3.8. Restrictions: a non-Pro reader can NEVER select into a permanent skeleton — locked → paywall (R3.7); devForceProMedia still previews; selecting the mode sets layout AND a stills-guaranteeing strategy together in BOTH pickers (RM7) so the two axes never desync. Success: tests cover Pro-gating in both pickers, the coupled selection, the paywall route, and the dev preview. Mark [-] when starting, log-implementation when done, then [x]._

## INTEGRATOR (Wave 2) — owns reserved files (`convex/schema.ts`, `convex/index.ts`, `convex/game.ts`)

- [x] 2.4 Reserved wiring + Wave-2 merge gate (R3.3, R3.8, R5.6, RM8, BC7)
  If OQ7 chose the distinct strategy, add the ONE additive
  `v.literal("illustrated_book")` to the `saves.mediaPrefs.cinematicMode` union
  (grep `cinematicMode: v.optional` — `convex/schema.ts` ≈ :41), additive and
  back-compat (absence unchanged); if the reuse-`stills_only` path was chosen,
  `schema.ts` needs NOTHING for R3. In `completeSceneStream` (grep
  `export const completeSceneStream` — `convex/game.ts` ≈ :1896), thread the
  guaranteed-still context (the resolved strategy / mode flag) into the EXISTING
  `queueSceneImage` call so RM-MEDIA's mode-scoped fallback fires only for
  Illustrated Book — add NO new queue site (RM8). `convex/index.ts` and
  `convex/crons.ts` need NO change (media/game functions register by path; no
  new cron). Then the merge gate: full monorepo typecheck + all suites +
  dockerized deploy (`docker compose restart convex` / `restart app`, BC8). Do
  NOT proceed to Wave 3 until green.
  - _Leverage: `convex/schema.ts` grep `cinematicMode: v.optional` ≈ :41 (the additive literal site), `convex/game.ts` grep `export const completeSceneStream` ≈ :1896 (the existing queueSceneImage call site to thread), BC8 deploy flow_
  - _Requirements: R3.3, R3.8, R5.6, RM8_
  - _Prompt: Implement the task for spec reading-modes, first run spec-workflow-guide to get the workflow guide then implement the task: Role: integrator with sole ownership of reserved files and game.ts. Task: land the additive cinematicMode literal (only if OQ7 chose it) and thread the guaranteed-still context into the existing queueSceneImage call in completeSceneStream per design section 2 (R3) and RM8. Restrictions: additive-only to reserved files; add NO new queue site (RM8); the schema literal absence must stay the legacy default; index.ts/crons.ts unchanged; nothing merges until typecheck + full suites green. Success: dockerized deploy healthy, typecheck + suites green. Mark [-] when starting, log-implementation when done, then [x]._

- [ ] 2.5 Wave-2 live verification on cyoa-local (R3)
  On cyoa-local with a Pro (or `devForceProMedia`) account: select Illustrated
  Book in each picker, confirm the coupling sets the image-first skin AND a
  stills-guaranteeing strategy together (never a bare full-bleed skeleton —
  R3.8), play several streamed turns and confirm a guaranteed still per scene
  with prose readable while the plate fills (R3.6). Force credit exhaustion and
  confirm the plate degrades to the stylized placeholder + top-up nudge with the
  turn still advancing, NEVER a permanent bare skeleton and NEVER a blocked turn
  (R3.4). Confirm a non-Pro account sees the option locked → paywall (R3.7) and
  that EVERY non-Illustrated reader still gets the byte-identical
  delete-and-skeleton on exhaustion (RM8 regression, spot-check).
  - _Leverage: BC8 deploy flow, `CYOA_DEV_FORCE_PRO_MEDIA` / `devForceProMedia` unlock, operator media/credit dashboards_
  - _Requirements: R3.4, R3.6, R3.7, R3.8, RM8_
  - _Prompt: Implement the task for spec reading-modes, first run spec-workflow-guide to get the workflow guide then implement the task: Role: release verifier. Task: drive the Illustrated Book loop end to end on the dockerized cyoa-local env, including forced credit exhaustion. Restrictions: verify through real streamed play; do not ship if the plate ever holds at a permanent bare skeleton, if a turn blocks on media, or if a non-Illustrated reader's exhaustion behavior changed (RM8). Success: documented run covering the coupled selection, guaranteed still, exhaustion-placeholder, non-Pro paywall, and the other-mode byte-identical spot-check. Mark [-] when starting, log-implementation when done, then [x]._

---

# WAVE 3 — Novel mode (R4), the contract-moving wave

The only mode that moves the branching contract. Reserved edits
(integrator-owned): `convex/schema.ts` (the OPTIONAL `readingMode` field) and
`convex/game.ts` (the `createSave` persist, the `getAuthorizedSceneStreamRequest`
threading + `sceneLength:"chapter"`, and the `completeSceneStream` FOUR
in-mutation parse sites + the synthetic `turn-page` stamp). All server novel
work lives ONLY at the two live sites — NEVER the dead
`runLlmDrivenSubmitChoice` (RM1). The engine schema is varied ADDITIVELY (RM2).

## Agent RM-ENGINE — owns `packages/engine/src/llm.ts` + engine tests

- [x] 3.1 Additive novel schema, selector, resolver, cursor proof (R4.3, R4.4, R4.9, RM2, RM5)
  Add the ADDITIVE `llmNovelSceneOutputSchema` — identical to
  `llmSceneOutputSchema` (grep `export const llmSceneOutputSchema` —
  `packages/engine/src/llm.ts` ≈ :336) EXCEPT `choices:
  z.array(llmChoiceSchema).min(0).max(1)` (all other fields — prose / terminal /
  beatFired / twistFired / visualDescription — identical) and its
  `LlmNovelSceneProposal` type. LEAVE the existing schema (min
  `MIN_CHOICES = 2`, grep `const MIN_CHOICES` ≈ :64) BYTE-IDENTICAL (RM2 — do
  NOT touch `responseSchema.ts`). Add the tiny `sceneSchemaFor(readingMode)`
  selector (the ONLY place the mode→schema mapping lives, design §1.3). Add the
  pure `resolveReadingMode({ desired, isPro })` mirroring `computeMediaStrategy`
  (RM5, R4.9 seam): desired absent ⇒ `"branching"`; under posture A degrade
  `novel → branching` for non-Pro at create only. Prove `advanceLlmTurnCursor`
  (grep `export function advanceLlmTurnCursor` ≈ :524) resolves a synthetic
  `turn-page` choiceId against the prior proposal (≈ :569, applying its empty
  effects) AND the `freeform:true` no-lookup branch (≈ :588) — BOTH avoid
  `llm_choice_not_found` (grep ≈ :571). Tests (table-driven, BC6): novel schema
  accepts 0/1 choices and rejects 2+ where branching accepts them; the
  `llmSceneOutputSchema` matrix UNCHANGED (regression pin proving the additive
  sibling didn't perturb branching); `sceneSchemaFor` mapping; both cursor paths
  resolving `turn-page`; `resolveReadingMode` (absent⇒branching, non-Pro degrade
  posture A, isPro passthrough).
  - _Leverage: `packages/engine/src/llm.ts` grep `export const llmSceneOutputSchema` ≈ :336 (+ `choices: z.array(llmChoiceSchema).min` ≈ :339), `const MIN_CHOICES` ≈ :64, `export function advanceLlmTurnCursor` ≈ :524 (proposal-lookup ≈ :569 + freeform branch ≈ :588 + throw ≈ :571), `convex/media/mediaStrategy.ts` `computeMediaStrategy` (resolver shape to mirror), existing engine tests_
  - _Requirements: R4.3, R4.4, R4.9, RM2, RM5_
  - _Prompt: Implement the task for spec reading-modes, first run spec-workflow-guide to get the workflow guide then implement the task: Role: TypeScript engine developer versed in pure, total functions. Task: add llmNovelSceneOutputSchema, sceneSchemaFor, and resolveReadingMode to packages/engine/src/llm.ts per design section 1.3/1.4 and RM2/RM5, and pin advanceLlmTurnCursor's turn-page handling. Restrictions: the novel schema is ADDITIVE — llmSceneOutputSchema.min(2) stays byte-identical (RM2); never touch responseSchema.ts (Non-Goal); resolveReadingMode mirrors computeMediaStrategy's pure shape (RM5), posture A degrades only at create. Success: table-driven vitest covers the novel-schema 0/1 accept + 2+ reject, the branching regression pin, sceneSchemaFor, both cursor paths avoiding llm_choice_not_found, and resolveReadingMode. Mark the task [-] when starting, log-implementation when done, then [x]._

## Agent RM-PROMPT — owns `convex/llm/prompts/scene.ts`, `convex/llm/types.ts`, `convex/llm/parse.ts` (the live `parseSceneOutput` SSE gate), `convex/llm/router.ts` (threads `readingMode` into `parseSceneOutput`)

- [x] 3.2 Novel prompt variant + request widening + SSE parse selection (R4.5, R4.7, RM3 SSE site)
  Widen `SceneGenerationRequest` (grep `export type SceneGenerationRequest` —
  `convex/llm/types.ts` ≈ :127) and `sceneGenerationRequestSchema` (grep ≈ :223)
  with the OPTIONAL `readingMode?: "branching" | "novel"` (absent ⇒ branching,
  deploy-skew safe both ways, threaded exactly like the existing `mode` field).
  Branch `buildLlmDrivenPrompt` (grep `function buildLlmDrivenPrompt` —
  `convex/llm/prompts/scene.ts` ≈ :409) on `request.readingMode === "novel"`:
  DROP the "choices is an array of 2 to 4 entries" rule (grep `choices is an
  array of 2 to 4` ≈ :515), the CHOICE DIVERGENCE rule (grep `CHOICE DIVERGENCE`
  ≈ :523), and the arc-save choice-consequence / gated-choice rules; emit a
  prose+terminal-only output shape; use chapter-length prose. KEEP terminal
  handling, anti-repetition, continuity, `visualDescription`, and the
  arc/pursuit spine (a linear read is IMPROVED by the arc driving one dramatic
  question to one climax — R4.5). At the LIVE SSE gate `parseSceneOutput` (grep
  `export function parseSceneOutput` — `convex/llm/parse.ts` ≈ :113, its
  `llmSceneOutputSchema.safeParse` ≈ :121 — the FIFTH parse site, which ALSO
  gates the SSE stream), thread a `readingMode` param and select
  `sceneSchemaFor(readingMode)` so a valid 0/1-choice novel payload is not
  rejected (falling through to `authoredSceneSchema` → null proposal →
  `completeSceneStream` throws) before it is ever seen (RM3). Pass the mode in
  from `LlmRouter.generateScene` (grep `async generateScene` —
  `convex/llm/router.ts` ≈ :72; parse call ≈ :91 and the deterministic-fallback
  call ≈ :143) via `request.readingMode`. Do NOT touch the test-only dead
  `parseLlmDrivenScene` (≈ :242, RM3). The novel branch lives INSIDE the
  existing `mode === "llm-driven"` guard (grep `request.mode === "llm-driven"`
  ≈ :391) — authored/scripted stories never see it (R4.7). Tests: novel prompt
  drops the three rules and keeps the spine; the request schema tolerates
  absent `readingMode`; `parseSceneOutput` accepts a 0/1 novel payload under
  novel mode and still rejects it (yielding an authored/no-proposal result)
  under branching.
  - _Leverage: `convex/llm/types.ts` grep `export type SceneGenerationRequest` ≈ :127 + `sceneGenerationRequestSchema` ≈ :223 (thread like the existing `mode` field), `convex/llm/prompts/scene.ts` grep `function buildLlmDrivenPrompt` ≈ :409 + `choices is an array of 2 to 4` ≈ :515 + `CHOICE DIVERGENCE` ≈ :523 + the `mode === "llm-driven"` guard ≈ :391, `convex/llm/parse.ts` grep `export function parseSceneOutput` ≈ :113 + its `llmSceneOutputSchema.safeParse` ≈ :121, `convex/llm/router.ts` grep `async generateScene` ≈ :72 + `parseSceneOutput(` ≈ :91/:143_
  - _Requirements: R4.5, R4.7, RM3_
  - _Prompt: Implement the task for spec reading-modes, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Convex LLM-prompt developer. Task: widen SceneGenerationRequest with optional readingMode, branch buildLlmDrivenPrompt for novel, and select the novel schema at the LIVE SSE gate parseSceneOutput (parse.ts), threading readingMode in from LlmRouter.generateScene (router.ts) per design section 2 (R4 flow) and RM3. Restrictions: readingMode is an OPTIONAL widening (absent ⇒ branching, deploy-skew safe); target parseSceneOutput, NOT the test-only dead parseLlmDrivenScene (RM3); the novel branch drops ONLY the choice-count/divergence/gated rules and KEEPS the terminal + arc/pursuit spine (R4.5); the branch lives inside the llm-driven guard so authored stories never take it (R4.7); do NOT touch responseSchema.ts (RM2). Success: tests cover the dropped-rules prompt, absent-readingMode tolerance, and parseSceneOutput accepting the novel payload only under novel mode. Mark [-] when starting, log-implementation when done, then [x]._

## Agent RM-PROJECT — owns `convex/saves.ts` (projection) + `apps/app/lib/gameApi.ts` (the `RemoteScene` type, imported by useTurn) + projection spoiler test

- [x] 3.3 Carry `readingMode` to the client (R4.6, wire shapes)
  Widen `projectLlmDrivenScene` (grep `export function projectLlmDrivenScene` —
  `convex/saves.ts` ≈ :592) to carry `readingMode` to the client via
  conditional spread so a Novel layout can render the page-turn affordance:
  `...(save.readingMode === "novel" ? { readingMode: "novel" as const } : {})`.
  This is a reader-known fact (they chose novel at create) — BC10-clean, no
  spoiler. Mirror it as an OPTIONAL field on the `RemoteScene` type where it is
  DEFINED — `apps/app/lib/gameApi.ts` (grep `type RemoteScene` ≈ :185;
  `useTurn.ts` only imports it at :31 and needs no type edit) — a type-only
  mirror; `useTurn` stays structurally UNCHANGED (RM10/R4.6). Extend the BC10 projection
  spoiler test: `readingMode` present on novel saves, absent otherwise, and no
  other new keys leak. Tests: projection carries the field only for novel saves;
  spoiler test green.
  - _Leverage: `convex/saves.ts` grep `export function projectLlmDrivenScene` ≈ :592 (the conditional-spread projection choke point), `apps/app/lib/gameApi.ts` grep `type RemoteScene` ≈ :185 (the type to mirror; useTurn.ts imports it at :31), existing BC10 projection spoiler tests_
  - _Requirements: R4.6_
  - _Prompt: Implement the task for spec reading-modes, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Convex read-path developer with spoiler discipline. Task: carry readingMode through projectLlmDrivenScene via conditional spread and mirror it as an optional RemoteScene field per design section 3 (wire shapes) and R4.6. Restrictions: conditional spread — never pass undefined (BC4); the field is present ONLY on novel saves (BC10 spoiler test mandatory); useTurn stays structurally unchanged — a type-only mirror (RM10). Success: tests prove the field is carried only for novel saves and no other key leaks; the BC10 spoiler test is extended and green. Mark [-] when starting, log-implementation when done, then [x]._

## Agent RM-NOVEL-UI — owns the Novel page-turn affordance under `apps/app/components/reading/layouts/` + its ReaderScreen wiring (Wave-3 owner of `ReaderScreen.tsx`)

- [x] 3.4 "Turn the page" affordance from the projected `readingMode` (R4.6)
  Build the Novel reading affordance (a new component under
  `apps/app/components/reading/layouts/`, or a projection-driven branch in the
  existing layouts) that renders the single server-provided `turn-page` choice
  as a swipe/tap "Turn the page" instead of a `ChoiceList` button row, reading
  `readingMode` off the projection (RM-PROJECT's field). Distinct from the five
  cosmetic skins because the AFFORDANCE changes, not just the paint. It submits
  the server-provided `turn-page` id through the UNCHANGED `submitChoice`
  streaming/persist path (RM10/R4.6 — no `useTurn` change). Wire it into
  `ReaderScreen`'s layout dispatch (grep `const Layout = READER_LAYOUTS` —
  `ReaderScreen.tsx` ≈ :468) so a novel save renders the page-turn instead of
  the choice row. Tests: the Novel layout renders exactly ONE page-turn
  affordance from the projected `readingMode` and submits the `turn-page` id
  unchanged; a branching save renders the normal choice row.
  - _Leverage: `apps/app/components/reading/layouts/GraphicNovel.tsx` (layout structure + ChoiceList mount ≈ :206 to replace with the page-turn), `apps/app/components/reading/ReaderScreen.tsx` grep `const Layout = READER_LAYOUTS` ≈ :468 (dispatch), `apps/app/hooks/useTurn.ts` `submitChoice` (unchanged path)_
  - _Requirements: R4.6_
  - _Prompt: Implement the task for spec reading-modes, first run spec-workflow-guide to get the workflow guide then implement the task: Role: React Native client developer on the reading surface. Task: build the Novel "Turn the page" affordance driven by the projected readingMode per design section 4 (Novel page-turn) and R4.6. Restrictions: read readingMode off the projection (never a sixth layout skin — the AFFORDANCE changes); submit the server-provided turn-page id through the UNCHANGED submitChoice path (RM10 — do not edit useTurn); a branching save is byte-identical. Success: tests prove one page-turn affordance for novel saves submitting turn-page unchanged, and the normal choice row for branching. Mark [-] when starting, log-implementation when done, then [x]._

## INTEGRATOR (Wave 3) — owns reserved files (`convex/schema.ts`, `convex/index.ts`, `convex/game.ts`)

- [x] 3.5 Schema field + create gate + stream threading + five-site selection + synthetic stamp (R4.1, R4.2, R4.4, R4.9, RM1, RM3, RM4, BC7)
  Add the OPTIONAL `readingMode` field to the `saves` table near
  `keepsakeCarried` (grep `keepsakeCarried: v.optional` — `convex/schema.ts` ≈
  :152): `readingMode: v.optional(v.union(v.literal("branching"),
  v.literal("novel")))` — optional so every legacy save resolves to
  "branching," no index (RM4). In `createSave` (grep `export const createSave` —
  `convex/game.ts` ≈ :216) persist `readingMode = resolveReadingMode({ desired,
  isPro })` via `cleanDoc` (RM5, R4.9 posture A — gate here, keep for the save's
  lifetime; the founder's OQ1/OQ9 gate is then a one-line change). In
  `getAuthorizedSceneStreamRequest` (grep
  `export const getAuthorizedSceneStreamRequest` ≈ :1742), llm-driven branch
  only (R4.7): when `save.readingMode === "novel"` add `readingMode:"novel"` to
  the `SceneGenerationRequest` and force `sceneLength = "chapter"` (grep
  `sceneLength` at the request-build site ≈ :1851). In `completeSceneStream`
  (grep `export const completeSceneStream` ≈ :1896) select
  `sceneSchemaFor(save.readingMode)` at ALL FOUR in-mutation
  `llmSceneOutputSchema.safeParse` sites — the classifier (≈ :1979), the MAIN
  throw-site (≈ :2034, the load-bearing gate), the visual-prompt parse (≈
  :2424), and the NPC-mention parse (≈ :2492) — miss any and a valid novel
  payload degrades or is rejected (RM3). After validation STAMP the synthetic
  `{ id: "turn-page", label: "Turn the page" }` (no effects) into BOTH
  `proposal.choices` AND the persisted `choiceViews` (R4.2/R4.4) so the next
  turn's `advanceLlmTurnCursor` resolves `turn-page` cleanly; suppress the
  "Turn the page" `choiceLabel` from the memory/summarizer beat (lean on prose
  continuity). NEVER wire the dead `runLlmDrivenSubmitChoice` (grep
  `@deprecated DEAD CODE` ≈ :4422 — RM1). `convex/index.ts` / `convex/crons.ts`
  unchanged. Then the merge gate: full monorepo typecheck + all suites +
  dockerized deploy (BC8).
  - _Leverage: `convex/schema.ts` grep `keepsakeCarried: v.optional` ≈ :152 (the field site), `convex/game.ts` grep `export const createSave` ≈ :216, `export const getAuthorizedSceneStreamRequest` ≈ :1742 (+ `sceneLength` ≈ :1851), `export const completeSceneStream` ≈ :1896 (the four `llmSceneOutputSchema.safeParse` sites ≈ :1979/:2034/:2424/:2492), `runLlmDrivenBeginStreaming` ≈ :4253 (live path, for reference), the dead `@deprecated DEAD CODE` ≈ :4422 (do NOT wire)_
  - _Requirements: R4.1, R4.2, R4.4, R4.9, RM1, RM3, RM4_
  - _Prompt: Implement the task for spec reading-modes, first run spec-workflow-guide to get the workflow guide then implement the task: Role: integrator with sole ownership of reserved files and game.ts. Task: land the optional readingMode schema field, the createSave gate, the stream-request threading + sceneLength:"chapter", the FOUR in-mutation parse-site selections, and the synthetic turn-page stamp per design sections 1, 2, and 3 and RM1/RM3/RM4. Restrictions: additive-only to reserved files; select sceneSchemaFor at ALL four in-mutation sites plus rely on RM-PROMPT's fifth site — the live SSE gate parseSceneOutput, NOT the dead parseLlmDrivenScene (RM3 — miss one and novel breaks); stamp turn-page into BOTH proposal.choices AND choiceViews to avoid llm_choice_not_found (R4.4); NEVER wire the dead runLlmDrivenSubmitChoice (RM1); index.ts/crons.ts unchanged; nothing merges until typecheck + full suites green. Success: fake-ctx tests through completeSceneStream (novel validates at the throw-site + four sites, turn-page stamped both places, memory beat suppressed, branching unchanged); dockerized deploy healthy. Mark [-] when starting, log-implementation when done, then [x]._

- [ ] 3.6 Wave-3 live verification on cyoa-local (R4)
  On cyoa-local: create a NOVEL llm save (verify `readingMode:"novel"` persisted
  and the create gate under posture A). Play several turns and confirm each
  scene is chapter-length prose ending in ONE "Turn the page" affordance (no
  branching choices — R4.2), that the page-turn advances cleanly with NO
  `llm_choice_not_found` (R4.4), and that a terminal yields ONE ending with the
  keepsake loop intact (R4.8). Confirm a BRANCHING save (and a legacy save with
  no `readingMode`) renders byte-identical to today — the min(2) gate intact
  (R4.3, R5.3) — and that an authored/scripted save never takes the novel path
  (R4.7). Confirm `saves.mode` (story/hardcore) stays orthogonal — a novel save
  can still be either (R4.7). Record replay-regenerates-a-different-linear-book
  and the per-turn token-cost observation (OQ2) in the implementation log.
  - _Leverage: BC8 deploy flow, operator dashboard / analytics_events queries, the OQ1/OQ2/OQ9 founder-decision notes_
  - _Requirements: R4.2, R4.3, R4.4, R4.7, R4.8, R5.3_
  - _Prompt: Implement the task for spec reading-modes, first run spec-workflow-guide to get the workflow guide then implement the task: Role: release verifier. Task: drive the novel-mode loop end to end on the dockerized cyoa-local env. Restrictions: verify through real streamed play; do not ship if a page-turn ever throws llm_choice_not_found (R4.4), if a branching/legacy/authored save deviates from today (R4.3/R4.7/R5.3), or if a novel turn surfaces a raw error to the reader. Success: documented run covering novel create-persist, chapter prose + single page-turn, clean advance, one-ending terminal, branching/legacy byte-identical, authored-never-novel, and the OQ2 token-cost observation in the implementation log. Mark [-] when starting, log-implementation when done, then [x]._

---

## R6 — PARKED (do NOT build)

No task. The true graphic-novel / comic mode (R6, design §5) is a deliberate
deferral: multi-image pages explode generation cost, it demands panel-scripting
the LLM path does not produce, and it needs stricter cross-panel character
consistency than the still pipeline guarantees. Revisit ONLY after the Omni
cinematics direction settles AND only IF Illustrated Book (R3) proves demand
for image-first reading. No schema/prompt/media work is spent toward it in this
spec.
