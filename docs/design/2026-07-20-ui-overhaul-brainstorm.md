# UI Overhaul Brainstorm — beyond the declutter

Date: 2026-07-20. Status: BRAINSTORM (founder review). Companion:
`.spec-workflow/specs/reader-chrome-declutter/` (the phase-1 spec, approved
direction "The Ribbon"). This doc is the blue-sky pass the founder asked
for: if the declutter is tidying the room, what would rebuilding the house
look like?

Grounding facts that shape everything below (verified at HEAD):
- Breakpoints: phone <520 / tablet 520–767 / desktop ≥768
  (`lib/responsive.ts`); real desktop web traffic is a first-class surface
  (the tunnel deploy is web).
- On desktop the story column caps at 540–760px while the viewport is
  1280–2560px — **more than half the screen is empty margin today**. The
  product metaphor ("a living book, gothic, candlelit, paged") has an
  obvious claim on that space that nothing currently uses.
- The design system already carries the ingredients: serif/mono families,
  Day/Night/Sepia themes, a 10-glyph icon font, Stamp/Chip/Surface/Bar
  primitives, reduced-motion discipline, and typographic story-art
  (`●●○○`, `▮▮▮▯`, `♥`).

---

## Direction 1 — "The Open Book" (desktop reading as a two-page spread)

The strongest use of desktop width: at ≥1024 the reader renders as an open
codex — two facing pages on a desk surface.

```
        ┌──────────────────────────┬──────────────────────────┐
        │  ILLUSTRATION (verso)    │  THE DROWNED BELL   (B)  │
        │  scene still, full-page  │                          │
        │  plate w/ caption        │  Drop-cap prose …        │
        │                          │  …                       │
        │  margin: Act II ●●○○     │  …                       │
        │  2 threads · 3 doors     │  ── footnotes ──         │
        │  ♥ ▮▮▮▯   62% walked     │  1. Answer the signal    │
        │                          │  2. Row toward the dark  │
        │                          │  3. Write your own…      │
        └──────────────────────────┴──────────────────────────┘
                     (page-turn transition between scenes)
```

- Verso (left page): the scene illustration as a full-page plate; beneath
  it, the **marginalia rail** — the StoryRibbon's signals rendered as
  handwritten margin notes (the phase-2 home the declutter spec reserves in
  R7.5). Stats HUD becomes a margin note, not a chip strip.
- Recto (right page): drop-cap prose; **choices as footnotes** at the
  page's foot (numbered, book-voice) instead of a button stack.
- Phone/tablet: single page (exactly the declutter layout) — the spread is
  a ≥1024 enhancement, not a fork; it can be implemented as ONE new
  `ReaderLayoutProps` consumer ("Spread" layout auto-selected on wide
  viewports, reader-overridable), so the turn pipeline is untouched.
- Page-turn: a reduced-motion-aware curl/slide on scene advance; in Novel
  mode this is *the* payoff — "Turn the page" literally turns a page.
- Cost: **M–L.** One new layout + marginalia rail + footnote ChoiceList
  variant + transition. No server work. Highest metaphor-payoff per line
  of code of anything in this doc.

## Direction 2 — "The Desk" (app shell as a place, not a menu)

Home/library/discover/account stop being stacked card lists and become one
scene: a writer's desk.

- The current tome front-and-center (continue reading); a **shelf** behind
  it (library spines, not cards); a **letter tray** (the Daily, publish
  invites); a **candle** on the desk (turn budget — wick length IS the
  meter); a **key ring** (endings/trophies); a door (discover).
- Nav becomes diegetic: tap the shelf → library; tap the letters → daily;
  the AppNav pill row survives only as a quiet fallback/footer for a11y
  and SEO-visible routes.
- Phone: the desk compresses to a vertical scene, or falls back to the
  current card stack under a `prefers` toggle.
- Cost: **L–XL.** Real illustration/art direction budget, custom hit
  regions, a11y care (every diegetic object needs a labeled control), and
  it must not slow first-load for acquisition traffic. The hero funnel
  (age gate → tutorial start) must survive intact.
- Verdict: the most brand-defining idea here, and the riskiest. Prototype
  behind a flag AFTER phases 1–2 prove the reading surface.

## Direction 3 — "The Study" (conventional three-pane web app)

Persistent left rail (Library/Discover/Create/Account), center content,
right context rail. The "productivity app" answer.

- Pros: cheapest desktop win after the declutter; familiar; kills the
  hamburger entirely on web; the right rail gives map/history/threads a
  permanent home.
- Cons: it is exactly what the product says it isn't ("hides the
  scaffolding under the metaphor of a tome"). A left rail reads as a SaaS
  dashboard, and it competes with Direction 1 for the same margins.
- Verdict: **rejected as the flagship**, but steal one organ: on wide
  desktop, non-reader screens (library/discover) MAY keep a slim icon rail
  instead of the top pill row. Park unless Direction 2 dies.

## Direction 4 — "Candlelight Focus" (immersion mode, all surfaces)

After ~4s of reading without pointer/touch activity, ALL chrome (top bar,
ribbon, HUD) fades to nothing; any input brings it back. Optionally a
subtle vignette ("candlelight") pools around the prose while focused.

- Pairs with EVERY other direction; it is a behavior, not a layout.
- Auto-narrator + focus mode together = the lean-back "audiobook with
  pages" experience.
- Must exempt: candle-gutter interstitial, soft-signup, paywall, terminal
  panels (protected surfaces never fade); reduced-motion disables the
  vignette, keeps the fade instant.
- Cost: **S–M.** A visibility controller + opacity animation + an
  activity listener. High perceived polish per unit effort.

## Direction 5 — "The Illuminated Manuscript" (design-language codification)

Not a layout — a consistency pass that makes everything feel authored:

- **Drop caps** on scene-opening paragraphs (ProseRenderer flag).
- **Chapter headpieces**: an ornamental rule + chapter/act stamp where
  ChapterEnd and scene titles render.
- **Paper**: a subtle texture token on Surface for reading surfaces only;
  candlelight edge vignette on Night/Sepia.
- **One pill grammar**: today there are ≥4 pill styles (dashed ghost,
  Chip, Stamp, drawer pill). Define exactly two — "control" and "status" —
  and migrate.
- **Type scale audit**: mono for machinery (titles, stamps), serif for
  story, sans for controls — enforced by a lint-style test like the
  emoji sweep.
- Cost: **M**, spread thin across many files; zero behavior change. This
  is what makes screenshots look intentional; it should ride along with
  phases 1–2 rather than be its own big-bang.

---

## Recommended phasing

- **Phase 1 (specced, ready): reader-chrome-declutter** — top bar + tome
  sheet + story ribbon + settings unification + desktop page-column
  discipline (R7). Ship first; everything later builds on its chrome/
  directory and column constant.
- **Phase 2: "The Open Book" + "Candlelight Focus" + manuscript language**
  — the desktop spread layout with the marginalia rail (fills R7.5's
  reserved margins), focus mode across surfaces, drop caps/headpieces/
  pill-grammar riding along. This is the web overhaul proper.
- **Phase 3: "The Desk"** — prototype behind a dev flag once phase 2
  metrics (desktop session length, activation) justify the art budget.
  Steal The Study's icon rail for non-reader screens only if The Desk
  stalls.

Decision asks for the founder:
1. Approve phasing (esp. Open Book as the phase-2 flagship over The Study).
2. Art budget question for The Desk — commission illustration or defer.
3. Focus-mode default: on-by-default for all readers, or a setting?
4. Should Novel mode default to the Spread layout on desktop (the
   page-turn payoff), or stay layout-agnostic?
