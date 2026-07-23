# Design — The Desk (art-light V1)

Companion to `requirements.md` (R1–R7) and `tasks.md`. Client-only; no
convex/server/engine. Inherits the reader-chrome-declutter conventions
(conditional-spread optionals, `.test.mjs` for pure helpers, no control
emoji, theme tokens throughout). Ships behind a flag, additive, reversible.

---

## 0. SPEC-SPECIFIC BUILD CORRECTIONS (authoritative — 2026-07-22 audit)

- **DK1 — the home render path forks ONLY behind the gate; OFF is
  byte-identical.** `app/index.tsx` renders the card home today. Add a
  SINGLE gated branch: `if (deskEnabled && !isPhone && guest.session)
  return <DeskHome …>` placed AFTER the age-gate/loading guards and BEFORE
  the returning/first-visit card blocks — so a flag-OFF (or phone, or
  no-session) reader hits the EXACT current code (R1.1/R7.1). Do NOT
  restructure the existing blocks.
- **DK2 — the gate is a PURE resolver.** `resolveDeskEnabled({ envFlag,
  settingOn })` in a tested helper: `EXPO_PUBLIC_DESK_HOME === "1"` OR the
  persisted setting true. Read the env via a literal `process.env.
  EXPO_PUBLIC_DESK_HOME` access (Expo web inlines only literal reads — same
  seam the Illustrated-Book picker uses). Default OFF.
- **DK3 — NO new image assets (R3).** Objects are built from what exists:
  `getStoryCoverSource(storyId)` PNGs as book spines / the open tome; the
  candle glyph (`primitives/Icon.tsx` `candle`) + `primitives/Bar.tsx`
  (candle mode) for the candle; themed `Surface`/`View` shapes + tokens for
  the desk ground, letter, key ring, and door. If an object needs a glyph,
  use the 10-name icon font or text — never emoji (RC5).
- **DK4 — REUSE the home's existing data, do not re-fetch.** DeskHome takes
  the SAME data `app/index.tsx` already computes (`library` from
  `useLibrary`, `continueSave`, `dailyToday` from the existing fetch,
  `librarianRank`, the daily-turn/candle model) as PROPS — no new hooks/
  queries (R7.1). The objects are presentational over that data.
- **DK5 — every object is a labeled button (R2.2/R6).** Each is a
  `Pressable` (or the `Button`/`Choice` primitive) with an
  accessibilityLabel naming the DESTINATION in plain words, a 44px target,
  and a focus state. The diegetic styling is decoration on top of a real
  control.
- **DK6 — funnel objects are MANDATORY, not optional (R4.3).** The desk MUST
  surface: continue (tome), Daily (letter → the DailyCard destinations),
  library (shelf), tutorial-start (a clear "Start here" object when there is
  no in-progress save — at least as prominent as today's button, R4.2), the
  guest soft-signup path, and the rank/progress read. A missing funnel
  object is a build failure, not a style choice.
- **DK7 — phone falls back (R5).** `isPhone` (from `useBreakpoint`, &lt;520) —
  and the spec's ≥768 intent — means: when `isPhone` OR width &lt;768, the gate
  returns the card home even if opted in. DeskHome renders only ≥768.
- **DK8 — reduced-motion (R6.2).** Any ambient motion (candle flicker) is
  gated on `reduceMotion`; default to NO motion (a still desk is the safe
  baseline; flicker is an opt-in flourish).
- **DK9 — `docker compose restart app`** after client edits; verify the
  home at flag-ON ≥1024, flag-ON phone (falls back), and flag-OFF
  (byte-identical) — and that the age gate + tutorial start are reachable.

## 1. Component model

```
components/home/
  DeskHome.tsx           — NEW. The desk ground + object layout. Props: the
                           existing home data (continueSave, dailyToday,
                           starterStories, librarianRank, turn/candle model,
                           tutorialStory) + the nav callbacks (openSave,
                           startDaily, launchTutorial, router pushes).
  desk/
    DeskObject.tsx       — NEW. The shared labeled-button + diegetic-frame
                           wrapper (44px, focus, a11y label) every object
                           uses; the seam a future art pass swaps the visual on.
    Shelf.tsx            — spines from cover art → /library.
    OpenTome.tsx         — continue-reading (cover) → /read/[id]; closed/grey
                           when no in-progress save.
    Letter.tsx           — the Daily → DailyCard destinations; hidden when no
                           daily today.
    Candle.tsx           — turn budget (Icon candle + Bar) → paywall/limit.
    KeyRing.tsx          — trophies → /endings.
    Door.tsx             — discover → /discover.
    StartHere.tsx        — the tutorial-start object (funnel, R4.2/DK6).
  home/deskGate.ts       — NEW pure `resolveDeskEnabled({envFlag, settingOn})`.
app/index.tsx            — one gated branch (DK1); byte-identical when off.
hooks/useReaderSettings  — the persisted "deskHome" experimental setting.
lib/readerSettingsGroups — the settings toggle (experimental group).
```

## 2. Render flow (app/index.tsx)

```
if (guest.status === "loading") return <loading/>          // unchanged
if (!guest.session) return <AgeGate/>                       // unchanged (R4.1)
const deskEnabled = resolveDeskEnabled({ envFlag: process.env.EXPO_PUBLIC_DESK_HOME, settingOn: settings.deskHome });
if (deskEnabled && !isPhone && width >= 768)                // DK1/DK7
  return <DeskHome continueSave={…} dailyToday={…} starterStories={…}
                   librarianRank={…} candle={…} tutorialStory={…}
                   onOpenSave={openSave} onStartDaily={…} onLaunchTutorial={launchTutorial}
                   onNav={(route)=>router.push(route)} reducedMotion={…} />
// else: EXACT current card home (returning ? continueLead : hero, dailyCardBlock, starter shelf)
```

## 3. Mocks (authoritative intent)

Visual companion: `docs/design/mocks/the-desk.html`.

### Desktop ≥1024 — the desk (returning reader)
```
   ┌───────────────────────────────────────────────────────────────┐
   │  ▚▚▚ shelf ▚▚▚        ╭───────────────╮        (candle)  ▮▮▮▯  │
   │  |bone||iron|          │  THE OPEN TOME │         turns left    │
   │  |ash| |trng|          │  (continue)    │                      │
   │   → Library            │  The Drowned   │       [ letter ]      │
   │                        │   Bell — Act II│       Today's tale →  │
   │                        ╰───────────────╯                      │
   │   (key ring)                                   (door)          │
   │   Trophies →                                   Discover →      │
   └───────────────────────────────────────────────────────────────┘
   every object = a labeled 44px button; art-light (covers + tokens).
```

### First-visit (no in-progress save) — funnel intact
```
   The tome is a "Start here" object (the tutorial) as the PRIMARY,
   most-prominent object; the acquisition hero copy rides alongside.
   Tutorial-start is at least as prominent as today's button (R4.2/DK6).
```

### Phone (&lt;768) — falls back
```
   Today's card home, unchanged (R5/DK7). The Desk does not render.
```

## 4. Error handling

| scenario | handling |
|---|---|
| flag OFF | home byte-identical to today (R1.1) — DeskHome never mounts |
| phone / &lt;768 (even opted in) | card home renders; DeskHome skipped (DK7) |
| no session | AgeGate, unchanged (R4.1) |
| no in-progress save | the tome is the "Start here"/closed object (R2.3/DK6) |
| no Daily today | the letter self-hides (R2.3) |
| reduced motion | no ambient motion; still desk (DK8) |
| a cover asset missing | getStoryCoverSource falls back to ogCard (existing behavior) |

## 5. Testing strategy

- **Pure (`.test.mjs`):** `resolveDeskEnabled` matrix (envFlag × settingOn ×
  default-off); the object-visibility rules (no-save → tome closed, no-daily
  → no letter).
- **Gate/branch pin:** `app/index.tsx` renders DeskHome ONLY when
  `deskEnabled && !isPhone && width>=768 && session`; flag-OFF branch is
  byte-identical vs HEAD (git-diff-style assertion — the existing blocks
  unchanged).
- **Funnel pins (DK6):** DeskHome contains the mandatory funnel objects —
  continue, Daily, library, tutorial-start, soft-signup path, rank — each a
  labeled button to the correct route (assert the a11y labels + destinations).
- **A11y:** every object has an accessibilityLabel + role button + 44px min.
- **Merge gate:** monorepo typecheck + `pnpm --filter @cyoa/app test` +
  touched vitest; `docker compose restart app`; live check flag-ON ≥1024
  (desk), flag-ON phone (card fallback), flag-OFF (byte-identical), age gate
  + tutorial reachable (DK9).
