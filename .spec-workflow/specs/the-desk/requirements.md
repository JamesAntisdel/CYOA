# Requirements — The Desk (diegetic home, art-light V1)

Status: DRAFT FOR REVIEW (2026-07-22). Phase-3 of the UI overhaul
(`docs/design/2026-07-20-ui-overhaul-brainstorm.md`, direction 2). The most
brand-defining and the riskiest direction — so V1 is deliberately scoped to
be **buildable now with ZERO commissioned art**, **opt-in**, and **funnel-
safe**, with painted illustration as an explicit later enhancement.

Grounding (verified at HEAD, `apps/app/app/index.tsx`): the home route today
is a stacked card list — `AgeGate` (blocking, no session), then for a
RETURNING reader `continueLead` (continue-reading) → `dailyCardBlock` → the
"Starter adventures" shelf; for a FIRST-VISIT reader the acquisition
`heroBlock` (Chapter-Zero hero) leads and the "Start {tutorial}" button is
the primary funnel action. Cover art already exists as bundled assets
(`lib/designAssets.ts`: `storyCoverSources` for training-room / bone-cathedral
/ iron-court / ashfall + `brandAssets.ogCard`) and the candle glyph + burn
meter already exist — so a "desk" can be ARRANGED from what we have. An
`EXPO_PUBLIC_` flag seam is already the app's pattern
(`EXPO_PUBLIC_AUTH_MAGIC_LINK`, `EXPO_PUBLIC_DEV_FORCE_PRO_MEDIA`).

## Introduction

The home stops being a list of cards and becomes a place — a writer's desk,
seen from above, where the tools of the tale are objects you reach for:

1. **A desk of objects.** The current tome (continue reading) sits open at
   center; a **shelf** of book spines is the library; a **letter** on the
   desk is the Daily; a **candle** is the turn budget; a **key ring** is the
   trophy crypt; a **door** is discovery.
2. **Art-light V1 — no commission.** The desk is a diegetic ARRANGEMENT of
   things we already have (the bundled cover art as spines, the candle
   glyph + burn meter, themed Surfaces and tokens for the desk ground and
   objects) — NOT a painted scene. Real illustration is a documented
   phase-2 enhancement that swaps the token-built objects for art without
   re-plumbing the wiring.
3. **Opt-in and funnel-safe.** The Desk is behind a flag + a setting,
   default OFF; the current card home is unchanged and remains the default.
   The proven first-visit acquisition funnel (age gate → hero → tutorial) is
   UNTOUCHED — the Desk is a RETURNING-reader surface.

## Alignment with Product Vision

- **"Living book" as a world, not a page** (product purpose): the strongest
  home expression of the tome metaphor.
- **Guest-first + activation funnels PROTECTED** (business objectives): the
  Desk never sits between a first-time visitor and the tutorial; opt-in
  keeps the measured acquisition path intact.
- **Endings/published-tales moat surfaced** (business objectives): the key
  ring makes the trophy crypt a first-class desk object.
- **Ship safely**: flag-gated, additive, reversible — the exact posture the
  brainstorm demanded for this direction.

---

## Requirements

### R1 — Opt-in, flag + setting gated

User story: I can turn my home into a desk if I want; if I don't, nothing
changes.

1. The Desk SHALL render on the home route ONLY when opted in via BOTH a
   build seam (`EXPO_PUBLIC_DESK_HOME`) AND/OR a persisted reader setting
   ("Experimental: Desk home"), default OFF. When off, the home route is
   BYTE-IDENTICAL to today (R7.2).
2. The setting SHALL live in the reader/app settings surface with a clear
   "experimental" label; toggling it re-renders the home immediately.
3. The Desk SHALL apply only to a reader with a guest session who has
   passed the age gate — the `AgeGate` blocking path is unchanged (R4.1).

### R2 — The desk + its objects

User story: my tale's tools are objects on the desk, each one I can reach.

1. When opted in (and eligible per R1/R5), the home SHALL render a **desk
   ground** (a themed Surface) holding diegetic OBJECTS, each a labeled,
   44px, keyboard-focusable Pressable that navigates to its existing route:
   - **The open tome** (center) — continue reading → `/read/[continueSaveId]`
     (hidden/greyed when there is no in-progress save).
   - **The shelf** — book spines built from the bundled cover art →
     `/library`.
   - **The letter** — the Daily → the daily reader/results (reuse the
     existing DailyCard destinations).
   - **The candle** — the daily turn budget, using the existing candle glyph
     + burn model (visual; tapping opens the same patronage/limit surface
     the candle meter links to today).
   - **The key ring** — the trophy crypt → `/endings`.
   - **The door** — discovery → `/discover`.
2. Each object SHALL carry an accessibilityLabel naming the DESTINATION in
   plain words ("Library", "Today's tale", "Trophies", "Discover") — the
   diegetic look never costs a screen-reader user the plain meaning.
3. Objects whose data is absent SHALL self-hide or render a quiet empty
   state (no in-progress save → the tome is closed/greyed; no Daily today →
   no letter), never a broken object.

### R3 — Art-light (no commission in V1)

User story: this ships without waiting on an illustrator.

1. Every object SHALL be built from EXISTING assets + theme tokens: the
   bundled cover PNGs as spines/tome (`getStoryCoverSource`), the icon
   font / candle glyph + `Bar` meter for the candle, and themed `Surface`/
   `View` shapes for the desk ground, letter, key ring, and door. NO new
   image assets are required to ship V1.
2. The component seams SHALL be structured so a future painted-art pass
   swaps an object's VISUAL without touching its data/nav wiring (a
   documented enhancement, not this spec).
3. No control emoji (RC5 discipline from the declutter) — icon font or
   text; theme tokens for every color/space.

### R4 — Funnel protection (no regression)

User story: turning on the desk never hides the things that grow the app.

1. The `AgeGate` blocking path (no session) is UNCHANGED at any flag state.
2. The first-visit ACQUISITION path is UNTOUCHED: a reader with no
   in-progress save (first visit) SHALL still see the acquisition hero +
   the "Start {tutorial}" primary action — the Desk SHALL NOT replace the
   hero funnel. (V1: the Desk augments/serves the RETURNING reader; a
   first-visit reader either keeps the card home or the Desk clearly
   surfaces "Start here" as the primary object — design's call, but the
   tutorial-start affordance must be at least as prominent as today.)
3. Every funnel/engagement affordance reachable on the card home SHALL be
   reachable on the Desk: continue, Daily (start/open/results), library,
   tutorial start, the soft-signup path for guests, and the rank/progress
   read. Nothing that converts is removed.

### R5 — Phone fallback

User story: on my phone the home still works.

1. The Desk is a ≥768 (tablet/desktop) surface. On phone (&lt;768) the home
   SHALL fall back to today's card stack even when opted in (a desk of
   objects needs room; a cramped desk is worse than the list) — OR render a
   documented compressed vertical desk. Either way, phone MUST stay usable
   and the funnel intact.

### R6 — Accessibility + reduced-motion

1. Every object is a labeled button with a 44px target and a visible focus
   state; reading order is sane (primary action → tools).
2. Any ambient desk motion (candle flicker, etc.) SHALL be disabled under
   reduced-motion; the Desk is fully usable with zero animation.

### R7 — Pure additive

1. The Desk is a NEW component (`components/home/DeskHome.tsx`) rendered
   behind the R1 gate; the existing home render path is BYTE-IDENTICAL when
   the gate is off (R1.1). No engine/pipeline/server/convex changes; reuse
   the EXISTING data hooks (`useLibrary`, the daily fetch, the rank, the
   daily-turn state) — no new queries.
2. All existing routes/components the objects link to are unchanged.

## Non-Goals (explicit)

- **Commissioned illustration / a painted scene** — V1 is token/asset-built;
  art is a documented follow-up.
- **Replacing the first-visit acquisition funnel** — the hero → tutorial
  path stays; the Desk serves returning readers / opt-in.
- **A phone-native desk redesign** — phone falls back (R5); a bespoke phone
  desk is a follow-up.
- **New nav destinations** — objects link to EXISTING routes only.
- **Making the Desk the default** — it stays opt-in until it earns the
  default with data.

## Non-Functional Requirements

### Performance
- No new queries; the Desk reuses the home's existing data hooks. First
  paint for the (unchanged, default) card home is not regressed.

### Reliability / Back-compat
- Flag OFF ⇒ home byte-identical to today (R1.1/R7.1). The age gate and the
  tutorial funnel are inviolate (R4.1/R4.2).

### Accessibility
- Labeled objects, 44px, focus states, reduced-motion (R6).

### Code Architecture
- `components/home/DeskHome.tsx` + small object sub-components under
  `components/home/desk/`; the flag/setting resolver is a pure, tested
  helper; `app/index.tsx` gains only a gated branch (byte-identical when
  off). No new assets.
