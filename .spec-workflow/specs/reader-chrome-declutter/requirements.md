# Requirements — Reader Chrome Declutter ("the page comes first")

Status: DRAFT FOR REVIEW (2026-07-20). Companion docs: `design.md`
(architecture + mocks), `tasks.md` (agent tasks).

Grounding: a full chrome audit (2026-07-20, at HEAD) found the reader stacks
SIX-PLUS rows of chrome above the first line of story on a phone: `AppNav`
(full global nav, `ReaderScreen.tsx:607`), `QuestLine` (:614), `ThreadsPill`
(:616), `DailyPulseChip` (:631), `DoorsJournal` (:640), `CandleBurnMeter`
(:648), then the five-item `ReaderSaveActions` pill row (:656, defined
:833-948) — `flexWrap` at flex-end, so on a 375px viewport it wraps to two
lines. Eight reader-settings groups are DUPLICATED between `/settings`
(`app/settings/index.tsx:117-408`) and the in-reader drawer
(`ReaderSettingsDrawer.tsx:201-358`) with drifted labels ("Typography" vs
"Text size", "Graphic novel" vs "Comic") and the Illustrated-Book Pro-gate
logic copied verbatim into both files. Visible controls mix off-system emoji
(▶ ⏸ ⚙ ✦ 🚪 🔒 ✓ × ←) although the app ships its own 10-glyph icon font
(`primitives/Icon.tsx`). The rank chip renders in 3 places; "Continue
reading" in 2; there are two overlapping audio controls and two reset
buttons with different scopes.

## Introduction

One principle, three moves:

1. **The page comes first.** The reader's top chrome collapses to ONE slim
   `ReaderTopBar` (exit glyph · story title · inline candle wick · tome-menu
   trigger) plus ONE quiet `StoryRibbon` row that composes the four
   engagement strips. Everything auxiliary (Auto-read, Path map, Run
   history, Read as book, Reading settings, AI disclosure/flag) moves into a
   single bottom-sheet **Tome menu**. Global `AppNav` leaves the reader.
2. **One source of truth for reader settings.** A shared settings-group
   module feeds both `/settings` and the in-reader drawer, killing the
   8-group duplication, the label drift, and the copied Pro-gate.
3. **On-system glyphs.** UI-control emoji are replaced by the app's icon
   font or plain text labels. (Typographic story-art — the `●●○○` beat dots,
   `▮▮▮▯` candle bar, `♥` stat glyph — is book-voice, and stays.)

## Alignment with Product Vision

- **"Living book" interface** (product purpose): a tome does not open onto a
  toolbar. Prose within one viewport row of the top is the measurable goal.
- **Story first** (principle 1): engagement surfaces (arc, threads, doors,
  daily pulse) stay visible but shrink to one line of marginalia.
- **Monetization surfaces protected** (business objectives): the candle
  meter, gutter interstitial, soft-signup ribbon, and paywall doors are NOT
  buried — they keep their current visibility rules exactly.

---

## Requirements

### R1 — ReaderTopBar

User story: as a reader, the top of the page tells me where I am and holds
one quiet door to everything else — nothing more.

1. The reader SHALL render a single-row `ReaderTopBar` in place of today's
   `AppNav` mount: left — an exit glyph (the brand candle, navigating home);
   center — the story title (mono caption, single line, ellipsized); right —
   an inline candle-wick meter (only under today's `showCandleMeter` rule)
   and the tome-menu trigger rendered as the icon-font `book` glyph PLUS the
   text label "Tome" at every width (UX review U2 — an unlabeled glyph is
   undiscoverable to a first-session reader; the label is the coach mark).
2. WHEN auto-read is ON THEN the top bar SHALL additionally show a compact
   "Auto" indicator that pauses auto-read on tap (one-tap wheel-grab
   preserved); when OFF the indicator is absent (zero layout shift).
3. `AppNav` SHALL no longer mount inside the reader. Every other screen
   keeps `AppNav` unchanged.
4. All top-bar touch targets SHALL be ≥44px; the bar itself SHALL be one
   text-row tall.

### R2 — Tome menu (bottom sheet)

User story: everything about *this tale* lives behind one bookmark.

1. Tapping the tome trigger SHALL open a bottom sheet listing, as full-width
   rows: Auto-read (toggle, session-scoped), Path map, Run history, Read as
   book (visible under the same availability rule as the ending-panel
   affordance), Reading settings (opens the existing drawer), the AI
   disclosure + "Flag this scene" action, and Leave the tale (home).
2. The five-pill `ReaderSaveActions` row and its `AiSceneFlag` mount SHALL
   be removed from the scroll flow entirely.
3. The sheet SHALL close on backdrop tap, on a row action that navigates,
   via an explicit close affordance, AND — on web — on the Escape key; it
   SHALL respect reduced motion (no slide animation), trap focus while
   open, and restore focus to its trigger on close (UX review U5).
4. Auto-read semantics are UNCHANGED: session-only state (never
   `useReaderSettings`), manual choice tap still grabs the wheel, the
   narration halt guard still applies.
5. Moving the flag action into the Tome menu SHALL NOT remove the visible
   AI disclosure: a quiet persistent caption ("AI-generated tale") SHALL
   render in the page footer — beneath the scene prose, above the choices —
   on every generated scene (UX review U3; GenAI-disclosure posture is
   visible-always, report-in-menu). The caption uses plain text, not ✦
   (R5).

### R3 — StoryRibbon

User story: the tale's living margins — pursuit, threads, doors, today's
readers — whisper from one line instead of shouting from four.

1. A single `StoryRibbon` row SHALL replace the stacked `QuestLine`,
   `ThreadsPill`, `DailyPulseChip`, and `DoorsJournal` mounts. The
   collapsed row LEADS with the arc's pursuit phrase (truncated ≈40 chars —
   UX review U1: the reader's active goal is the most engagement-
   load-bearing line and must not be demoted to "Act II"), followed by
   compact counts: "Find the bell before dawn · 2 threads · 3 doors ▾".
   Each segment renders ONLY when its source signal exists today (arc-less,
   non-daily, door-less saves show fewer segments; ALL absent → the ribbon
   renders nothing — zero layout shift).
2. Tapping the ribbon SHALL expand a sheet (or inline panel) containing the
   FULL existing surfaces — the QuestLine detail, threads copy, doors
   journal list, and daily pulse line — reusing the existing components
   and their data hooks; no new server queries.
3. One-shot toasts (thread-fired echo) and the ThreadsPill toast behavior
   SHALL be preserved.
4. The candle is TWO-STAGE (UX/PM review U4 — a top-bar sliver alone risks
   the "no surprise cap" principle and the free→paid funnel):
   the ≥50%-burned rule lights the top-bar wick (R1.1); at ≥80% burned the
   ribbon ADDITIONALLY gains a leading candle segment in book voice ("the
   candle burns low — N turns left") whose tap opens the ribbon detail
   with the full meter and a quiet patronage door (the existing paywall
   route). The `CandleGutterInterstitial` and `SoftSignupRibbon` render
   exactly as today (untouched — protected surfaces).

### R4 — One settings source

User story: the same knob has the same name everywhere, and lives in one
place in the code.

1. A shared module SHALL define every reader-settings group ONCE (label,
   options, option labels, coupling rules, the Illustrated-Book Pro-gate +
   paywall routing) and both `/settings` and `ReaderSettingsDrawer` SHALL
   render from it. The duplicated `isIllustratedBookUnlocked` /
   `ILLUSTRATED_BOOK_SETTINGS` blocks are deleted from both call sites.
2. Label drift SHALL be resolved to one name per group (canonical: "Theme",
   "Text size", "Reading layout" — option "Graphic novel" —, "Illustrations",
   "Narration & ambient", "Narrator speed", "Scene cinematics",
   "Reduce motion").
3. `/settings` SHALL merge its two overlapping audio controls into one
   coherent section, and each surface keeps ONE reset control whose label
   states its scope.
   The dead "Chrome (Book/Focus)" group SHALL be REMOVED: `layoutMode` is
   persisted and rendered but consumed by NOTHING at HEAD (PM review P2 —
   grep-verified). The `layoutMode` storage key is retired; the "Focus"
   name is reserved for the phase-2 Candlelight Focus mode.
4. The drawer remains the strict "mid-tale" subset it is today; groups only
   on `/settings` (HUD, Chrome, Cinematic mode, Dialog blocks, Mature
   content, Narrator voice) stay `/settings`-only.

### R5 — Glyph discipline

User story: the tome's controls speak in its own type, not in emoji.

1. UI-control emoji SHALL be replaced: ▶/⏸ Auto, ⚙ Reading, ✦ AI flag,
   🚪 doors, 🔒 lock, ✓ selected, × close, ← back — each becomes an
   icon-font glyph where one fits (`book`, `candle`, `key`, `eye`, …) or a
   plain text label. No new emoji in any new component.
2. Typographic story-art is EXEMPT and preserved: QuestLine `●●○○` dots,
   candle `▮▮▮▯` bar, `♥` stat glyph.
3. Selected states SHALL use the existing Chip/Button selected styling, not
   a ✓ prefix (the home reading-mode toggle is restyled accordingly).

### R6 — Home screen tidy

User story: the cover page sells one next action, not five rows of chrome.

1. The reading-mode toggle SHALL become a compact segmented control in the
   "Starter adventures" header row (right-aligned, opposite "See all"),
   keeping its explanatory caption on selection change only.
2. The rank chip SHALL render on the profile only; the home continue-lead
   drops its duplicate (the progress line may stay).
3. No other home-screen behavior changes (hero demotion, daily card,
   continue-lead, age gate all unchanged).

### R7 — Desktop page-column discipline (web)

User story: on a wide screen the tome is a page on a desk — not a toolbar
stretched across a monitor above a thin ribbon of story.

1. All ReaderScreen-owned chrome (top bar, story ribbon, interstitials,
   ribbons) SHALL be width-capped to a single shared page column
   (`PAGE_COLUMN_MAX = 760`, matching the widest layout) and centered —
   never `alignSelf: "stretch"` against the raw viewport. The audit found
   every chrome row full-bleed today while layouts self-cap at 540–760.
2. The ReaderTopBar SHALL span exactly the page column at every width; on
   desktop (≥768) its background may extend as a hairline rule, but its
   CONTENT (glyphs, title, wick) stays inside the column.
3. The AppNav pill-row threshold SHALL be fixed for the 768–1023 band:
   a compact pill row (wordmark hidden, as on phone) renders from ≥768
   when it measures as fitting, instead of falling to the phone hamburger
   on desktop-class widths. (Non-reader screens only — the reader drops
   AppNav per R1.3.)
4. Sheets (Tome, ribbon detail) SHALL render as bottom sheets on phone and
   as anchored popover panels (max-width ≈ 400, near their trigger) on
   ≥768 — a full-width bottom sheet on a 27" monitor is a phone idiom.
5. A desktop margin-rail treatment for the StoryRibbon (true book-margin
   marginalia) is EXPLICITLY deferred to the overhaul phase-2 spec — in
   this spec the ribbon stays in-column at all widths.

## Non-Goals (explicit)

- **Ending-panel button overload** (7 actions) — a real problem, but
  terminal-screen redesign is a separate spec; the Tome menu must not
  duplicate ending-panel actions while a terminal panel is showing.
- **AppNav redesign** on non-reader screens (hamburger threshold at 1024px
  stays as-is).
- **New icon-font glyphs** — work within the existing 10; text labels are
  the sanctioned fallback.
- **StatsHud / NarratorControl / ChoiceList internals** — inner-layout
  chrome is untouched this pass.
- **Server changes of any kind** — this spec is 100% client.

## Non-Functional Requirements

### Performance
- The ribbon + top bar add no new server queries; sheets mount lazily.

### Reliability / Back-compat
- Every conditional surface keeps its exact current visibility predicate;
  legacy/arc-less/local saves must render byte-equivalent EMPTY states
  (nothing where nothing was). All 7 layouts consume unchanged
  `ReaderLayoutProps`.

### Accessibility
- 44px targets throughout; sheets respect reduced-motion and restore focus;
  every icon-only control carries an accessibilityLabel matching its action.

### Code Architecture
- New components live under `apps/app/components/reading/chrome/`
  (`ReaderTopBar`, `TomeSheet`, `StoryRibbon`); the shared settings module
  under `apps/app/lib/readerSettingsGroups.ts`. Pure render-model helpers
  carry `.test.mjs` coverage; existing drift-guard tests are updated, not
  deleted.

### Measurement & accepted risks (PM review)
- **No client→server analytics path exists at HEAD** (P3): Tome/ribbon
  usage cannot be instrumented without new server surface, which is out of
  scope. Accepted; a one-event follow-up spec is the noted debt. Watch
  EXISTING signals pre/post ship instead: activation (≥5 turns),
  guest→account (soft-signup conversions), free→paid (paywall entries via
  `reason=daily_limit`), and daily participation.
- **Delivery risk concentrates in the ReaderScreen swap** (P4): that file
  also carries the Novel dispatch, daily-pulse threading, and act-boundary
  lines shipped this cycle. Mitigation is mandatory drift-guard updates +
  the full suite + the two-width live check; the wave does not merge
  without them.
- Rollback posture (P5): static-export deploys — `git revert` +
  `docker compose restart app`.
