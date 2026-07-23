# Tasks — The Desk (art-light V1)

Execution: TWO SEQUENCED WAVES. Wave 1 = the gate + setting + the pure
resolver + the shared DeskObject seam (foundation, zero visual risk to the
existing home). Wave 2 = the DeskHome layout + its objects + the single
gated branch in `app/index.tsx`. Every agent MUST read `design.md` §0
(DK1-DK9) before its first edit. Client-only; no convex/engine/server; NO
new image assets (R3). Merge gate per wave: monorepo typecheck +
`pnpm --filter @cyoa/app test` + touched vitest, then `docker compose
restart app` and a live check (flag-ON >=1024 = desk, flag-ON phone =
card fallback, flag-OFF = byte-identical) — DK9. Conventions: no control
emoji (icon font / text); theme tokens; conditional-spread optionals; pure
helpers carry `.test.mjs`; every object is a labeled 44px button (DK5).

---

# WAVE 1 — Gate, setting, and the object seam

## Agent DK-GATE — owns `apps/app/components/home/deskGate.ts` (new) + `apps/app/hooks/useReaderSettings.ts` (the deskHome setting) + `apps/app/lib/readerSettingsGroups.ts` (the experimental toggle) + tests

- [x] 1.1 The opt-in gate + setting (R1, DK1/DK2)
  Add the pure `resolveDeskEnabled({ envFlag, settingOn }): boolean` to
  `deskGate.ts` (envFlag === "1" OR settingOn; default false). Add a
  persisted `deskHome: boolean` (default false, tolerant parse) to
  `useReaderSettings`. Add an "Experimental: Desk home" toggle GROUP to the
  shared `readerSettingsGroups` module (settings surface; clearly labeled
  experimental). Do NOT yet touch app/index.tsx (Wave 2 wires the branch).
  Tests: resolveDeskEnabled matrix (envFlag/setting/default-off); the
  setting persists + tolerant-parses an old blob without the key.
  - _Leverage: `lib/readerSettingsGroups.ts` (the shared group module + the Illustrated env-flag seam pattern), `hooks/useReaderSettings.ts` (settings shape + tolerant parse), `lib/authApi.ts:59` (EXPO_PUBLIC literal-read pattern)_
  - _Requirements: R1.1, R1.2, R7.1_
  - _Prompt: Implement the task for spec the-desk, first run spec-workflow-guide to get the workflow guide then implement the task: Role: client data-layer developer. Task: add the pure resolveDeskEnabled gate, the persisted deskHome setting, and the experimental settings toggle per design §0 DK1/DK2. Restrictions: default OFF; env read is a literal process.env.EXPO_PUBLIC_DESK_HOME access (Expo inlines only literals); tolerant parse for old blobs; do NOT edit app/index.tsx yet. Success: .test.mjs green over the gate matrix + persistence. Mark [-] when starting, log-implementation when done, then [x]._

## Agent DK-OBJECT — owns `apps/app/components/home/desk/DeskObject.tsx` (new) + tests

- [x] 1.2 The shared object seam (R2.2, R3.2, DK5)
  Build `DeskObject` — the shared wrapper every desk object uses: a labeled
  Pressable (accessibilityRole "button", a required `label` prop for the
  plain-words a11y destination), a 44px min target, a visible focus state, a
  themed diegetic `Surface`/frame slot, and an optional `art` slot (an
  Image/children) so a FUTURE painted-art pass swaps only the visual
  (R3.2). No control emoji (icon font / text). Tests: renders the label +
  role + 44px; fires onPress; the art slot is optional and swap-safe.
  - _Leverage: `components/primitives/Surface.tsx` / `Button.tsx` / `Choice.tsx` (labeled-control primitives), `components/primitives/Icon.tsx` (glyphs), the theme tokens_
  - _Requirements: R2.2, R3.2, R3.3, R6.1_
  - _Prompt: Implement the task for spec the-desk, first run spec-workflow-guide to get the workflow guide then implement the task: Role: React Native client developer. Task: build the shared DeskObject seam per design §1 and DK5. Restrictions: it is a REAL labeled 44px button under the diegetic frame; the art slot is optional so a future art pass swaps only the visual; no emoji, tokens only. Success: tests cover label/role/44px/onPress + optional art slot. Mark [-] when starting, log-implementation when done, then [x]._

## MERGE-GATE (Wave 1)

- [ ] 1.3 Gate + byte-identical check
  Typecheck + app suite + touched vitest; confirm app/index.tsx is UNCHANGED
  (Wave 1 does not touch it) so the home is byte-identical; the setting
  toggle renders; resolveDeskEnabled + DeskObject compile and are tested.
  - _Requirements: R7.1_

---

# WAVE 2 — DeskHome layout + objects + the gated branch

## Agent DK-OBJECTS — owns `apps/app/components/home/desk/` object components (Shelf, OpenTome, Letter, Candle, KeyRing, Door, StartHere) + tests

- [x] 2.1 The diegetic objects (R2.1, R3.1, R4.3, DK3/DK6)
  Build each object over `DeskObject` + EXISTING assets/data (props, no new
  hooks — DK4): `Shelf` (spines from getStoryCoverSource → /library),
  `OpenTome` (continue cover → /read/[id]; closed/grey when no in-progress
  save — R2.3), `Letter` (Daily → the DailyCard destinations; self-hides
  when no daily), `Candle` (Icon candle + Bar burn model → the existing
  paywall/limit surface), `KeyRing` (→ /endings), `Door` (→ /discover),
  `StartHere` (the tutorial-start object — the MANDATORY funnel primary when
  there is no in-progress save, at least as prominent as today's button —
  R4.2/DK6). NO new image assets (R3.1). Tests: each object's label +
  destination; the no-save/no-daily self-hide rules; StartHere present.
  - _Leverage: `lib/designAssets.ts` (getStoryCoverSource + brandAssets), `components/primitives/Bar.tsx` + Icon `candle`, `components/daily/DailyCard.tsx` (daily destinations to mirror), `app/index.tsx` (the current continue/daily/tutorial nav targets)_
  - _Requirements: R2.1, R2.3, R3.1, R4.3_
  - _Prompt: Implement the task for spec the-desk, first run spec-workflow-guide to get the workflow guide then implement the task: Role: React Native client developer. Task: build the desk objects over DeskObject + existing assets/data per design §1 and DK3/DK6. Restrictions: props-only data (no new queries, DK4); NO new image assets (covers/tokens/glyphs only, R3.1); the funnel objects (continue/Daily/library/StartHere/rank/soft-signup path) are mandatory (DK6); no-save/no-daily objects self-hide gracefully. Success: tests cover each object's label/destination + the self-hide rules + StartHere presence. Mark [-] when starting, log-implementation when done, then [x]._

## Agent DK-HOME — owns `apps/app/components/home/DeskHome.tsx` (new) + `apps/app/app/index.tsx` (the single gated branch + wiring) + tests

- [x] 2.2 DeskHome layout + the gated branch (R2.1, R4, R5, R7, DK1/DK7)
  Build `DeskHome` — the desk-ground layout arranging DK-OBJECTS' objects
  (the §3 mock: shelf, open tome center, letter, candle, key ring, door;
  StartHere primary on first-visit) over the EXISTING home data passed as
  props (DK4). Wire the SINGLE gated branch in `app/index.tsx` per design
  §2: AFTER the loading + AgeGate guards, `if (resolveDeskEnabled(...) &&
  !isPhone && width >= 768 && guest.session) return <DeskHome .../>` — the
  else path is the EXACT current card home (byte-identical, R7.1/DK1). Pass
  the existing continueSave/dailyToday/starterStories/librarianRank/candle/
  tutorialStory + the existing nav callbacks. Reduced-motion honored
  (DK8). Do NOT restructure the existing card blocks. Tests: the branch pin
  (DeskHome only when opted-in + !phone + >=768 + session; flag-OFF path
  unchanged vs HEAD); DeskHome mounts the mandatory funnel objects (DK6);
  reduced-motion has no ambient motion.
  - _Leverage: `app/index.tsx:103-140` (loading + AgeGate + returning/first-visit split — the branch site), the DK-OBJECTS components, `lib/responsive.ts` (isPhone/width), `hooks/useReaderSettings` (deskHome)_
  - _Requirements: R2.1, R4.1, R4.2, R4.3, R5.1, R7.1, R7.2_
  - _Prompt: Implement the task for spec the-desk, first run spec-workflow-guide to get the workflow guide then implement the task: Role: React Native client developer on the home surface. Task: build DeskHome and wire the single gated branch in app/index.tsx per design §2 and DK1/DK6/DK7. Restrictions: flag-OFF / phone / no-session path is BYTE-IDENTICAL to today (R7.1) — one added branch, no restructure; the mandatory funnel objects render (DK6); phone/&lt;768 falls back (DK7); reduced-motion still desk. Success: tests pin the branch conditions + the flag-off byte-identical path + the funnel objects; live check shows desk >=1024, card fallback on phone, byte-identical flag-off. Mark [-] when starting, log-implementation when done, then [x]._

## MERGE-GATE (Wave 2)

- [ ] 2.3 Gate + live verification
  Full typecheck + app suite + touched vitest; `docker compose restart app`;
  live check on cyoa-local: with EXPO_PUBLIC_DESK_HOME=1 (or the setting on)
  at >=1024, the home renders the desk (shelf/tome/letter/candle/keys/door),
  every object navigates, the age gate still blocks a no-session load, and a
  first-visit reader can start the tutorial (funnel intact, R4.2); at phone
  width the card home renders; with the flag OFF the home is byte-identical
  to today. Record the observation.
  - _Requirements: R2, R4, R5, R7, DK9_
