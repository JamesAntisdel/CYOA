# Visual regression tests — task 29

This suite compares production surfaces against the hi-fi canvas at
`apps/app/assets/design/design-system.html`. Token regions diff with strict
tolerance (≤0.1% pixel drift); layout regions get ~1% to absorb OS font
hinting noise.

## Run

```bash
# Canvas baselines only (no dev server needed — opens design-system.html
# as file://):
pnpm test:visual

# Canvas + production surfaces (boots the Expo web server):
VISUAL_PROD=1 pnpm test:visual

# Update baselines after an intentional design or production change:
pnpm test:visual:update
```

## Baseline storage

Screenshots live under
`tests/visual/__snapshots__/<spec-file-name>/<section-id>.png`. Commit
them with the spec they baseline. PRs that regress a region will surface
a diff image in the Playwright report.

## Sections covered

The canvas has 25 `<DCSection>` blocks; see `sections.ts` for the
canonical mapping from canvas id → production route → tolerance class.
Sections without a production analog (e.g. § 17 hifi hero, § 16 states)
still get a canvas baseline so design drift inside the canvas itself is
visible.

## Adding a new surface

1. Add a `<DCSection>` to `design-system.html` with an `id="…"`.
2. Add the matching entry to `SECTIONS` in `sections.ts`.
3. Run `pnpm test:visual:update` to write the new baseline.
4. Commit both the new spec entry and the baseline PNG.

## CI

Token-tolerance failures block CI. Layout-tolerance failures surface a
diff image but don't block — they're flagged as review-required so a
human can decide whether the drift is intentional (e.g., a layout
tweak in a layout-class section) or accidental (a regression).

## What this suite does NOT do

- Mobile viewports. The 1280×900 fixed viewport is desktop-only. Mobile
  drift is a follow-up.
- Server-rendered surfaces. Everything here is client-rendered React or
  React Native Web.
- Cross-browser. Chromium only for now — Firefox/WebKit are a follow-up.

## End-to-end flow smoke (`playwright.flow.config.ts`)

A separate spec — `end-to-end-flow.spec.ts` — drives the real user flow
through a headless browser against the **live local Docker stack**:

```
landing -> 18+ age gate -> library -> tap cover -> reader -> first
choice -> verify MediaPlate advances past the skeleton state
```

Unlike the visual specs, this one does NOT diff screenshots. It asserts
behavior at each step and logs a `[flow]` line per step so CI failures
are easy to triage. It catches issues HTTP-level smoke
(`scripts/smoke/live-readiness.mjs`) misses — render hangs, age-gate
regressions, choice handlers wired to dead endpoints, MediaPlate stuck
on the skeleton, etc.

### Run

The stack must already be up (`docker compose up -d app provider-mocks convex`).

```bash
# Default target: http://localhost:8081
pnpm test:e2e:flow

# Different host (e.g. a tunnel / preview env):
E2E_BASE_URL=http://127.0.0.1:8081 pnpm test:e2e:flow
```

This config has `webServer: undefined` on purpose — it never boots a
dev server. If the stack is down the test fails fast on the first
`page.goto`.

### What it asserts

| Step                  | Assertion                                                |
|-----------------------|----------------------------------------------------------|
| Landing               | `document.title` contains "The Unwritten"                |
| Age gate visible      | A `radiogroup` is on screen                              |
| Select 18+            | Continue button becomes enabled                          |
| Library populated     | "Choose a starter adventure." header visible             |
| Cover tap             | One of Bone Cathedral / Iron Court / Ashfall is clicked  |
| Reader mounts         | URL matches `/read/<saveId>`                             |
| Choice click          | First enabled choice button is clickable                 |
| Media advance (≤20s)  | Scene `<img>` renders OR skeleton microcopy disappears   |
