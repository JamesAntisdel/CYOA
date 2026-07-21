// Drift-guards for the Story-Engagement Wave 3 client surfaces (design §4.3).
//
// Source-level greps (same pattern as storyEngagementClient.test.mjs) — mounting
// the RN + Convex tree is out of scope for `node --test`. The pure logic behind
// these surfaces has full behavioral coverage in the vitest suites
// `apps/app/lib/__tests__/{dailyApi,storyEngagementW3}.test.ts`; here we assert
// the wiring connecting that logic to the UI can't silently regress.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "../../..");

function read(rel) {
  return readFileSync(resolve(appRoot, rel), "utf8");
}

test("DailyCard hides when there's no Daily, ticks a countdown, and routes on start", () => {
  const src = read("components/daily/DailyCard.tsx");
  assert.match(src, /if \(!daily\) return null;/, "DailyCard must hide when daily === null (design §10)");
  assert.match(src, /formatCountdown\(remainingMs\)/, "DailyCard must render a live countdown");
  assert.match(src, /setInterval\(tick, 1000\)/, "DailyCard countdown must tick each second");
  assert.match(src, /onOpenReader\(result\.saveId\)/, "a fresh start must route into the reader");
  assert.match(src, /DAILY_ALREADY_PLAYED/, "DailyCard must handle daily_already_played");
  assert.match(src, /onOpenResults\(daily\.dailyId\)/, "already-played must route to results");
  assert.match(src, /Play today's tale/, "DailyCard must show the play CTA");
});

test("DailyResults renders sorted bars, first-finder, and the rarest callout", () => {
  const src = read("components/daily/DailyResults.tsx");
  assert.match(src, /buildDistributionModel\(results\)/, "DailyResults must build the distribution model");
  assert.match(src, /First found by/, "DailyResults must surface a first-finder badge");
  assert.match(src, /Rarest path/, "DailyResults must call out the rarest path");
  assert.match(src, /bar\.isYours/, "DailyResults must highlight the reader's own ending");
});

test("WhatMightHaveBeen renders UNREACHED candidates only on terminal saves with fork/replay CTAs", () => {
  const src = read("components/reading/WhatMightHaveBeen.tsx");
  assert.match(
    src,
    /whatMightHaveBeenCards\(candidates, \{ terminal \}\)/,
    "WhatMightHaveBeen must gate on terminal + filter to unreached candidates",
  );
  assert.match(src, /if \(cards\.length === 0\) return null;/, "must render nothing without candidates (BC9/BC10)");
  assert.match(src, /Fork from a decision/, "must offer the fork CTA (R14.2)");
  assert.match(src, /Begin again/, "must offer the begin-again CTA (R14.2)");
});

test("KeepsakePicker is single-select and absent when the account owns none", () => {
  const src = read("components/creator/KeepsakePicker.tsx");
  assert.match(src, /if \(!hasKeepsakes\(owned\)\) return null;/, "picker must hide with no keepsakes (R12.2)");
  assert.match(src, /toggleKeepsakeSelection\(selectedId, keepsake\.id\)/, "picker must be single-select");
  // The exported badge for the inventory list.
  assert.match(src, /export function KeepsakeBadge/, "KeepsakePicker must export the inventory KeepsakeBadge");
});

test("inventory list badges a carried keepsake", () => {
  const src = read("components/stats/modes/PeekDrawer.tsx");
  assert.match(src, /isKeepsakeItem\(item\)/, "inventory list must detect a keepsake item");
  assert.match(src, /KeepsakeBadge/, "inventory list must render the keepsake badge");
});

test("HardcoreSelect gates a Hardcore run on consent and offers a caveated downgrade", () => {
  const src = read("components/creator/HardcoreSelect.tsx");
  assert.match(src, /canStartMode/, "HardcoreSelect must expose the consent gate");
  assert.match(src, /HARDCORE_CONSENT_TITLE/, "consent screen must show the 'does not forgive' title");
  assert.match(src, /accessibilityRole="checkbox"/, "consent must be an explicit acknowledgment toggle");
  assert.match(src, /buildDowngradeModel\(mode\)/, "downgrade surface must use the downgrade model");
  assert.match(src, /Downgrade to Story/, "downgrade surface must offer the Story downgrade");
  assert.match(src, /HardcoreDeathNotice/, "must export the hardcore death purge notice");
});

test("SeedStoryFlow wires KeepsakePicker + HardcoreSelect and threads mode/keepsakeId", () => {
  const src = read("components/creator/SeedStoryFlow.tsx");
  assert.match(src, /<KeepsakePicker/, "seed flow must render the KeepsakePicker");
  assert.match(src, /<HardcoreSelect/, "seed flow must render the HardcoreSelect");
  assert.match(src, /canStartMode\(mode, consented\)/, "launch must be gated on the consent");
  assert.match(src, /mode,\n\s*\.\.\.\(keepsakeId \? \{ keepsakeId \} : \{\}\)/, "onLaunchSeed must thread mode + keepsakeId");
});

test("EndingsMap renders fogged candidate ghosts", () => {
  const src = read("components/endings/EndingsMap.tsx");
  assert.match(src, /ghostCandidates\?:/, "EndingsMap must accept ghost candidates");
  assert.match(src, /ghost: true/, "EndingsMap must mark ghost nodes");
  assert.match(src, /node\.ghost/, "EndingsMap must render ghosts distinctly from hidden endings");
});

test("useTurn projects whatMightHaveBeen only from a terminal remote scene's ending (BC9/BC10)", () => {
  const src = read("hooks/useTurn.ts");
  // The projection field carries the UNREACHED candidates separately from the
  // death-screen `ending` object.
  assert.match(
    src,
    /whatMightHaveBeen\?: RemoteWhatMightHaveBeen\[\];/,
    "ReaderProjection must expose a whatMightHaveBeen field",
  );
  // Populated ONLY from the remote scene's ending projection, conditional-
  // spread (BC4) so a null/absent projection omits the field.
  assert.match(
    src,
    /scene\.ending\?\.whatMightHaveBeen/,
    "projectRemoteScene must source whatMightHaveBeen from the remote scene ending",
  );
  assert.match(
    src,
    /\{ whatMightHaveBeen: scene\.ending!\.whatMightHaveBeen! \}/,
    "whatMightHaveBeen must be conditional-spread (BC4 — no `: undefined`)",
  );
  // The local-engine projection (training-room / legacy saves) must NOT set
  // the field — legacy saves stay unaffected.
  const engineProjection = src.slice(src.indexOf("function projectEngineState"));
  assert.doesNotMatch(
    engineProjection,
    /whatMightHaveBeen/,
    "the local-engine projection must never set whatMightHaveBeen (legacy unaffected)",
  );
});

test("layout ending panels mount WhatMightHaveBeen with the dedicated fork/begin-again handlers", () => {
  // The shared prop-bag builder gates on terminal and wires the panel's copy
  // to what it promises: Fork → the run-history fork surface (R14.2),
  // Begin again → a fresh run of the same story (Req 8.3). The legacy
  // onOpenEndings/onReturnHome wires remain as fallbacks for hosts that don't
  // supply the dedicated handlers.
  const types = read("components/reading/layouts/types.ts");
  assert.match(types, /export function whatMightHaveBeenProps/, "types.ts must export the prop bag builder");
  assert.match(
    types,
    /terminal: Boolean\(input\.projection\.ending\)/,
    "whatMightHaveBeenProps must derive `terminal` from projection.ending so fog never shows on a live save",
  );
  assert.match(
    types,
    /candidates: input\.projection\.whatMightHaveBeen/,
    "whatMightHaveBeenProps must forward the projected unreached candidates",
  );
  assert.match(
    types,
    /onFork: input\.onFork \?\? input\.onOpenEndings \?\? noop/,
    "Fork must prefer the dedicated fork handler, falling back to the legacy See-map wire",
  );
  assert.match(
    types,
    /onBeginAgain: input\.onBeginAgain \?\? input\.onReturnHome \?\? noop/,
    "Begin again must prefer the dedicated fresh-run handler, falling back to return-home",
  );

  // All five layouts must mount the surface at the ending render site so the
  // fog appears regardless of the reader's chosen layout.
  for (const layout of ["Book", "Mobile", "ModernApp", "GraphicNovel", "Journal"]) {
    const src = read(`components/reading/layouts/${layout}.tsx`);
    assert.match(
      src,
      /import \{ WhatMightHaveBeen \} from "\.\.\/WhatMightHaveBeen";/,
      `${layout} must import WhatMightHaveBeen`,
    );
    assert.match(
      src,
      /<WhatMightHaveBeen\s+\{\.\.\.whatMightHaveBeenProps\(\{ projection, onOpenEndings, onReturnHome, onFork, onBeginAgain \}\)\}/,
      `${layout} must mount WhatMightHaveBeen with the shared prop bag (incl. the dedicated handlers)`,
    );
    // It sits inside the same terminal-only branch as EndingPanel — the
    // `projection.ending ? (…) : <ChoiceList/>` conditional — so a pre-terminal
    // turn renders the choices, never the fog.
    const endingBranch = src.slice(src.indexOf("projection.ending ?"));
    assert.ok(
      endingBranch.indexOf("<WhatMightHaveBeen") < endingBranch.indexOf("<ChoiceList"),
      `${layout} must render WhatMightHaveBeen in the terminal branch, before the ChoiceList fallback`,
    );
  }
});

test("path map fogs a terminal save's unreached candidates as EndingsMap ghosts", () => {
  const src = read("app/map/[saveId]/index.tsx");
  assert.match(src, /getRemoteCurrentScene\(/, "map route must fetch the current scene for the ending projection");
  assert.match(
    src,
    /whatMightHaveBeenCards\(scene\.ending\?\.whatMightHaveBeen, \{\s*terminal: Boolean\(scene\.terminal\),/,
    "map route must derive ghosts terminal-gated from the scene ending (BC10)",
  );
  assert.match(
    src,
    /\{\.\.\.\(ghostCandidates\.length > 0 \? \{ ghostCandidates \} : \{\}\)\}/,
    "map route must pass ghostCandidates only when present (BC4)",
  );
});

test("profile screen shows the librarian rank chip + keepsakes shelf", () => {
  const src = read("app/profile/index.tsx");
  assert.match(src, /librarianRankChipLabel\(librarianRank\)/, "profile must show the rank chip");
  assert.match(src, /librarianRankProgressLine\(librarianRank\)/, "profile must show the rank progress line");
  assert.match(src, /keepsakes\.length > 0/, "profile must render a keepsakes shelf when non-empty");
});

test("act-mementos: useAccountProfile adapts rankProgress + mementos beside the rank/keepsakes adapters", () => {
  const src = read("hooks/useAccountProfile.ts");
  assert.match(src, /adaptRankProgress,/, "must import the rankProgress adapter");
  assert.match(src, /adaptMementos,/, "must import the mementos adapter");
  assert.match(
    src,
    /rankProgress: adaptRankProgress\(remoteW3\?\.rankProgress\)/,
    "must expose the adapted rankProgress (null-for-absent → optional)",
  );
  assert.match(
    src,
    /mementos: adaptMementos\(remoteW3\?\.mementos\)/,
    "must expose the adapted mementos shelf model",
  );
});

test("act-mementos: profile screen renders the rank ticker (gated) + mounts MementoShelf below keepsakes", () => {
  const src = read("app/profile/index.tsx");
  // The ticker is gated on rankProgress so the top tier keeps today's totals
  // line unchanged (R3.3).
  assert.match(src, /rankProgress \? \(/, "ticker must render only when rankProgress is present");
  assert.match(src, /rankTickerLine\(rankProgress\)/, "profile must render the rank ticker line");
  // The shelf mounts AFTER the keepsakes shelf block and BEFORE archetypes.
  assert.match(src, /<MementoShelf mementos=\{mementos\}/, "profile must mount the MementoShelf");
  const keepsakesIdx = src.indexOf("keepsakes.length > 0");
  const shelfIdx = src.indexOf("<MementoShelf");
  const archetypesIdx = src.indexOf("<ProfileArchetypes");
  assert.ok(keepsakesIdx > -1 && shelfIdx > -1 && archetypesIdx > -1, "all three sections present");
  assert.ok(
    keepsakesIdx < shelfIdx && shelfIdx < archetypesIdx,
    "MementoShelf must sit BELOW keepsakes (R4.1) and above archetypes",
  );
});

test("act-mementos: MementoShelf hides when empty and headers the total (R4.2)", () => {
  const src = read("components/account/MementoShelf.tsx");
  assert.match(
    src,
    /if \(mementos\.items\.length === 0\) return null;/,
    "MementoShelf must render nothing when the account has pressed none (R4.2)",
  );
  assert.match(src, /mementos\.total/, "the header must carry the lifetime total");
  assert.match(src, /mementoRelativeDate\(memento\.createdAt, now\)/, "cards must show a relative date");
  assert.match(src, /memento\.storyTitle/, "cards must show the story title");
});

test("act-mementos: ChapterEnd surfaces the two act-boundary lines ONLY with an act stamp (R3.4, BC9)", () => {
  const src = read("components/reading/ChapterEnd.tsx");
  assert.match(src, /mementoLine\?: string;/, "ChapterEnd must accept the optional mementoLine prop");
  assert.match(src, /rankTickerLine\?: string;/, "ChapterEnd must accept the optional rankTickerLine prop");
  // Both lines are gated on `actStamp &&`, so a non-act boundary (no stamp)
  // renders exactly as before — zero layout shift / byte-identical.
  assert.match(
    src,
    /actStamp && mementoLine \? \(/,
    "the memento line must render only alongside an act stamp",
  );
  assert.match(
    src,
    /actStamp && rankTickerLine \? \(/,
    "the ticker line must render only alongside an act stamp",
  );
});

test("act-mementos: ReaderScreen builds the boundary lines conditional-spread beside actStampProps (AM5)", () => {
  const src = read("components/reading/ReaderScreen.tsx");
  assert.match(
    src,
    /function actBoundaryLineProps\(/,
    "ReaderScreen must define the conditional-spread builder beside actStampProps",
  );
  // Empty object when there's no stamp → props omitted, never `undefined` (BC4).
  assert.match(src, /if \(!stamp\) return \{\};/, "builder must return {} without an act stamp");
  assert.match(
    src,
    /mementoLine: mementoStampLine\(\)/,
    "builder must source the memento acknowledgement from the pure helper",
  );
  assert.match(
    src,
    /\.\.\.\(rankProgress \? \{ rankTickerLine: rankTickerLine\(rankProgress\) \} : \{\}\)/,
    "builder must conditional-spread the ticker from the cached rankProgress (BC4, no new polling)",
  );
  // Sourced from the already-fetched profile hook — no new query.
  assert.match(
    src,
    /useAccountProfile\(\);/,
    "ReaderScreen must reuse the existing useAccountProfile call",
  );
  assert.match(src, /claimWithEmail, rankProgress/, "rankProgress must come from the existing hook destructure");
  assert.match(
    src,
    /\{\.\.\.actBoundaryLineProps\(/,
    "the ChapterEnd mount must spread the boundary-line builder",
  );
});

test("home screen renders DailyCard from a fetched today row", () => {
  const src = read("app/index.tsx");
  assert.match(src, /import \{ DailyCard \}/, "home must import DailyCard");
  assert.match(src, /getRemoteDailyToday\(/, "home must fetch today's Daily");
  assert.match(src, /<DailyCard/, "home must render DailyCard");
  assert.match(src, /startRemoteDaily\(/, "home must wire startDaily into the card");
});
