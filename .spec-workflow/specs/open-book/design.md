# Design — The Open Book

Companion to `requirements.md` (R1–R7) and `tasks.md`. Client-only; no
convex/server/engine files touched. Inherits the reader-chrome-declutter
conventions (conditional-spread optionals, `.test.mjs` for pure helpers,
drift-guards updated with the surface they guard, no control emoji).

---

## 0. SPEC-SPECIFIC BUILD CORRECTIONS (authoritative — 2026-07-21 audit)

- **OB1 — a layout is a DROP-IN; the pipeline never forks.** All seven
  layouts consume the identical `ReaderLayoutProps`
  (`layouts/types.ts:13`) and are dispatched via
  `READER_LAYOUTS[activeLayout]` (`ReaderScreen.tsx:502-505`, with the Novel
  override). `Spread.tsx` is a new entry consuming the SAME props — do NOT
  add props to `ReaderLayoutProps`, do NOT touch `useTurn`/the engine/convex.
- **OB2 — the spread threshold is NOT `isDesktop`.** `lib/responsive.ts`'s
  `isDesktop` is width ≥ 768 — enough for a single wide column, NOT for two
  facing pages. Add `SPREAD_MIN = 1024` (a real two-page width) as the
  auto-select threshold, and `SPREAD_MAX ≈ 1400` as the centered cap
  (R2.2). Between 768 and 1023 the reader stays single-page.
- **OB3 — reuse the EXISTING layout-override machinery.** `resolveActiveLayout`
  (`ReaderScreen.tsx:79-88`) already overrides to `mobile` on phones unless
  `hasExplicitLayoutOverride()` (the `cyoa.readerLayoutChosen.v1` flag) is
  set. Extend the SAME function: when width ≥ SPREAD_MIN and no explicit
  pick, return `spread`; explicit pick always wins; phone override still
  applies first. The width must be threaded in (resolveActiveLayout takes
  `isPhone` today — pass the raw `width` or an `isWide` flag from
  `useBreakpoint`, which already returns `width`).
- **OB4 — the spread OVERRIDES the single-page column cap.** Declutter R7.1
  caps chrome + layouts at `PAGE_COLUMN_MAX = 760`
  (`chrome/ribbonSegments.ts`). The spread is intentionally wider — it caps
  at `SPREAD_MAX` and centers. The ReaderScreen chrome (top bar + ribbon)
  stays in the 760 column ABOVE the spread; only the layout region widens.
  Confirm the ScrollView contentContainer does not force the layout back
  into the 760 wrapper for `spread` (the layout renders full available width
  up to SPREAD_MAX).
- **OB5 — marginalia REUSES the declutter signals, it does not re-derive
  them.** The verso margin renders the same data the `StoryRibbon`
  detail composes (`chrome/StoryRibbon.tsx` mounts QuestLine / ThreadsPill /
  DoorsJournal / DailyPulseChip). Compose those SAME components (or a thin
  margin-note wrapper over their data) — no new queries, each self-hides on
  its predicate (RC2). Do NOT fork the candle two-stage rule.
- **OB6 — drop-cap + footnote choices are OPTIONAL treatments on the atoms.**
  `ProseRenderer` gains an optional `dropCap?: boolean` (absent ⇒ today's
  render, byte-identical); the spread renders choices as a footnote list —
  prefer a NEW thin `FootnoteChoices` presentational component over the same
  `ChoiceProjection[]` + `onChoose`, so `ChoiceList` stays untouched (locked
  rows, free-form, check chips reused as sub-pieces or re-implemented thin).
  Whichever route, `ChoiceList`'s other-layout render is byte-identical.
- **OB7 — terminal renders the EXISTING EndingPanel.** The spread, at a
  terminal projection, renders `EndingPanel` (centered across the spread is
  fine) — the ending/keepsake/share/ConsequenceReel logic is NOT forked
  (mirror how the current layouts mount it, `layouts/Mobile.tsx:168`).
- **OB8 — Novel mode + the page-turn are the same gesture.** In Novel mode
  the recto footnotes collapse to the single "Turn the page" affordance
  (reuse `layouts/pageTurn.ts` — `PAGE_TURN_CHOICE_ID`, `resolvePageTurnChoice`),
  and committing it drives the page-turn transition (R6.3). Branching commit
  drives the same transition. The transition is decorative over the existing
  streaming turn — never gate the submit.
- **OB9 — `docker compose restart app`** after client edits (static export;
  no hot reload). Verify at 1440px AND 375px (the phone must be untouched).

## 1. Component model

```
components/reading/layouts/
  Spread.tsx            — NEW. The two-page layout. Consumes ReaderLayoutProps.
                          Renders: <DeskGround> [ <VersoPage> plate + margin ]
                          [ spine ] [ <RectoPage> dropcap-prose + footnotes ].
                          Falls back to a single page < SPREAD_MIN (OB2).
  spread/
    Marginalia.tsx      — NEW. Verso margin: composes the existing QuestLine/
                          Threads/Doors/DailyPulse/stats as margin notes (OB5).
    FootnoteChoices.tsx — NEW. Numbered footnote list over ChoiceProjection[]
                          + onChoose; Novel → single page-turn (OB6/OB8).
    pageTurnAnim.ts      — NEW pure: the Animated page-turn driver + a pure
                          `shouldAnimatePageTurn(reducedMotion)` helper.
components/reading/ProseRenderer.tsx — +optional `dropCap?: boolean` (OB6).
components/reading/ReaderScreen.tsx  — resolveActiveLayout wide-select (OB3);
                          register Spread in the dispatch; pass width.
hooks/useReaderSettings.ts           — `spread` added to ReaderLayoutVariant.
components/reading/layouts/index.ts  — READER_LAYOUTS["spread"] = SpreadLayout.
lib/responsive.ts                    — SPREAD_MIN/SPREAD_MAX + an `isWide` flag.
```

## 2. Selection flow

```
resolveActiveLayout(storedLayout, { isPhone, width }):
  if isPhone && !explicitOverride         -> "mobile"     (unchanged)
  if width >= SPREAD_MIN && !explicitOverride -> "spread"  (NEW, OB3)
  else                                    -> storedLayout (unchanged)
ReaderScreen dispatch:
  Layout = projection.readingMode === "novel" && activeLayout !== "spread"
             ? NovelLayout
             : READER_LAYOUTS[activeLayout] ?? READER_LAYOUTS.book
  // Novel-on-spread is handled INSIDE Spread (its footnotes collapse to the
  // page-turn), so spread wins the dispatch and reads readingMode itself.
```

## 3. Mocks (authoritative layout intent)

Visual companion: `docs/design/mocks/open-book.html` (to be built alongside).

### Desktop ≥1024 — the spread
```
   ╌╌╌╌╌╌╌╌╌╌ ReaderTopBar (in the 760 column, unchanged) ╌╌╌╌╌╌╌╌╌╌
   ┌───────────────────────────────┬───────────────────────────────┐
   │                               │                               │
   │      SCENE ILLUSTRATION        │  ⟨T⟩he floor beneath my boots │  ← drop cap
   │      (full verso plate)        │  is fused marrow, smooth and  │
   │                               │  pale as river stones…         │
   │  ── margin ──                  │                               │
   │  Find the bell before dawn     │  …the hum from the iron        │
   │  2 threads · 3 doors           │  barrier ahead vibrates        │
   │  62% walked this way           │  through my very marrow.       │
   │  ♥ ▮▮▮▯                        │  ─────────────────────────    │
   │                               │  1. Answer the signal          │  ← footnotes
   │                               │  2. Row toward the dark        │
   │                               │  3. Write your own…            │
   └───────────────────────────────┴───────────────────────────────┘
        verso (illustration+margin)  spine   recto (prose+footnotes)
   (whole spread capped ≤1400, centered; page-turn on advance)
```

### Novel mode on the spread
```
   │      SCENE ILLUSTRATION        │  ⟨T⟩he chapter closes…         │
   │  ── margin ── Act II           │                               │
   │                               │        →  Turn the page  →     │  ← single
   └───────────────────────────────┴───────────────────────────────┘     affordance
```

### < 1024 — single page (UNCHANGED)
```
   The reader renders exactly today's resolved layout (Mobile/Book/…)
   inside the 760 page column. The spread is a pure wide enhancement.
```

## 4. Error handling

| scenario | handling |
|---|---|
| width narrows below SPREAD_MIN while on spread | Spread renders its single-page fallback; no clipped columns (R1.4) |
| no illustration (streaming / images-off / non-Pro) | verso degrades: marginalia rises / plate placeholder — never empty (R2.4) |
| very short scene / one-line prose | drop cap degrades to normal cap, no orphan (R4.2) |
| reduced motion | page-turn is an instant swap (R6.2) |
| terminal projection on spread | EndingPanel renders centered; ending logic unforked (OB7) |
| reader explicitly picked another layout | spread never auto-selects; their pick wins at any width (R1.2/R1.3) |
| Novel save on spread | footnotes collapse to the page-turn affordance (OB8) |

## 5. Testing strategy

- **Pure (`.test.mjs`):** `resolveActiveLayout` wide-select matrix (phone /
  768–1023 / ≥1024 × explicit-override on/off × stored layout) — the
  load-bearing selection logic; `shouldAnimatePageTurn(reducedMotion)`; the
  drop-cap first-paragraph split (short-scene degradation).
- **Component drift-guards:** Spread consumes `ReaderLayoutProps` with no
  added fields (assert the props shape is unchanged — pipeline-no-fork pin);
  Marginalia composes the existing strip components (not re-derived);
  FootnoteChoices submits via `onChoose` unchanged; Novel → single page-turn.
- **Byte-identical pins:** ProseRenderer without `dropCap` and ChoiceList in
  every other layout are unchanged vs HEAD (git-diff-style assertion).
- **Merge gate:** monorepo typecheck + `pnpm --filter @cyoa/app test` +
  touched vitest; `docker compose restart app`; live check at 1440px (spread)
  AND 375px (phone byte-identical) — OB9.
