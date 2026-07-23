// Behavioral tests for the PURE shared settings-group module
// (apps/app/lib/readerSettingsGroups.ts — reader-chrome-declutter R4.1/R4.2,
// design §1, RC7/RC11).
//
// Like tomeRows.test.mjs, this exercises the REAL module: the React-free .ts is
// transpiled with the repo's TypeScript and imported as an ES module (data:
// URL — no temp files, no loader flags), so the canonical labels, the surface
// split, the retired Chrome group, the Illustrated gate matrix, and the coupled
// select handler are all tested for real.
//
// Run:
//   node --test apps/app/components/reading/__tests__/readerSettingsGroups.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const modulePath = resolve(here, "../../../lib/readerSettingsGroups.ts");

const require = createRequire(import.meta.url);
const ts = require("typescript");

const source = readFileSync(modulePath, "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
});
const mod = await import("data:text/javascript," + encodeURIComponent(outputText));
const {
  readerSettingsGroups,
  readerSettingsSections,
  SETTINGS_SECTIONS,
  SETTINGS_SECTION_ORDER,
  isIllustratedBookUnlocked,
  selectIllustratedBook,
  ILLUSTRATED_BOOK_SETTINGS,
  ILLUSTRATED_BOOK_STRATEGY,
  ILLUSTRATED_BOOK_LAYOUT,
  ILLUSTRATED_BOOK_LABEL,
  PRO_MEDIA_PAYWALL_ROUTE,
} = mod;

// The canonical labels the drawer (mid-tale subset) renders (R4.2). The 8
// reader-chrome-declutter groups PLUS `focusMode` (Candlelight Focus, a phase-2
// quick-win offered on BOTH surfaces so a reader can flip the chrome dimming
// off mid-tale from the drawer without leaving the story).
const SHARED_KEYS = [
  "theme",
  "fontScale",
  "layout",
  "imagesEnabled",
  "audioEnabled",
  "narratorPlaybackRate",
  "videoEnabled",
  "reduceMotion",
  "focusMode",
];

// ── Shape / canonical labels (R4.2) ─────────────────────────────────────────

test("every group has exactly one non-empty string label", () => {
  for (const unlocked of [false, true]) {
    const groups = readerSettingsGroups({ illustratedUnlocked: unlocked });
    for (const g of groups) {
      assert.equal(typeof g.label, "string", `${g.key} label is a string`);
      assert.ok(g.label.length > 0, `${g.key} label is non-empty`);
      // "exactly one label" — the field is a single scalar, not an array.
      assert.ok(!Array.isArray(g.label), `${g.key} label is a single value`);
    }
  }
});

test("group keys are unique (no group defined twice)", () => {
  const groups = readerSettingsGroups({ illustratedUnlocked: true });
  const keys = groups.map((g) => g.key);
  assert.equal(new Set(keys).size, keys.length, "group keys must be unique");
});

test("canonical R4.2 labels are used (drift fixed)", () => {
  const groups = readerSettingsGroups({ illustratedUnlocked: true });
  const labelByKey = Object.fromEntries(groups.map((g) => [g.key, g.label]));
  assert.equal(labelByKey.theme, "Theme");
  assert.equal(labelByKey.fontScale, "Text size"); // not "Typography"
  assert.equal(labelByKey.layout, "Reading layout");
  assert.equal(labelByKey.imagesEnabled, "Illustrations"); // not "Show illustrations"
  assert.equal(labelByKey.audioEnabled, "Narration & ambient");
  assert.equal(labelByKey.narratorPlaybackRate, "Narrator speed");
  assert.equal(labelByKey.videoEnabled, "Scene cinematics"); // not "Play scene cinematics"
  assert.equal(labelByKey.reduceMotion, "Reduce motion"); // not "Motion"
});

test("Reading layout offers 'Graphic novel', never 'Comic' (R4.2 drift fix)", () => {
  const groups = readerSettingsGroups({ illustratedUnlocked: true });
  const layout = groups.find((g) => g.key === "layout");
  const labels = layout.options.map((o) => o.label);
  assert.ok(labels.includes("Graphic novel"), "must offer 'Graphic novel'");
  assert.ok(!labels.includes("Comic"), "must NOT offer the drifted 'Comic' label");
  // The graphicNovel value keeps its canonical variant id.
  const gn = layout.options.find((o) => o.label === "Graphic novel");
  assert.equal(gn.value, "graphicNovel");
});

test("every option carries a label + value", () => {
  const groups = readerSettingsGroups({ illustratedUnlocked: false });
  for (const g of groups) {
    assert.ok(Array.isArray(g.options) && g.options.length > 0, `${g.key} has options`);
    for (const o of g.options) {
      assert.equal(typeof o.label, "string", `${g.key} option label is a string`);
      assert.ok(o.label.length > 0, `${g.key} option label non-empty`);
      assert.ok("value" in o, `${g.key} option has a value`);
    }
  }
});

// ── Surface split (R4.4) ────────────────────────────────────────────────────

test("drawer set is a STRICT subset of the settings set (R4.4)", () => {
  const groups = readerSettingsGroups({ illustratedUnlocked: true });
  const settingsKeys = new Set(
    groups.filter((g) => g.surfaces.includes("settings")).map((g) => g.key),
  );
  const drawerKeys = new Set(
    groups.filter((g) => g.surfaces.includes("drawer")).map((g) => g.key),
  );
  // subset
  for (const k of drawerKeys) {
    assert.ok(settingsKeys.has(k), `drawer group ${k} must also be a settings group`);
  }
  // strict
  assert.ok(drawerKeys.size < settingsKeys.size, "drawer must be a STRICT subset");
});

test("the drawer renders exactly the shared mid-tale groups (R4.4, + focusMode)", () => {
  const groups = readerSettingsGroups({ illustratedUnlocked: true });
  const drawerKeys = groups
    .filter((g) => g.surfaces.includes("drawer"))
    .map((g) => g.key);
  assert.deepEqual([...drawerKeys].sort(), [...SHARED_KEYS].sort());
});

test("settings-only groups are HUD, Audio, Cinematic mode, Dialog blocks, Desk home", () => {
  const groups = readerSettingsGroups({ illustratedUnlocked: true });
  const settingsOnly = groups
    .filter((g) => g.surfaces.includes("settings") && !g.surfaces.includes("drawer"))
    .map((g) => g.key);
  assert.deepEqual(
    [...settingsOnly].sort(),
    ["cinematicMode", "deskHome", "dialogBlocksEnabled", "hudMode", "muted"].sort(),
  );
});

test("the experimental Desk-home group is settings-only + clearly labelled (the-desk R1.2)", () => {
  const groups = readerSettingsGroups({ illustratedUnlocked: true });
  const desk = groups.find((g) => g.key === "deskHome");
  assert.ok(desk, "the deskHome group is present");
  assert.deepEqual(desk.surfaces, ["settings"], "settings-surface only (not the mid-tale drawer)");
  assert.ok(/experimental/i.test(desk.label), "label clearly marks it experimental (R1.2)");
  assert.ok(!/🧪|⚗️/u.test(desk.label), "no emoji in the label (RC5)");
  // A plain boolean group the settings screen dispatches with no coupling.
  assert.deepEqual(
    desk.options.map((o) => o.value),
    [true, false],
  );
});

test("every group is tagged for at least one surface", () => {
  const groups = readerSettingsGroups({ illustratedUnlocked: true });
  for (const g of groups) {
    assert.ok(Array.isArray(g.surfaces) && g.surfaces.length > 0, `${g.key} has a surface tag`);
    for (const s of g.surfaces) {
      assert.ok(s === "settings" || s === "drawer", `${g.key} surface ${s} is valid`);
    }
  }
});

// ── P2 / RC11: the dead Chrome group is gone ────────────────────────────────

test("NO group is keyed chrome or layoutMode (P2/RC11)", () => {
  for (const unlocked of [false, true]) {
    const groups = readerSettingsGroups({ illustratedUnlocked: unlocked });
    for (const g of groups) {
      assert.notEqual(g.key, "chrome", "the dead Chrome group must not be carried over");
      assert.notEqual(g.key, "layoutMode", "layoutMode is retired");
      assert.notEqual(g.label, "Chrome", "no group labelled Chrome");
    }
    // No "book"/"focus" layoutMode option pair anywhere.
    const focusOption = groups
      .flatMap((g) => g.options)
      .find((o) => o.label === "Focus" && o.value === "focus");
    assert.equal(focusOption, undefined, "no Focus (layoutMode) option survives");
  }
});

// ── Honest three-axis sections (reading-modes cleanup B3) ───────────────────

test("every group is filed under a look/media section (never read)", () => {
  for (const unlocked of [false, true]) {
    const groups = readerSettingsGroups({ illustratedUnlocked: unlocked });
    for (const g of groups) {
      assert.ok(
        g.section === "look" || g.section === "media",
        `${g.key} section must be look or media, got ${g.section}`,
      );
      // "read" is a per-save axis with no backing ReaderSettings group.
      assert.notEqual(g.section, "read", `${g.key} must not claim the read section`);
    }
  }
});

test("section metadata: honest labels + non-empty blurbs, read leads", () => {
  assert.deepEqual(SETTINGS_SECTION_ORDER, ["read", "look", "media"]);
  assert.equal(SETTINGS_SECTIONS.read.label, "How you read");
  assert.equal(SETTINGS_SECTIONS.look.label, "How it looks");
  assert.equal(SETTINGS_SECTIONS.media.label, "Illustrations & narration");
  for (const key of SETTINGS_SECTION_ORDER) {
    assert.equal(SETTINGS_SECTIONS[key].key, key);
    assert.ok(SETTINGS_SECTIONS[key].blurb.length > 0, `${key} has a blurb`);
  }
});

test("the three axes are not conflated: layout is a LOOK, media strategy is MEDIA", () => {
  const groups = readerSettingsGroups({ illustratedUnlocked: true });
  const sectionByKey = Object.fromEntries(groups.map((g) => [g.key, g.section]));
  // Illustrated Book appears as a layout skin (look) AND a cinematic strategy
  // (media) — the layout group is the LOOK, the cinematicMode group the MEDIA.
  assert.equal(sectionByKey.layout, "look");
  assert.equal(sectionByKey.cinematicMode, "media");
  // Cosmetic skins land under look; generated media under media.
  assert.equal(sectionByKey.theme, "look");
  assert.equal(sectionByKey.fontScale, "look");
  assert.equal(sectionByKey.reduceMotion, "look");
  assert.equal(sectionByKey.imagesEnabled, "media");
  assert.equal(sectionByKey.audioEnabled, "media");
  assert.equal(sectionByKey.videoEnabled, "media");
  assert.equal(sectionByKey.narratorPlaybackRate, "media");
});

test("readerSettingsSections: always returns the 3 sections in order, read first + empty", () => {
  for (const surface of ["settings", "drawer"]) {
    const sections = readerSettingsSections({ illustratedUnlocked: true, surface });
    assert.deepEqual(
      sections.map((s) => s.section.key),
      ["read", "look", "media"],
      `${surface} sections are read → look → media`,
    );
    // The read axis is per-save — no backing group on either surface.
    const read = sections.find((s) => s.section.key === "read");
    assert.deepEqual(read.groups, [], "read section carries no groups");
    // Every other section has at least one group on each surface.
    for (const s of sections) {
      if (s.section.key === "read") continue;
      assert.ok(s.groups.length > 0, `${surface}/${s.section.key} has groups`);
    }
  }
});

test("readerSettingsSections partitions the surface's groups exactly (no loss/dup)", () => {
  for (const surface of ["settings", "drawer"]) {
    const flat = readerSettingsGroups({ illustratedUnlocked: true }).filter((g) =>
      g.surfaces.includes(surface),
    );
    const sections = readerSettingsSections({ illustratedUnlocked: true, surface });
    const fromSections = sections.flatMap((s) => s.groups.map((g) => g.key));
    // Same set, same count — every surface group lands in exactly one section.
    assert.equal(fromSections.length, flat.length, `${surface}: no group dropped/duplicated`);
    assert.deepEqual(
      [...fromSections].sort(),
      flat.map((g) => g.key).sort(),
      `${surface}: section groups == surface groups`,
    );
    // Canonical order preserved within each backed section.
    for (const s of sections) {
      const expected = flat.filter((g) => g.section === s.section.key).map((g) => g.key);
      assert.deepEqual(s.groups.map((g) => g.key), expected, `${surface}/${s.section.key} order`);
    }
  }
});

test("the drawer's 'look' section still carries the reading-layout group (Illustrated is a look)", () => {
  const sections = readerSettingsSections({ illustratedUnlocked: false, surface: "drawer" });
  const look = sections.find((s) => s.section.key === "look");
  assert.ok(
    look.groups.some((g) => g.key === "layout"),
    "layout skin lives under How it looks on the drawer",
  );
});

// ── Illustrated Book gate matrix (R3.7) ─────────────────────────────────────

test("Illustrated gate: free / pro / unlimited / dev-flag matrix", () => {
  const prev = process.env.EXPO_PUBLIC_DEV_FORCE_PRO_MEDIA;
  try {
    delete process.env.EXPO_PUBLIC_DEV_FORCE_PRO_MEDIA;

    // null profile → locked
    assert.equal(isIllustratedBookUnlocked(null), false);

    // free tier → locked
    assert.equal(
      isIllustratedBookUnlocked({ entitlementTier: "free", entitlementStatus: "active" }),
      false,
    );

    // pro + active → unlocked
    assert.equal(
      isIllustratedBookUnlocked({ entitlementTier: "pro", entitlementStatus: "active" }),
      true,
    );

    // unlimited + active → unlocked
    assert.equal(
      isIllustratedBookUnlocked({ entitlementTier: "unlimited", entitlementStatus: "active" }),
      true,
    );

    // pro but not active (grace/expired/revoked) → locked
    for (const status of ["grace", "expired", "revoked"]) {
      assert.equal(
        isIllustratedBookUnlocked({ entitlementTier: "pro", entitlementStatus: status }),
        false,
        `pro + ${status} stays locked`,
      );
    }

    // dev flag forces unlock even for a free / null profile
    process.env.EXPO_PUBLIC_DEV_FORCE_PRO_MEDIA = "1";
    assert.equal(isIllustratedBookUnlocked(null), true, "dev flag unlocks null profile");
    assert.equal(
      isIllustratedBookUnlocked({ entitlementTier: "free", entitlementStatus: "expired" }),
      true,
      "dev flag unlocks a free/expired profile",
    );
  } finally {
    if (prev === undefined) delete process.env.EXPO_PUBLIC_DEV_FORCE_PRO_MEDIA;
    else process.env.EXPO_PUBLIC_DEV_FORCE_PRO_MEDIA = prev;
  }
});

test("the cinematic-mode Illustrated option reflects the lock flag", () => {
  const locked = readerSettingsGroups({ illustratedUnlocked: false });
  const unlocked = readerSettingsGroups({ illustratedUnlocked: true });
  const optOf = (groups) =>
    groups
      .find((g) => g.key === "cinematicMode")
      .options.find((o) => o.value === ILLUSTRATED_BOOK_STRATEGY);

  assert.equal(optOf(locked).locked, true, "non-Pro → option locked");
  assert.equal(optOf(unlocked).locked, false, "Pro → option unlocked");
  // Canonical label, no lock emoji baked into the string (RC5).
  assert.equal(optOf(locked).label, ILLUSTRATED_BOOK_LABEL);
  assert.ok(!/🔒/.test(optOf(locked).label), "no lock emoji in the label (RC5)");
});

test("ordinary options never carry a locked flag", () => {
  const groups = readerSettingsGroups({ illustratedUnlocked: false });
  for (const g of groups) {
    for (const o of g.options) {
      const isIllustrated = o.value === ILLUSTRATED_BOOK_STRATEGY;
      if (!isIllustrated) {
        assert.equal(o.locked, undefined, `${g.key}/${o.label} must not set locked`);
      }
    }
  }
});

// ── The ONE coupled select handler (R4.1, RM7/R3.8) ─────────────────────────

test("selectIllustratedBook unlocked → applies layout + cinematicMode + images together", () => {
  const result = selectIllustratedBook({ illustratedUnlocked: true });
  assert.equal(result.kind, "apply");
  assert.deepEqual(result.settings, {
    layout: ILLUSTRATED_BOOK_LAYOUT,
    cinematicMode: ILLUSTRATED_BOOK_STRATEGY,
    imagesEnabled: true,
  });
  // The three coupled axes are all present and correct.
  assert.equal(result.settings.layout, "illustratedBook");
  assert.equal(result.settings.cinematicMode, "illustrated_book");
  assert.equal(result.settings.imagesEnabled, true);
});

test("selectIllustratedBook locked → paywall route string (no side effect)", () => {
  const result = selectIllustratedBook({ illustratedUnlocked: false });
  assert.equal(result.kind, "paywall");
  assert.equal(result.route, "/paywall?reason=pro_media");
  assert.equal(result.route, PRO_MEDIA_PAYWALL_ROUTE);
});

test("the shared coupling constants match the pre-extraction copies", () => {
  assert.equal(ILLUSTRATED_BOOK_STRATEGY, "illustrated_book");
  assert.equal(ILLUSTRATED_BOOK_LAYOUT, "illustratedBook");
  assert.deepEqual(ILLUSTRATED_BOOK_SETTINGS, {
    layout: "illustratedBook",
    cinematicMode: "illustrated_book",
    imagesEnabled: true,
  });
});

test("the handler fires identically for both surfaces (same input → same result)", () => {
  // Both surfaces call selectIllustratedBook with the same gate boolean, so the
  // result is byte-identical regardless of caller (R4.1: ONE handler).
  const a = selectIllustratedBook({ illustratedUnlocked: true });
  const b = selectIllustratedBook({ illustratedUnlocked: true });
  assert.deepEqual(a, b);
  const c = selectIllustratedBook({ illustratedUnlocked: false });
  const d = selectIllustratedBook({ illustratedUnlocked: false });
  assert.deepEqual(c, d);
});
