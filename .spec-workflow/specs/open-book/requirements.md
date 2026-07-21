# Requirements — The Open Book (desktop two-page spread)

Status: DRAFT FOR REVIEW (2026-07-21). Phase-2 flagship of the UI overhaul
(`docs/design/2026-07-20-ui-overhaul-brainstorm.md`, direction 1), building
directly on the reader-chrome-declutter (phase 1, shipped): it fills the
empty desktop margins the declutter deliberately reserved (declutter R7.5).
Companions: `design.md` (architecture + mocks), `tasks.md`.

Grounding (verified at HEAD): all seven reader layouts consume the SAME
`ReaderLayoutProps` (`components/reading/layouts/types.ts:13`) and are
dispatched by `resolveActiveLayout(settings.layout, isPhone)` →
`READER_LAYOUTS[activeLayout]` in ReaderScreen (`:495-505`), with a Novel
override. So a new layout is a drop-in `READER_LAYOUTS` entry — the turn
pipeline never forks. The breakpoint helper (`lib/responsive.ts`) tops out
at `isDesktop` = width ≥ 768, but a two-PAGE spread needs real width, so
this spec adds a wider threshold. On desktop today the reader shows a
single 760px page column (declutter R7.1) centered in a sea of empty
margin — this spec claims that margin for the book.

## Introduction

At a genuinely wide viewport the tome stops being a phone-shaped column on
a monitor and becomes what the product promises — an open book on a desk:

1. **A two-page spread.** Verso (left page): the scene illustration as a
   full-page plate, with the tale's living signals rendered as **handwritten
   marginalia** down the margin (the declutter's StoryRibbon data, now given
   the room it was denied). Recto (right page): **drop-cap prose** with the
   choices set as **numbered footnotes** at the foot of the page, not a
   button stack.
2. **A page-turn.** Advancing a scene turns the page (reduced-motion: no
   animation). In Novel mode this is the whole point — "Turn the page"
   literally turns one.
3. **A pure enhancement, not a fork.** The spread is one new layout consuming
   the identical `ReaderLayoutProps`; phone and tablet are untouched; the
   engine, turn pipeline, and server see nothing new.

## Alignment with Product Vision

- **"Living book" made literal** (product purpose): the strongest possible
  expression of the core metaphor, on the surface (desktop web) with the
  most unused space.
- **Story first** (principle 1): prose is the recto's whole right page;
  choices recede to footnotes; chrome is marginalia.
- **Novel mode payoff**: the reading-modes Novel mode gets its native home —
  a linear book you turn the pages of.
- **No regression to funnels**: the ending panel, candle gutter, soft-signup,
  paywall, and daily surfaces all keep working (they render into the spread,
  never bypassed).

---

## Requirements

### R1 — Spread layout selection

User story: on a wide screen my tale opens as a book; on my phone nothing
changes.

1. A new `spread` `ReaderLayoutVariant` SHALL be added to the layout
   registry (`READER_LAYOUTS`, `useReaderSettings` union) as a drop-in
   consumer of the unchanged `ReaderLayoutProps`.
2. `resolveActiveLayout` SHALL auto-select `spread` when the viewport width
   is ≥ `SPREAD_MIN` (1024) AND the reader has not EXPLICITLY chosen another
   layout from settings — mirroring today's phone→`mobile` auto-override.
   Below 1024 the reader renders exactly today's resolved layout (the
   single-page column). An explicit reader pick always wins at any width.
3. The reader SHALL be able to pick `spread` explicitly (it appears in the
   layout picker) and to opt OUT of the auto-spread by picking any
   single-page layout (the explicit-choice flag already exists —
   `cyoa.readerLayoutChosen.v1`).
4. `spread` SHALL never be auto-selected below 1024; if a reader who
   explicitly chose `spread` narrows below `SPREAD_MIN`, the layout SHALL
   gracefully fall back to a single page (no clipped/overlapping columns).

### R2 — The two-page spread structure

User story: illustration and margins on the left, story and choices on the
right, like a real open codex.

1. At `spread`, the reader SHALL render two side-by-side pages on a desk
   ground: **verso** (left) = the scene illustration plate (full-page,
   reusing the existing `SceneMedia`) above the marginalia rail (R3);
   **recto** (right) = drop-cap prose (R4) above the footnote choices (R5).
2. The spread SHALL OVERRIDE the single-page `PAGE_COLUMN_MAX` cap (declutter
   R7.1) — it is a two-column wide layout by design — but SHALL cap the total
   spread width (e.g. ≤ `SPREAD_MAX` 1400) and center it, so it never
   stretches edge-to-edge on an ultrawide.
3. A page gutter/spine SHALL separate the two pages; each page reads as
   paper (surface + subtle edge), consistent with the theme tokens.
4. When there is no illustration yet (streaming / images-off / non-Pro), the
   verso SHALL degrade gracefully (the marginalia rail rises, or a plate
   placeholder holds) — never an empty half-spread.

### R3 — Marginalia rail (fills declutter R7.5)

User story: the tale's pursuit, threads, doors, and today's-readers whisper
from the margin, in the book's own hand.

1. The verso margin SHALL render the SAME signals the declutter StoryRibbon
   composes — pursuit phrase, threads, doors, daily pulse, and the stats —
   as quiet margin notes, reusing the EXISTING components/data hooks (RC2
   discipline: no new queries, each note self-hides on its existing
   predicate; all absent → the rail is empty and the illustration takes the
   page).
2. The candle state SHALL appear as a margin note under the same two-stage
   rule the declutter uses (wick ≥50%, "the candle burns low" ≥80% linking
   to the patronage door).
3. The marginalia SHALL be visual-only reading furniture — its interactive
   affordances (open threads/doors detail, patronage) keep their existing
   destinations.

### R4 — Drop-cap prose

User story: the page opens with an illuminated capital, like a printed book.

1. The recto's opening paragraph SHALL render with a drop cap (the first
   letter enlarged, in the accent, spanning ~2–3 lines). This SHALL be an
   OPTIONAL treatment on the existing `ProseRenderer` (a prop), byte-identical
   when absent so every other layout is unchanged.
2. The drop cap SHALL respect the serif reading family and the theme accent,
   and degrade cleanly for a one-line/short scene (no orphaned cap).
3. Streaming prose SHALL still stream into the recto; the drop cap applies to
   the settled first paragraph without fighting the reveal.

### R5 — Footnote choices

User story: my options are footnotes at the foot of the page, numbered, not
a stack of buttons.

1. On the recto, the choices SHALL render as a numbered footnote list at the
   page foot (1., 2., …), each a full pressable, submitting through the
   UNCHANGED `onChoose` path — no pipeline fork, identical to a button tap.
   Locked choices, the free-form ("write your own") affordance, and check
   chips SHALL all still work, restyled as footnotes.
2. In Novel mode the footnotes collapse to the single "Turn the page"
   affordance (R6), consistent with the Novel layout today.
3. This SHALL be a layout-local rendering of the same choice model
   (`ChoiceList` gains an optional `variant:"footnote"` OR the spread renders
   a thin footnote list over the same `ChoiceProjection[]`), byte-identical
   for other layouts.

### R6 — Page-turn transition

User story: turning to the next scene turns the page.

1. On scene advance at `spread`, the recto (and optionally the verso) SHALL
   animate a page-turn (curl or slide) before the next scene settles.
2. Reduced-motion SHALL disable the animation entirely (instant swap) — no
   partial/أlternate motion.
3. In Novel mode the "Turn the page" affordance SHALL drive this transition;
   in branching mode a committed choice drives it. The transition SHALL never
   block or delay the actual turn submission (it is decorative over the
   existing streaming turn).

### R7 — Pure enhancement (no forks)

1. `spread` SHALL consume the identical `ReaderLayoutProps`; the reader turn
   pipeline, `useTurn`, the engine, the LLM contract, and all convex/server
   code SHALL be untouched.
2. The other six layouts, `ProseRenderer` (absent drop-cap), and `ChoiceList`
   (absent footnote variant) SHALL be byte-identical.
3. Terminal/ending on the spread SHALL render the EXISTING `EndingPanel`
   (centered across the spread is acceptable) — the ending/keepsake/share
   logic is not forked. The candle gutter, soft-signup, and cinematic
   surfaces SHALL render as today (they live at ReaderScreen level, above the
   layout).

## Non-Goals (explicit)

- **Phone/tablet spread** — the spread is a ≥1024 enhancement; narrower
  viewports keep their current single-page layouts.
- **Physical page-curl WebGL** — a tasteful CSS/Animated transition only;
  no 3D page-physics this spec.
- **Marginalia as a new data source** — it reuses the declutter's existing
  signals; no new queries or server work.
- **Reflowing the ending panel into a bespoke spread ending** — the existing
  panel renders; a spread-native ending is a follow-up.
- **Print/export** — out of scope.

## Non-Functional Requirements

### Performance
- No new server queries. The spread mounts the same components as the
  single-page reader; the page-turn is a single Animated value.

### Reliability / Back-compat
- Every non-spread surface is byte-identical (R7.2). A reader below 1024, or
  who picked another layout, sees exactly today's reader.

### Accessibility
- The spread is a VISUAL arrangement — reading order (illustration →
  marginalia → prose → choices) SHALL be sane for a screen reader; footnote
  choices keep button semantics + 44px targets; reduced-motion honored (R6.2).

### Code Architecture
- The new layout lives at `apps/app/components/reading/layouts/Spread.tsx`;
  the wide-select constant + resolver change are the only ReaderScreen touch.
  Drop-cap / footnote treatments are optional props on the existing atoms.
  Pure helpers (`resolveSpreadLayout`, drop-cap split) carry `.test.mjs`.
