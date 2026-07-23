# Design — Reader Chrome Declutter

Companion to `requirements.md` (R1–R6) and `tasks.md`. Audience: the agent
team implementing the spec. 100% client-side; no reserved convex files are
touched. Inherits the repo-wide conventions (conditional-spread optionals,
`exactOptionalPropertyTypes`, `.test.mjs` for pure modules, drift-guard
tests updated in the same commit as the surface they guard).

---

## 0. SPEC-SPECIFIC BUILD CORRECTIONS (authoritative — from the 2026-07-20 audit)

- **RC1 — ReaderScreen owns ALL the chrome this spec touches; the seven
  layouts own none of it.** The entire top stack (grep `AppNav` mount
  ≈ `ReaderScreen.tsx:607` through `ReaderSaveActions` ≈ :656, definition
  ≈ :833-948) is ReaderScreen-level. Do NOT edit
  `components/reading/layouts/*` — the layouts keep the identical
  `ReaderLayoutProps` and their inner chrome (SceneMedia, NarratorControl,
  IlluminateButton, EffectBadge, StatsHud, ChoiceList) untouched.
- **RC2 — every strip you are consolidating self-hides today; the ribbon
  must preserve each predicate EXACTLY.** QuestLine/ThreadsPill require
  `projection.arc`; DailyPulseChip requires `projection.dailyId` + a pulse
  entry + threshold; DoorsJournal self-fetches and renders nothing at
  zero-state; CandleBurnMeter requires `showCandleMeter`
  (≈ `ReaderScreen.tsx:545`, ≥50% burned + remote turn state). Compose the
  EXISTING components/hooks — do not re-derive their predicates or add
  queries. All signals absent ⇒ StoryRibbon returns null.
- **RC3 — protected monetization surfaces are OUT OF SCOPE and must render
  exactly as today:** `CandleGutterInterstitial` (≈ :663),
  `SoftSignupRibbon` (≈ :675), paywall routes, and the drawer's
  Illustrated-Book paywall redirect. The candle WICK moves to the top bar,
  but the gutter interstitial and its two doors do not move or reword.
- **RC4 — auto-read is SESSION state with two standing contracts:** never
  routed through `useReaderSettings` (reading-modes R1.6), and
  `isNarrating` remains a halt guard (the narrator-skip fix). Moving the
  toggle into the TomeSheet must not change `useAutoNarrator` — only the
  affordance moves. The manual-tap wheel-grab (`setAutoOn(false)` wrapper
  around submitChoice) stays.
- **RC5 — the icon font has EXACTLY these 10 names** (`primitives/Icon.tsx`):
  book, candle, coin, eye, heart, hourglass, key, people, sack, skull.
  Glyph assignments in this spec: tome-menu trigger = `book`; exit/brand =
  `candle` (matches AppNav's brand glyph); doors segment = `key`; AI
  disclosure = text "AI" caption (no glyph fits — plain text, NOT ✦).
  Anything else: text label. NO emoji in new components (R5).
- **RC6 — drift-guard tests exist for the surfaces being replaced.**
  `autoNarratorReader.test.mjs` asserts the Auto toggle's reachability;
  `readerSaveActions.test.mjs` guards the pill row's accessibility labels;
  `historyRouteShape.test.mjs` guards the history route. Update these to
  guard the NEW affordances (TomeSheet rows / TopBar) in the same commit
  that removes the old ones — never delete a drift-guard without a
  replacement.
- **RC7 — the two settings surfaces already share state but not
  definitions.** Both render off `useReaderSettings` + `useAccountProfile`
  and sync via `setMediaPrefs`; ONLY the group definitions (labels,
  options, gates, coupling) are duplicated (`settings/index.tsx:37-60` +
  `ReaderSettingsDrawer.tsx:58-81` hold verbatim copies of the
  Illustrated-Book gate). The shared module owns definitions; each surface
  keeps its own rendering primitive (`SettingGroup` buttons vs drawer
  pills) — this is a data-model extraction, not a visual merge.
- **RC8 — `docker compose restart app` is required after client edits** (the
  dev env serves a static Expo export; no hot reload).
- **RC9 — desktop is currently full-bleed chrome over a capped column; fix
  with ONE shared constant.** The reader ScrollView has no maxWidth
  (`ReaderScreen.tsx` contentContainer: `width:"100%"`, chrome rows
  `alignSelf:"stretch"`), while layouts self-cap (GraphicNovel 540, Mobile/
  Journal 560, IllustratedBook 620, Book/Novel 760). Export
  `PAGE_COLUMN_MAX = 760` from `chrome/` and wrap ALL chrome in a centered
  `maxWidth: PAGE_COLUMN_MAX` container (R7.1). Do NOT touch the layouts'
  own caps (their per-skin widths are intentional).
- **RC10 — breakpoints: phone <520, tablet 520–767, desktop ≥768
  (`lib/responsive.ts:26-27`), but AppNav's pill row gates on
  `NAV_ROW_MIN_WIDTH = 1024` (`AppNav.tsx:70`)** — so 768–1023 gets the
  phone hamburger on desktop-class widths. R7.3 fixes this with the
  compact (wordmark-hidden) row from ≥768; keep the 1024 threshold only
  for showing the wordmark. Sheets switch idiom at the SAME ≥768 line:
  bottom sheet below, anchored popover (max-width ≈400) above (R7.4).
- **RC11 — `layoutMode` ("Chrome: Book/Focus") is a DEAD control.** It is
  typed, defaulted, parsed, and rendered on `/settings`
  (`useReaderSettings.ts:39/61/118/187`, `settings/index.tsx:155-158`) but
  consumed by NOTHING (grep-verified at HEAD). Wave 2 removes the group
  and retires the field with a tolerant parse for old persisted blobs; the
  "Focus" name is reserved for phase-2 Candlelight Focus.

### Review deltas (UX/PM review 2026-07-20 — see docs/reviews/)

- **U1** StoryRibbon leads with the truncated pursuit phrase, not "Act II"
  — the reader's active goal is the load-bearing line.
- **U2** The tome trigger is glyph + "Tome" text at every width.
- **U3** The AI disclosure does NOT move into the sheet: a persistent
  plain-text footer caption ("AI-generated tale") renders beneath prose,
  above choices; only the flag ACTION lives in the TomeSheet.
- **U4** Candle is two-stage: wick ≥50% (top bar) + a leading book-voice
  ribbon segment at ≥80% burn linking to the meter + patronage door.
- **U5** Sheets/popovers: web Escape-close + focus restore to trigger.
- **P1** Wave order flipped: chrome ships first; settings wave second
  (file-disjoint, verified).
- **P3** No client analytics path exists — usage instrumentation is
  explicitly deferred; watch existing funnel metrics pre/post.

## 1. Component model

New directory `apps/app/components/reading/chrome/`:

```
chrome/
  ReaderTopBar.tsx     — R1. Pure presentational; props:
                          { storyTitle, onExit, onOpenTome,
                            wick?: { turnsUsed, turnsAllowed },   // only when showCandleMeter
                            auto?: { on: true, onPause } }        // only when autoOn
  TomeSheet.tsx        — R2. Modal bottom sheet; props:
                          { open, onClose, rows: TomeRow[] }
                        TomeRow = { key, label, icon?, onPress, selected? }
                        Rows built in ReaderScreen via a pure builder (below).
  StoryRibbon.tsx      — R3. Row of segments + expandable detail sheet.
                          Composes the EXISTING QuestLine / ThreadsPill /
                          DailyPulseChip / DoorsJournal inside its detail
                          sheet; the collapsed row renders derived segment
                          labels only.
  tomeRows.ts          — pure builder: buildTomeRows(input) -> TomeRow[]
                          (auto state, saveId, readAsBookAvailable,
                           onNavigate fns) — `.test.mjs` covered.
  ribbonSegments.ts    — pure builder: buildRibbonSegments(input) ->
                          { key, label }[] from { arc?, threadsPending?,
                          doorsCount?, pulseLine? } — `.test.mjs` covered.
```

Shared settings module `apps/app/lib/readerSettingsGroups.ts`:

```
export type SettingsGroupDef<T> = {
  key: string;                    // stable id, used by both surfaces
  label: string;                  // CANONICAL label (R4.2)
  options: { label: string; value: T; locked?: boolean }[];
  surfaces: ("settings" | "drawer")[];   // where it renders
};
export function readerSettingsGroups(input: {
  illustratedUnlocked: boolean;   // the ONE Pro-gate computation
}): SettingsGroupDef<unknown>[];
export const ILLUSTRATED_BOOK_SETTINGS = { layout, cinematicMode, imagesEnabled };
export function isIllustratedBookUnlocked(profile): boolean;  // moved, not copied
```

Both surfaces map over `readerSettingsGroups(...)` filtered by their
surface tag and render with their own primitive. The coupled
Illustrated-Book select handler (set layout + strategy + images together,
route to paywall when locked) lives beside the defs so both surfaces call
the same function.

## 2. Reader flow (after)

```
ReaderScreen scroll flow:
  <ReaderTopBar/>                 — always (R1)
  <StoryRibbon/>                  — null when no signals (R3)
  <CandleGutterInterstitial/>     — unchanged predicate (RC3)
  <SoftSignupRibbon/>             — unchanged predicate (RC3)
  <CinematicMoment/>              — unchanged
  <ChapterEnd/> | <Layout/>       — unchanged
  <TomeSheet/>                    — portal/modal, lazy
REMOVED from flow: AppNav, QuestLine/ThreadsPill/DailyPulseChip/DoorsJournal
direct mounts (now inside StoryRibbon's detail sheet), CandleBurnMeter row
(wick in top bar), ReaderSaveActions + AiSceneFlag row (rows in TomeSheet).
```

## 3. Mocks (authoritative layout intent)

**Visual companion:** `docs/design/mocks/reader-chrome-declutter.html` —
open it in a browser (it renders the before/after phone frames, the
auto/candle ribbon states, both sheets incl. a Sepia sample, the desktop
page-column, and the home header) with every callout keyed to the R/U ids
in this spec. The HTML mock and the ASCII below carry the same intent;
where either disagrees with the requirements text, the requirements win.
The mock uses PLACEHOLDER glyphs (🕯︎ ▤) purely for rendering — the build
uses the app icon font per RC5, never emoji.

### Reader — BEFORE (phone 375px, today)
```
[ ≡  (I) The Unwritten                      ]
[ The Drowned Bell — Act II  ●●○○        ▾ ]
[ 2 threads yet to pull                     ]
[ 62% of today's readers · the well-worn…   ]
[ 🚪 3 doors the tome remembers             ]
[ 🕯 ▮▮▮▯  the candle burns low             ]
[ ✦ AI-generated · Flag scene               ]
[ ▶ Auto ][ ⚙ Reading ][ Path map ]
[ Run history ]                       ← wrapped line
──────────── scene image ────────────
prose begins here (row ~9)…
```

### Reader — AFTER (phone 375px)
```
┌───────────────────────────────────────────┐
│ (I)  THE DROWNED BELL     ▮▮▮▯  (B) Tome  │  ← ReaderTopBar
└───────────────────────────────────────────┘   (I)=candle glyph→home,
│ Find the bell before dawn · 2 threads ▾   │  ← StoryRibbon: pursuit
──────────── scene image ────────────          phrase FIRST (U1), then
prose…                                          counts; tap ▾ expands
   AI-generated tale                        ← persistent disclosure
[ choices… ]                                   footer caption (U3/R2.5)
```
At ≥80% candle burn the ribbon gains a leading segment (U4):
```
│ the candle burns low — 3 turns left · … ▾ │  → detail: meter + patronage
```
When auto-read is on, the top bar gains one segment:
```
│ (I)  THE DROWNED BELL   [Auto ‖]  ▮▮▮▯ (B)│  ← tap [Auto ‖] pauses
```

### TomeSheet (bottom sheet)
```
╭──────────────  The Tome  ─────────────────╮
│  Auto-read                        off ▸   │
│  Path map                             ▸   │
│  Run history                          ▸   │
│  Read as book                         ▸   │  (hidden when unavailable)
│  Reading settings                     ▸   │  (opens existing drawer)
│  ───────────────────────────────────────  │
│  AI-generated scene · Flag this scene     │
│  Leave the tale                           │
╰───────────────────────────────────────────╯
```

### StoryRibbon expanded (detail sheet)
```
╭────────────  The Margins  ────────────────╮
│  <QuestLine — full existing component>    │
│  <ThreadsPill copy — full>                │
│  <DoorsJournal — full list>               │
│  <DailyPulseChip line — full>             │
│  <Candle detail: ▮▮▮▯ N of M turns>       │
╰───────────────────────────────────────────╯
```

### Reader — AFTER (desktop ≥1024, R7)
```
        ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ hairline rule (full width) ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
                 │ (I)  THE DROWNED BELL        ▮▮▮▯  (B) │        ← content in
                 │ Act II · 2 threads · 3 doors · 62%  ▾  │          760px column,
                 ┌─────────────────────────────────────────┐         centered
                 │              scene image                │
                 │  prose…                                 │
                 │                                         │
                 └─────────────────────────────────────────┘
   (empty margins — reserved for the phase-2 marginalia rail, R7.5)

TomeSheet on ≥768 = anchored popover under the (B) trigger, max-width 400:
                                        ╭─ The Tome ───────────╮
                                        │ Auto-read      off ▸ │
                                        │ Path map           ▸ │
                                        │ …                    │
                                        ╰──────────────────────╯
```

### Home — starter header (R6)
```
Starter adventures        [ Branching | Novel ]   See all
  (segmented control, selected = filled chip; caption line appears
   under the header only when the selection changes)
```

## 4. Error handling

| scenario | handling |
|---|---|
| all ribbon signals absent (legacy/local save) | StoryRibbon returns null — nothing renders (RC2) |
| doors fetch fails / zero-state | segment omitted, exactly today's DoorsJournal behavior |
| TomeSheet open at a terminal scene | Path map/Run history/Read-as-book rows still valid; Auto row hidden (auto is meaningless at an ending — `hasEnding` guard already blocks it) |
| reduced motion | sheets render without slide animation; ribbon expand is instant |
| auto paused from top bar | identical to tapping the old pill: `setAutoOn(false)` |
| settings group rendered on a surface not in its `surfaces` tag | impossible by construction — both surfaces filter the shared list |

## 5. Testing strategy

- **Pure (`.test.mjs`):** `tomeRows` matrix (auto on/off, read-as-book
  availability, terminal state); `ribbonSegments` matrix (each signal
  independently present/absent, all-absent ⇒ []); shared settings module —
  every group has a canonical label, the drawer set is a strict subset,
  the Illustrated gate + coupling handler fire identically for both
  surfaces (the R4 regression pins).
- **Drift-guards (updated, RC6):** TopBar exit/tome labels; TomeSheet row
  accessibility labels (replacing readerSaveActions guard); auto-read
  reachability now via TomeSheet + top-bar pause (replacing
  autoNarratorReader guard assertions).
- **Emoji sweep test:** a repo-lint-style test asserting the flagged
  control emoji (▶ ⏸ ⚙ ✦ 🚪 🔒 ✓) no longer appear in
  `components/reading/chrome/`, `ReaderScreen.tsx`, `settings/index.tsx`,
  `ReaderSettingsDrawer.tsx`, `app/index.tsx` (story-art files exempt).
- **Merge gate per wave:** monorepo typecheck + full app node --test suite
  + the co-located vitest files touched; then `docker compose restart app`
  (RC8) and a live phone-width check on cyoa-local.
