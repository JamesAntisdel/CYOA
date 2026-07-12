# Design — Act Mementos

Companion to `requirements.md` (R1–R4) and `tasks.md`. Audience: the agent
team implementing the spec. Inherits story-engagement `design.md` §0 BUILD
CORRECTIONS (BC1–BC10) wholesale — read them first. Spec-specific corrections
below encode what a fresh code audit (2026-07-11) actually found.

---

## 0. SPEC-SPECIFIC BUILD CORRECTIONS (authoritative)

- **AM1 — `act_advanced` is detected at MULTIPLE turn-path sites; mint from a
  single shared helper.** The diff is emitted in the engine
  (`packages/engine/src/llm.ts:641`, `:981`) and consumed in game.ts at
  `:1895`, `:2106-2113` (streaming `completeSceneStream` — chapter-cinematic
  trigger) and `:4347`, `:4421-4427` (non-streaming mirror). Minting must be
  ONE exported helper called from BOTH turn-application paths (streaming +
  non-streaming) or the paths drift — the same class of bug SB1 documents for
  the story-bible. Follow the daily precedent: helper exported from
  `convex/mementos.ts`, integrator wires the RESERVED `game.ts` call sites.
- **AM2 — `actLabel` may be absent at mint time.** The act stamp joins
  `arc.actLabel` opportunistically (`actStampFromDiffs`,
  `apps/app/lib/storyEngagement.ts:239` — "The label (when known) rides on
  the arc summary"). Derivation MUST be total with the label absent:
  fall back to "Act N of " + story title (R1.1). Never wait, never re-mint
  when the label arrives later.
- **AM3 — The rank ticker must count from the SAME source as the rank chip.**
  `buildProfileMetaAdditions` (`convex/accountFunctions.ts:64-102`) computes
  endings from `endings_unlocked`, tales from active `published_tales`, and
  beats by summing fired beats across LIVE saves. `rankProgress` is computed
  server-side FROM THE SAME `librarianRank` result in the same query — never
  a second counting method, or chip and ticker disagree on the reader's own
  profile.
- **AM4 — Convex queries are read-only.** No analytics from `getProfile`;
  `memento.granted` fires from the turn mutation via the mint helper.
- **AM5 — ChapterEnd optional props follow the `actStampProps` pattern.**
  Conditional-spread builders returning empty objects
  (`ReaderScreen.tsx:104-109`) — never pass `undefined` props
  (`exactOptionalPropertyTypes`, BC4).
- **AM6 — `TIERS` stays module-private.** `rank.ts:34-36` declares the table
  "the single source of truth for the progression". Export the pure
  `rankProgress(rank)` helper, NOT the table — callers get progression
  answers, not progression data to re-derive.

## 1. Data model

### 1.1 New table `mementos` (integrator-owned, BC7)

Account-scoped like `endings_unlocked` (`convex/schema.ts:255`), independent
of the save row (R2.1 durability):

```ts
mementos: defineTable({
  accountId: v.id("accounts"),
  saveId: v.id("saves"),        // provenance only — row survives save deletion
  storyId: v.string(),
  act: v.number(),              // the act ENTERED (2 or 3 today)
  label: v.string(),            // ≤80, policy-gated (R1.3)
  description: v.string(),      // ≤160, policy-gated
  storyTitle: v.string(),
  dailyId: v.optional(v.string()),
  createdAt: v.number(),
})
  .index("by_accountId", ["accountId"])          // shelf read + purge
  .index("by_save_act", ["saveId", "act"])       // idempotent mint (R1.2)
```

No engine-state changes and no `saves.state` fields — the memento is derived
from data already in the turn mutation's hands (arc, diffs, story title).

### 1.2 New pure module `convex/mementos.ts` (mirror of `keepsakes.ts`)

```ts
export type Memento = {
  act: number;
  label: string;        // "Act II — The Drowned Bell Tolls" | "Act II of <title>" fallback
  description: string;  // from the just-fired beat's label, else fixed book-voice line
  storyTitle: string;
};

// R1.1 — total + deterministic; actLabel/beatLabel absent → fallbacks (AM2).
// Roman numerals via the same mapping ChapterEnd uses (actRoman).
export function deriveActMemento(input: {
  act: number;
  actLabel?: string;
  beatLabel?: string;
  storyTitle: string;
}): Memento;

export const MEMENTO_GRANTED = "memento.granted";  // R16.1 event name
```

Clamp discipline copied from `keepsakes.ts:27-34` (LABEL_MAX 80,
DESCRIPTION_MAX 160). Text policy is applied by the CALLER before persistence
(same contract as keepsakes — see the `keepsakes.ts` header).

### 1.3 Engine addition `packages/engine/src/rank.ts` (pure, AM6)

```ts
export type RankProgress = {
  nextTier: LibrarianTier;
  nextLabel: string;
  // zero-floored deficits against the next tier's thresholds
  needsEndings: number;
  needsBeats: number;
  needsTales: number;
};

// Next tier ABOVE the current one in TIERS order; null at the top ("unwritten").
// Deficits use the same floored metrics librarianRank echoed back.
export function rankProgress(rank: LibrarianRank): RankProgress | null;
```

Note the ladder is intentionally non-monotonic per metric (e.g. `archivist`
needs beats, `librarian` needs tales instead — `rank.ts:37-43`): deficits are
computed against the next tier's OWN thresholds, and a deficit of zero for a
metric simply lists nothing for it in the client line.

## 2. Call flow

```
turn application (streaming completeSceneStream AND non-streaming mirror — AM1)
  └─ integrator calls mintActMementoIfDue(ctx, {...}) [exported from convex/mementos.ts]
       ├─ no act_advanced diff / no arc / authored path / follower ⇒ no-op (R1.4)
       ├─ by_save_act(saveId, act) exists ⇒ no-op (idempotent, R1.2)
       ├─ deriveActMemento(act, arc.actLabel?, firedBeatLabel?, storyTitle)
       ├─ evaluateTextPolicy per string → blocked ⇒ neutral fallback (R1.3)
       ├─ insert mementos row (cleanDoc)
       └─ analytics "memento.granted" fire-and-forget (AM4, R1.5)

accountFunctions:getProfile (existing query)
  ├─ buildProfileMetaAdditions → librarianRank (unchanged, AM3)
  ├─ rankProgress(librarianRank)             → projection.rankProgress | null
  └─ by_accountId mementos, newest 12 + total → projection.mementos     (R2.4)

client
  ├─ useAccountProfile adapters (rankProgress, mementos — null-for-absent → optional)
  ├─ profile: ticker line under the rank chip + Mementos shelf below keepsakes
  └─ ChapterEnd: memento line + ticker line, only when actNumber is stamped (R3.4)
```

## 3. Wire shapes (BC2 — adapted in `apps/app/hooks/useAccountProfile.ts`)

`getProfile` additions (server emits null-for-absent; adapters map to
optional fields, following the existing `adaptLibrarianRank` seam at
`useAccountProfile.ts:328`):

```ts
// server projection additions
rankProgress: {
  nextTier: string; nextLabel: string;
  needsEndings: number; needsBeats: number; needsTales: number;
} | null,                       // null at top tier or legacy
mementos: {
  total: number;
  items: Array<{ act: number; label: string; description: string;
                 storyTitle: string; createdAt: number }>;
} | null,
```

Widening an existing query's RESPONSE needs no arg change (BC3 is about
args); the smoke-test string for the path is unchanged. Old clients ignore
the new fields; new clients tolerate their absence (deploy-skew safe both
ways).

Pure client render helpers in `apps/app/lib/storyEngagementW3.ts` (beside
`librarianRankProgressLine:154`):

```ts
export function rankTickerLine(progress: RemoteRankProgress): string;
// "Next: Keeper — 2 more endings" / multi-metric: "Next: The Unwritten — 12 endings · 4 tales"
export function mementoStampLine(): string;
// fixed copy: "A memento is pressed between the pages"
```

## 4. Client surfaces

- **Profile ticker (R3.3):** one `Text` line under the existing rank chip in
  `apps/app/app/profile/index.tsx:45-53`, rendered only when the adapted
  `rankProgress` is present; top tier keeps today's totals line untouched.
- **Mementos shelf (R4):** new `MementoShelf` component
  (`apps/app/components/account/MementoShelf.tsx`), mounted in the profile
  screen BELOW the keepsakes shelf. Quiet cards (smaller than keepsake
  cards): label, description, storyTitle, relative date; header "Mementos ·
  N". Renders null when the list is empty (R4.2).
- **ChapterEnd (R3.4):** two new optional props, `mementoLine?: string` and
  `rankTickerLine?: string`, rendered under the existing act `Stamp`
  (`ChapterEnd.tsx:29-30` prop block). ReaderScreen builds them ONLY when
  `actStampFromDiffs` returned a stamp, via a conditional-spread builder next
  to `actStampProps` (AM5), sourcing the ticker from `useAccountProfile`
  (already-cached profile data; no new polling loop). The memento line is
  client-fixed copy — the client does not wait on the mint (best-effort
  server-side; the acknowledgement is narrative, not a receipt).

## 5. Analytics + lifecycle

| event | payload | fired from |
|---|---|---|
| `memento.granted` | `saveId`, `storyId`, `act`, `dailyId?` | mint helper inside the turn mutation (AM4) |

Account lifecycle: `deleteAccount` (`accountFunctions.ts:154`) gains one
`deleteByIndex` line (`mementos` via `by_accountId`); `exportAccount`
(`accountFunctions.ts:124`) includes the rows in the bundle (R2.3). Save
deletion paths (rewind purge, hardcore permadeath, account save cleanup)
deliberately do NOT touch mementos — that is R2.1, enforced by a test, not
an accident.

## 6. Error handling

| scenario | handling |
|---|---|
| mint helper throws (race, missing table) | caught inside the helper — turn proceeds, no memento (R1.5) |
| `actLabel` absent at mint | "Act N of " + story title fallback (AM2); never re-minted later |
| text policy blocks a composed string | neutral fallback text persists (R1.3) — never a mint failure |
| re-crossing an act after rewind | `by_save_act` hit ⇒ no-op; original row survives (R1.2) |
| arc-less / authored / follower turn | helper no-ops (R1.4) |
| save deleted / hardcore death | memento rows untouched (R2.1) |
| guest claims account | rows keyed by stable accountId — nothing to do (R2.2), test proves it |
| profile fields absent (deploy skew / legacy) | adapters yield optional-absent → ticker and shelf self-hide (BC2/BC9) |
| top tier reached | `rankProgress` null → server emits null → ticker hides, totals line remains (R3.3) |

## 7. Testing strategy

- **Engine (vitest, table-driven, BC6/R16.4):** `rankProgress` — every tier
  pair walk, zero-floored deficits, non-monotonic thresholds (keeper →
  archivist needs beats; archivist → librarian needs tales but fewer beats),
  top tier → null, garbage metrics floored (mirror `librarianRank` tests).
- **Pure convex module (vitest):** `deriveActMemento` — label/description
  fallback matrix (AM2), clamps, roman numerals, determinism.
- **Convex (fake-ctx):** mint helper — eligible insert, idempotent re-cross,
  no-arc/authored/follower no-ops, policy-block fallback, analytics payload,
  swallowed throw; `getProfile` — rankProgress parity with the chip's
  `librarianRank` (AM3: same inputs in, consistent pair out), mementos cap at
  12 + total, null-for-absent emission; lifecycle — deleteAccount purge,
  exportAccount inclusion, save-deletion leaves rows (R2.1), post-claim
  resolution (R2.2).
- **Client (node/vitest):** `rankTickerLine` copy matrix (single/multi
  metric, pluralization), adapter tolerance for absent fields, MementoShelf
  hide-when-empty, ChapterEnd renders the two optional lines only with an
  act stamp.
- **Merge gate:** full monorepo typecheck + suites green, dockerized deploy
  (`docker compose restart convex` / `restart app`) per BC8.
