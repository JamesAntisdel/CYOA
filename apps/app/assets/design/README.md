# The Unwritten — Asset Export

Generated from `CYOA Design System.html`. Drop these into downstream projects as-is.

## Layout

```
export/
├── tokens/
│   ├── tokens.json         — full design token map
│   └── tokens.css          — same, as CSS custom properties
├── logos/
│   ├── lockup-primary.svg  — candle + wordmark + tagline (380×60)
│   ├── lockup-light.svg    — same, on dark
│   ├── wordmark.svg        — wordmark only (320×56)
│   ├── wordmark-light.svg
│   ├── glyph-candle.svg    — primary mark (56×56)
│   ├── glyph-candle-light.svg
│   ├── glyph-book-quill.svg
│   ├── glyph-seal.svg
│   └── glyph-eye.svg
├── icons/
│   └── *.svg               — 16-icon set, 24×24, currentColor
│      candle, book, heart, coin, skull, eye, hourglass, key,
│      people, sack, quill, flame, compass, crown, scroll, sparkle
├── covers/
│   ├── cover-bone-cathedral.svg / .png   (560×800)
│   ├── cover-iron-court.svg / .png
│   ├── cover-ashfall.svg / .png
│   └── cover-training-room.svg / .png
└── marketing/
    ├── og-card.svg / .png  — 1200×630 social share
    ├── favicon.svg         — light variant
    ├── favicon-dark.svg
    ├── favicon-32.png
    ├── favicon-64.png
    ├── favicon-180.png     — apple-touch-icon
    ├── favicon-512.png
    └── favicon-512-dark.png
```

## Notes

- **Logos & icons** are SVG. Recolor via `fill` / `stroke`. Icons use `currentColor` so they inherit text color.
- **Covers** ship as both SVG (vector, infinitely scalable) and PNG (560×800, ready for img tags). The SVGs reference web fonts (EB Garamond, Special Elite) — load them via Google Fonts before render, or replace the labels in your final pipeline.
- **OG card** is at the standard 1.91:1 ratio for Twitter/Facebook/LinkedIn. Same font note applies.
- **Favicons** include 32/64/180/512 PNGs and an SVG. Wire up:
  ```html
  <link rel="icon" type="image/svg+xml" href="favicon.svg">
  <link rel="icon" type="image/png" sizes="32x32" href="favicon-32.png">
  <link rel="apple-touch-icon" href="favicon-180.png">
  ```
- **Fonts** (all on Google Fonts):
  - EB Garamond — display
  - Lora — body
  - Inter — UI
  - Special Elite — stamps / mono accents

## Source
The original React components live in `CYOA Design System.html` under `window.DSC`, `window.DSLogos`, and `window.DSBoards` if downstream agents want to re-render at different sizes or extend the system.
