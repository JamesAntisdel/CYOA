// Canvas sections we baseline. Order mirrors design.md "Hi-Fi Surface
// Coverage" table.
//
// Each entry maps a DCSection id from `apps/app/assets/design/design-system.html`
// to the production surface (route + label) it represents. The production
// route can be empty when the surface is brand-only (e.g. § 17 hero is
// pitch-deck marketing, no production analog).

export type CanvasSection = {
  id: string;
  title: string;
  prodRoute?: string;
  /** Visual-regression tolerance class. */
  tolerance: "token" | "layout";
};

export const SECTIONS: CanvasSection[] = [
  { id: "foundations", title: "01 · Foundations", tolerance: "token" },
  { id: "brand", title: "02 · Brand (logos + icons)", tolerance: "token" },
  { id: "components", title: "03 · Components", tolerance: "token" },
  { id: "imagery", title: "04 · Imagery", tolerance: "layout" },
  { id: "tiers", title: "05 · Subscription tiers", tolerance: "token", prodRoute: "/paywall" },
  { id: "applied", title: "06 · Applied screens (landing/reading/OG)", tolerance: "layout" },
  { id: "themes", title: "07 · Themes", tolerance: "token" },
  { id: "enriched-flow", title: "08 · Shelf / seeding / settings", tolerance: "layout", prodRoute: "/library" },
  { id: "journeys", title: "09 · Journeys", tolerance: "layout" },
  { id: "auth", title: "10 · Auth surfaces", tolerance: "layout", prodRoute: "/login" },
  { id: "pricing", title: "11 · Patronage compare", tolerance: "layout", prodRoute: "/paywall" },
  { id: "chapter-end", title: "12 · Chapter end consequence reel", tolerance: "layout" },
  { id: "discovery", title: "13 · Discover & share", tolerance: "layout", prodRoute: "/discover" },
  { id: "narrator", title: "14 · Narrator voice picker", tolerance: "layout", prodRoute: "/settings" },
  { id: "mobile", title: "15 · Mobile shelf + reading", tolerance: "layout", prodRoute: "/library" },
  { id: "states", title: "16 · Toasts / empty / error", tolerance: "token" },
  // 17 hifi hero is marketing — no production analog
  { id: "spec-gaps", title: "18 · Spec gaps (age/mature/locked/streaming)", tolerance: "layout" },
  { id: "reading-layouts", title: "19 · Reading layout variants", tolerance: "layout" },
  { id: "hud", title: "20 · Stats HUD modes + pip motion", tolerance: "token" },
  { id: "death-paywall", title: "21 · Death + paywall variants", tolerance: "layout" },
  { id: "coop", title: "22 · Co-op surfaces", tolerance: "layout", prodRoute: "/coop" },
  { id: "endings", title: "23 · Endings & trophy crypt", tolerance: "layout", prodRoute: "/endings" },
  { id: "media-arch", title: "24 · Media architecture", tolerance: "layout" },
  { id: "operator", title: "25 · Operator dashboard", tolerance: "layout", prodRoute: "/admin" },
];

export const CANVAS_FILE_URL = (() => {
  const path = `${__dirname}/../../apps/app/assets/design/design-system.html`;
  return `file://${path}`;
})();
