# Tasks — Reader Chrome Declutter

Execution: THREE SEQUENCED WAVES. The UX/PM review (docs/reviews/
2026-07-20-ui-declutter-ux-pm-review.md) reordered them: the CHROME wave
ships first (the user-visible win — PM P1); the settings unification wave
follows (file-disjoint from Wave 1 — verified: Wave 1 owns `chrome/*` +
`ReaderScreen.tsx`; Wave 2 owns `settings/index.tsx` + the drawer +
`lib/readerSettingsGroups.ts`). Parallel agents with disjoint file
ownership per wave; no reserved convex files are involved, so the
integrator role is the merge-gate runner. Every agent MUST read
`design.md` §0 (RC1–RC11) before its first edit. Merge gate per wave: full
monorepo typecheck + `pnpm --filter @cyoa/app test` green + touched vitest
files green, then `docker compose restart app` (RC8) and a live check at
BOTH 375px and ≥1280px on cyoa-local (R7).

Conventions: client-only (no convex/schema edits anywhere in this spec);
conditional-spread optionals (`exactOptionalPropertyTypes`); 44px touch
targets; reduced-motion on all sheet animation; drift-guards updated in the
SAME commit that removes the surface they guarded (RC6); no emoji in new
code (RC5). R7 applies to every Wave-1 task: all new chrome renders inside
a centered `maxWidth: PAGE_COLUMN_MAX` (760, exported from `chrome/`)
container — never viewport-stretched (RC9) — and sheets are bottom sheets
<768 / anchored popovers (max-width ≈400) ≥768 (RC10).

---

# WAVE 1 — Reader chrome (R1, R2, R3, R7)

## Agent RC-BAR — owns `apps/app/components/reading/chrome/ReaderTopBar.tsx` (new) + `chrome/tomeRows.ts` (new) + their tests

- [x] 1.1 ReaderTopBar + tome-row builder (R1, R2.1 row model)
  Build `ReaderTopBar` per design §1/§3: candle-glyph exit (Icon `candle`,
  accessibilityLabel "Leave the tale"), ellipsized mono title, optional
  wick meter (props only when `showCandleMeter` — reuse the Bar primitive's
  candle mode), optional Auto indicator (pause on tap), and the tome
  trigger rendered as Icon `book` + the TEXT label "Tome" at every width
  (R1.1, UX U2 — the label is the coach mark). Export
  `PAGE_COLUMN_MAX = 760` from this module (RC9). Pure `buildTomeRows` in
  `tomeRows.ts` per design §1 (auto on/off/hidden-at-terminal,
  read-as-book availability, navigation callbacks; the flag row carries
  the report action, NOT the disclosure — R2.5). Tests: builder matrix +
  top-bar a11y labels (new drift-guard per RC6).
  - _Leverage: `primitives/Icon.tsx` (RC5 glyph set), `primitives/Bar.tsx` (candle meter), `reading/CandleGutter.tsx:50` (CandleBurnMeter props to mirror in the wick), AppNav brand-glyph styling (`navigation/AppNav.tsx`)_
  - _Requirements: R1.1, R1.2, R1.4, R2.1, R7.1_
  - _Prompt: Implement the task for spec reader-chrome-declutter, first run spec-workflow-guide to get the workflow guide then implement the task: Role: React Native client developer. Task: build ReaderTopBar and the pure buildTomeRows per design §1 and the §3 mocks. Restrictions: presentational only — no data fetching; one text-row tall; 44px targets; icons from the 10-glyph set or text (RC5); the tome trigger is glyph+"Tome" text (U2); auto indicator absent ⇒ zero layout shift (R1.2); content capped to PAGE_COLUMN_MAX (RC9). Success: .test.mjs green over the row-builder matrix and the a11y drift-guard. Mark [-] when starting, log-implementation when done, then [x]._

## Agent RC-SHEET — owns `apps/app/components/reading/chrome/TomeSheet.tsx` (new) + `chrome/StoryRibbon.tsx` (new) + `chrome/ribbonSegments.ts` (new) + their tests

- [x] 1.2 TomeSheet + StoryRibbon (R2, R3)
  `TomeSheet`: modal bottom sheet (<768) / anchored popover max-width ≈400
  (≥768, RC10) rendering `TomeRow[]` per the §3 mock — backdrop close,
  explicit close, web Escape-close, focus trap + restore-to-trigger
  (R2.3/U5), reduced-motion instant mode. `StoryRibbon`: collapsed one-row
  segments from the pure `buildRibbonSegments` — LEADING with the
  truncated (≈40ch) pursuit phrase when an arc exists (R3.1/U1), then
  counts; at ≥80% candle burn a leading candle segment in book voice whose
  tap opens the detail with the full meter + the patronage door
  (R3.4/U4 two-stage). Each segment only when its signal exists; all
  absent ⇒ null (RC2). The expanded detail sheet mounts the EXISTING
  QuestLine / ThreadsPill / DoorsJournal / DailyPulseChip components
  unchanged (their hooks fetch as today; the ThreadsPill thread-fired
  toast must still fire from the collapsed state — R3.3). Tests: segments
  matrix incl. pursuit-first ordering + the ≥80% candle segment, sheet
  a11y labels, Escape/focus-restore, reduced-motion mode.
  - _Leverage: `reading/QuestLine.tsx` (pursuit copy source), `reading/ThreadsPill.tsx:41-50` (toast effect to preserve), `reading/DoorsJournal.tsx`, `daily/DailyPulseChip.tsx:78`, `reading/CandleGutter.tsx` (meter + paywall route), design §0 RC2 predicates_
  - _Requirements: R2.1, R2.3, R3.1, R3.2, R3.3, R3.4, R7.4_
  - _Prompt: Implement the task for spec reader-chrome-declutter, first run spec-workflow-guide to get the workflow guide then implement the task: Role: React Native client developer. Task: build TomeSheet and StoryRibbon per design §1/§3 with the review deltas (pursuit-first ribbon U1, two-stage candle U4, Escape/focus-restore U5). Restrictions: compose the EXISTING strip components inside the detail sheet — no new queries, no predicate re-derivation (RC2); all-signals-absent renders null; the thread-fired toast still fires with the ribbon collapsed (R3.3); popover idiom ≥768 (RC10). Success: .test.mjs green over the segment/candle matrices + a11y; toast behavior verified by test. Mark [-] when starting, log-implementation when done, then [x]._

## Agent RC-WIRE — owns `apps/app/components/reading/ReaderScreen.tsx` + the drift-guard tests it carries

- [x] 1.3 Swap the chrome in ReaderScreen (R1.3, R2.2, R2.5, R3.5)
  Replace the mounts per design §2: remove AppNav (≈:607), the four strip
  mounts (≈:614-646), CandleBurnMeter row (≈:648), and the entire
  ReaderSaveActions block (≈:656 + :833-948, incl. AiSceneFlag mount);
  mount ReaderTopBar (wick under today's `showCandleMeter`, auto
  indicator from `autoOn`), StoryRibbon (pursuit + counts + ≥80% candle
  stage), TomeSheet (rows via `buildTomeRows`, incl. the flag row reusing
  `ReportButton`'s action, Reading settings row opening the existing
  drawer, Leave-the-tale row), AND the persistent AI-disclosure footer
  caption ("AI-generated tale", plain text) beneath the scene prose above
  the choices on generated scenes (R2.5/U3). Wrap ALL chrome in the
  centered `PAGE_COLUMN_MAX` container (RC9). Auto semantics unchanged
  (RC4). CandleGutterInterstitial + SoftSignupRibbon untouched (RC3).
  Update `autoNarratorReader.test.mjs` + `readerSaveActions.test.mjs`
  drift-guards to the new affordances in this same commit (RC6). Delete
  the now-dead ReaderSaveActions code. NOTE (PM P4): this file also
  carries the Novel dispatch, daily-pulse threading, and act-boundary
  lines — do not disturb them; the full suite must pass before merge.
  - _Leverage: `ReaderScreen.tsx:596-716` (the stack to replace), `:833-948` (ReaderSaveActions to delete), `moderation/AiSceneFlag.tsx` + `moderation/ReportButton` (flag action to re-home; disclosure text to re-site per R2.5), RC3/RC4 contracts_
  - _Requirements: R1.1, R1.3, R2.2, R2.4, R2.5, R3.5, R7.1_
  - _Prompt: Implement the task for spec reader-chrome-declutter, first run spec-workflow-guide to get the workflow guide then implement the task: Role: React Native client developer on the reading surface. Task: swap ReaderScreen's chrome per design §2 with the review deltas (persistent disclosure footer R2.5, page-column cap RC9). Restrictions: layouts and their props untouched (RC1); gutter interstitial + soft-signup byte-identical (RC3); useAutoNarrator untouched — only the affordance moves (RC4); drift-guards updated in the SAME commit (RC6); do not disturb the ChapterEnd act-lines, DailyPulse data threading, or Novel dispatch in this file (P4). Success: app suite green with updated guards; live check at 375px AND ≥1280px matches the §3 mocks. Mark [-] when starting, log-implementation when done, then [x]._

# WAVE 2 — One settings source (R4)

## Agent SG-SHARED — owns `apps/app/lib/readerSettingsGroups.ts` (new) + its `.test.mjs`

- [x] 2.1 Shared settings-group module (R4.1, R4.2)
  Create `readerSettingsGroups.ts` per design §1: `SettingsGroupDef` with
  canonical labels (R4.2 list), per-group `surfaces` tags reproducing
  today's split (drawer = the 8 shared groups; settings-only = HUD,
  Cinematic mode, Dialog blocks, plus the merged Audio section — R4.3; the
  dead Chrome group is NOT carried over — P2), MOVED (not copied)
  `isIllustratedBookUnlocked` + `ILLUSTRATED_BOOK_SETTINGS` + the coupled
  select/paywall handler. Tests: every group has exactly one label; drawer
  set ⊂ settings set; no group named Chrome/layoutMode; the Illustrated
  gate matrix (free/pro/dev-flag) and the coupling handler (layout +
  strategy + images together; locked ⇒ paywall route string).
  - _Leverage: `apps/app/app/settings/index.tsx:37-60` + `apps/app/components/reading/ReaderSettingsDrawer.tsx:58-81` (the duplicated gate to MOVE), `settings/index.tsx:117-408` + `ReaderSettingsDrawer.tsx:201-358` (the group inventories), design §0 RC7/RC11_
  - _Requirements: R4.1, R4.2, R4.3_
  - _Prompt: Implement the task for spec reader-chrome-declutter, first run spec-workflow-guide to get the workflow guide then implement the task: Role: client data-layer developer. Task: extract the shared reader-settings group module per design §1, RC7, and RC11. Restrictions: definitions only — no React imports; the gate/coupling logic is MOVED here and deleted from both call sites in task 2.2 (coordinate via the exported names); canonical labels per R4.2; the dead Chrome group is dropped, not migrated (P2). Success: .test.mjs green over the label/subset/gate/coupling matrices. Mark [-] when starting, log-implementation when done, then [x]._

## Agent SG-SURFACES — owns `apps/app/app/settings/index.tsx` + `apps/app/components/reading/ReaderSettingsDrawer.tsx` + `apps/app/hooks/useReaderSettings.ts` (layoutMode retirement only) + their tests

- [x] 2.2 Rewire both surfaces over the shared module (R4.1–R4.4, P2)
  Render both surfaces from `readerSettingsGroups(...)` filtered by surface
  tag, each keeping its own rendering primitive (settings `SettingGroup`
  buttons; drawer `PillGroup` pills — RC7: data extraction, not a visual
  merge). Delete the local gate/constant copies. Merge `/settings`' two
  audio controls into one section (R4.3); give each surface ONE reset with
  a scope-stating label. Remove the dead Chrome (Book/Focus) group and
  retire `layoutMode` from `useReaderSettings` (type, default, parse —
  tolerant parse of old persisted blobs that still carry the key). Fix
  the "Comic"→"Graphic novel" and other label drift via the canonical
  defs. Update `illustratedBookPicker.test.mjs` + settings tests.
  - _Leverage: shared module from 2.1, `settings/index.tsx:496` + `ReaderSettingsDrawer.tsx:404` (the two flexWrap row renderers to keep), `useReaderSettings.ts:39/61/118/187` (layoutMode sites to retire), existing tests `illustratedBookPicker.test.mjs`_
  - _Requirements: R4.1, R4.2, R4.3, R4.4_
  - _Prompt: Implement the task for spec reader-chrome-declutter, first run spec-workflow-guide to get the workflow guide then implement the task: Role: React Native client developer on the settings surfaces. Task: rewire /settings and the drawer over the shared group module per design §1/RC7 and retire the dead layoutMode setting (RC11/P2). Restrictions: visual primitives per surface unchanged; the drawer stays the strict mid-tale subset (R4.4); behavior (updateSettings + setMediaPrefs sync, paywall route) is byte-identical — only the definitions' source moves; persisted blobs carrying layoutMode still parse (tolerant); no emoji (RC5). Success: both surfaces render every group from the shared defs, duplicated gate code gone (grep proves single definition), tests green. Mark [-] when starting, log-implementation when done, then [x]._

# WAVE 3 — Home tidy + glyph sweep + nav band (R5, R6, R7.3)

## Agent HM-CLEAN — owns `apps/app/app/index.tsx` + its tests

- [x] 3.1 Home header segmented control + rank-chip dedupe (R5.3, R6)
  Move the reading-mode toggle into the "Starter adventures" header row as
  a compact segmented control (selected = filled chip styling, NO ✓ —
  R5.3), caption shown only on selection change; drop the continue-lead's
  duplicate rank chip (keep the progress line). No other home behavior
  changes (R6.3).
  - _Leverage: `app/index.tsx:344` (header row), `:355-377` (current toggle), `:298` (rank chip to drop), `primitives/Chip.tsx` selected styling_
  - _Requirements: R5.3, R6.1, R6.2, R6.3_
  - _Prompt: Implement the task for spec reader-chrome-declutter, first run spec-workflow-guide to get the workflow guide then implement the task: Role: React Native client developer on the cover screen. Task: restyle the reading-mode toggle into the starter header per design §3 and drop the duplicate rank chip per R6. Restrictions: createSave threading (readingMode) unchanged; hero/daily/continue behavior unchanged (R6.3); selected state via chip styling, no ✓ glyph (R5.3). Success: tests cover the segmented control's selected state + caption-on-change; suite green. Mark [-] when starting, log-implementation when done, then [x]._

## Agent GS-SWEEP — owns the R5 emoji sweep across `moderation/AiSceneFlag.tsx`, `reading/IlluminateButton.tsx`, `reading/CandleGutter.tsx`, `navigation/BackToSceneButton.tsx`, `app/profile/index.tsx` + a new sweep test
  (NOTE: `reading/DoorsJournal.tsx` is owned by RB-COUNTS (task 3.4) this
  wave — its 🚪→Icon `key` sweep happens there to keep the file
  single-owner. The sweep TEST still asserts DoorsJournal is clean.)

- [x] 3.2 Glyph discipline sweep (R5.1, R5.2)
  Replace UI-control emoji per RC5 in the owned files (✦→plain "AI"
  caption text; 🚪→Icon `key`; 🕯 control labels→Icon `candle`;
  🔒→"locked" text or Chip-muted styling; ←→text "Back"; ▣→drop with the
  rank-chip dedupe; ×→text "Close"). Story-art (●●○○, ▮▮▮▯, ♥) is EXEMPT —
  do not touch `lib/storyEngagement.ts` render strings (R5.2). Add the
  design §5 sweep test asserting the control-emoji set is absent from the
  swept files + the new chrome directory.
  - _Leverage: design §0 RC5 glyph table, `primitives/Icon.tsx`, the audit's emoji inventory (requirements grounding)_
  - _Requirements: R5.1, R5.2_
  - _Prompt: Implement the task for spec reader-chrome-declutter, first run spec-workflow-guide to get the workflow guide then implement the task: Role: React Native client developer. Task: execute the R5 glyph sweep in the owned files and add the sweep test per design §5. Restrictions: story-art strings exempt (R5.2); accessibilityLabels stay descriptive; where no icon fits use plain text, never a different emoji (RC5). Success: sweep test green; visual check shows no control emoji in the swept surfaces. Mark [-] when starting, log-implementation when done, then [x]._

## Agent NV-BAND — owns `apps/app/components/navigation/AppNav.tsx` + its tests

- [x] 3.3 Fix the 768–1023 hamburger band (R7.3)
  Non-reader screens only (the reader drops AppNav in Wave 1): render the
  COMPACT pill row (wordmark hidden, as on phone) from ≥768 when it fits,
  keeping `NAV_ROW_MIN_WIDTH = 1024` solely as the wordmark-visibility
  threshold. Desktop-class widths must not get the phone hamburger. Tests:
  band matrix (500 / 800 / 1100 widths → hamburger / compact row / full
  row).
  - _Leverage: `navigation/AppNav.tsx:70` (NAV_ROW_MIN_WIDTH), `:97` (useDrawer), `:152` (wordmark-hide-on-phone branch), `lib/responsive.ts:26-27` (breakpoints)_
  - _Requirements: R7.3_
  - _Prompt: Implement the task for spec reader-chrome-declutter, first run spec-workflow-guide to get the workflow guide then implement the task: Role: React Native client developer on navigation. Task: give the 768–1023 band the compact pill row per R7.3/RC10. Restrictions: phone (<768) keeps the hamburger; ≥1024 keeps the wordmark row; no other AppNav changes (Non-Goal); labels must never clip — if the compact row cannot fit at a given width, fall back to the hamburger (measure, don't assume). Success: band-matrix tests green; visual check at 800px shows pills, not a hamburger. Mark [-] when starting, log-implementation when done, then [x]._

## Agent RB-COUNTS — owns `apps/app/components/reading/DoorsJournal.tsx`, `apps/app/components/daily/DailyPulseChip.tsx`, + the `StoryRibbon` count-threading in `apps/app/components/reading/ReaderScreen.tsx`

- [x] 3.4 Light up the collapsed ribbon's doors + pulse counts (R3.1 gap from Wave 1)
  Wave-1 finding: `StoryRibbon` already ACCEPTS `doorsCount?`/`pulseLine?`
  but they never light up in the COLLAPSED row because `DoorsJournal` and
  `DailyPulseChip` self-fetch their counts and ReaderScreen has no
  synchronous source (RC2 forbade re-deriving the predicates). Add an
  OPTIONAL upward callback to each — `DoorsJournal` gains `onCount?:
  (n: number) => void`, `DailyPulseChip` surfaces its newest pulse `label`
  upward via `onPulseLine?: (s: string) => void` — fired from their existing
  fetch effects (no new query; zero-state fires 0/absent). In ReaderScreen,
  capture those into state and pass `doorsCount`/`pulseLine` to
  `StoryRibbon` so the collapsed row matches the §3 mock ("· 3 doors · 62%").
  Both callbacks are additive/optional — every other mount of these
  components (the ribbon detail sheet, any legacy call) is byte-identical.
  ALSO do DoorsJournal's own R5 glyph sweep here (🚪 → Icon `key`) since
  this task is DoorsJournal's single owner this wave (GS-SWEEP defers it).
  Tests: the callbacks fire with the fetched count; StoryRibbon
  collapsed row renders the doors/pulse segments when counts are present
  and omits them at zero (RC2).
  - _Leverage: `reading/DoorsJournal.tsx` (fetch effect), `daily/DailyPulseChip.tsx:78` (pulse label), `chrome/StoryRibbon.tsx` (already accepts doorsCount/pulseLine), `chrome/ribbonSegments.ts` (segment builder)_
  - _Requirements: R3.1_
  - _Prompt: Implement the task for spec reader-chrome-declutter, first run spec-workflow-guide to get the workflow guide then implement the task: Role: React Native client developer. Task: surface the doors + daily-pulse counts upward and thread them into the collapsed StoryRibbon per the Wave-1 finding and §3 mock. Restrictions: additive optional callbacks only — no new server queries (RC2), every existing mount byte-identical; the collapsed segments still self-hide at zero-state; coordinate the DoorsJournal edit with GS-SWEEP (disjoint lines, same file). Success: tests prove the callbacks fire and the collapsed ribbon shows doors/pulse when present; suite green. Mark [-] when starting, log-implementation when done, then [x]._

## MERGE-GATE (each wave)

- [ ] 4.1 Wave gates + live verification
  After each wave: monorepo typecheck + `pnpm --filter @cyoa/app test` +
  touched vitest files; `docker compose restart app`; then on cyoa-local at
  BOTH 375px and ≥1280px (R7 — chrome stays in the 760 page column on
  desktop, sheets become popovers, 800px shows the compact nav row) verify
  — Wave 1: reader shows TopBar → Ribbon (pursuit-first) → media with
  prose within ~3 rows; TomeSheet rows all navigate; auto toggles from the
  sheet and pauses from the bar; the AI-disclosure footer renders on
  generated scenes; the ≥80% candle segment appears (seed a nearly-burned
  counter to check); gutter + soft-signup unchanged. Wave 2: both settings
  surfaces render the canonical groups, no Chrome group, Illustrated
  coupling + paywall still work, old persisted settings blobs load.
  Wave 3: home header control, no control emoji, 800px nav pills.
  - _Requirements: NFR Reliability, NFR Accessibility, Measurement & accepted risks_
  - _Prompt: Implement the task for spec reader-chrome-declutter, first run spec-workflow-guide to get the workflow guide then implement the task: Role: release verifier. Task: run each wave's merge gate and the cyoa-local two-width checks above. Restrictions: do not ship a wave whose drift-guards were deleted rather than updated (RC6), or that regresses the gutter/soft-signup surfaces (RC3), or that hides the AI disclosure (R2.5). Success: documented pass per wave with screenshots at both widths. Mark [-] when starting, log-implementation when done, then [x]._
