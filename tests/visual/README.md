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
