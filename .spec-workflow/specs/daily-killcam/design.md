# Design — Daily Killcam

Companion to `requirements.md` (R1–R4) and `tasks.md`. Audience: the agent
team implementing the spec. Inherits story-engagement `design.md` §0 BUILD
CORRECTIONS (BC1–BC10) wholesale — read them first. Spec-specific corrections
below encode what a fresh code audit (2026-07-11) actually found.

---

## 0. SPEC-SPECIFIC BUILD CORRECTIONS (authoritative)

- **DK1 — There are THREE `turn_history` insert sites, and llm-driven turns
  have exactly ONE live one.** Grep `ctx.db.insert("turn_history"` in
  `convex/game.ts` and it lands three times: the deterministic/authored engine
  path (`provider: "deterministic"`, inside the scripted/free-form turn
  handler, ~`game.ts:1545`), and two llm-driven paths —
  `runLlmDrivenBeginStreaming` (the streaming-begin insert, ~`game.ts:4340`,
  the choice is already committed there) and `runLlmDrivenSubmitChoice`
  (~`game.ts:4855`). The second llm-driven site is DEAD CODE as of commit
  `be57970`: its own header reads `@deprecated DEAD CODE — do not re-wire`
  (`game.ts:4422`) because running `router.generateScene` inside a mutation
  crashes real providers, so the `submitChoice` action now routes every
  non-streaming llm-driven turn back through the same streaming flow. The LIVE
  llm-driven turn path is streaming ONLY. Daily saves are llm-driven, so
  killcam recording rides the SINGLE live site — `runLlmDrivenBeginStreaming`
  — and MUST NOT be wired into dead `runLlmDrivenSubmitChoice` (wiring it
  there is inert today and a landmine when the dead helper is deleted). Follow
  the established daily precedent: recording is an EXPORTED plain helper in
  `convex/dailyFunctions.ts` (exactly like `insertDailyResultIfAbsent`,
  `dailyFunctions.ts:426`, whose header says "The integrator calls this from
  the game.ts terminal block (RESERVED — do NOT edit game.ts)"). Agents ship
  the helper + tests; the integrator wires the one live call site (and drops
  it whenever the dead `runLlmDrivenSubmitChoice` cleanup lands).
- **DK2 — Convex queries are read-only.** `getChoicePulse` cannot insert
  analytics rows. `daily.choice_recorded` fires from the turn mutation via
  the recording helper (the `insertDailyAnalytics` pattern,
  `dailyFunctions.ts:661`); there is NO pulse-shown server event.
- **DK3 — Attach-on-claim is free; do not build a migration.** `claimGuest`
  (`convex/accountFunctions.ts:134-152`) PATCHES the same account row —
  `accountId` is stable across claim, so rows keyed by it survive
  automatically. The only work is a fake-ctx test proving it (R2.5).
- **DK4 — Free-form text never lands in killcam rows.** The reader's typed
  action is memory-window material (`turn_history.choiceLabel`,
  `schema.ts:229`), not aggregation material. The recording helper maps
  free-form turns to the reserved `free-form` key BEFORE anything touches the
  row (R1.2).
- **DK5 — Percentages are server-computed.** `dailyApi.ts:48` already pins
  this for the ending distribution ("server-computed — BC10, never raw
  math"); the pulse follows suit. The client renders `sharePct` verbatim.
- **DK6 — One reader, one vote, keyed by account not save.** The upsert key
  is (`dailyId`, `accountId`, `turnNumber`) — `hasPlayedDaily`
  (`dailyFunctions.ts:635`) guards one STARTED run per day, but forks of a
  daily save can carry `dailyId` too. Storing `saveId` on the row and
  refusing to overwrite a row whose `saveId` differs (R1.3) makes fork
  double-votes structurally impossible.

## 1. Data model

### 1.1 New table `daily_choice_results` (integrator-owned, BC7)

Copy the `daily_results` shape discipline (`convex/schema.ts:481`) — a small
per-reader side table:

```ts
daily_choice_results: defineTable({
  dailyId: v.string(),        // daily_tales row id (string form, like daily_results)
  accountId: v.id("accounts"),
  saveId: v.id("saves"),      // the run that voted — fork-dedupe anchor (DK6)
  turnNumber: v.number(),     // 1..KILLCAM_TURN_CAP
  choiceKey: v.string(),      // normalized label slug ≤64, or "free-form"
  freeForm: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_daily_turn", ["dailyId", "turnNumber"])        // aggregation read
  .index("by_daily_account", ["dailyId", "accountId"])       // upsert + reader rows
  .index("by_save", ["saveId"])                              // rewind deletion
  .index("by_accountId", ["accountId"])                      // deleteAccount purge (§5)
```

The `by_daily_account` index leads with `dailyId`, so it cannot front an
account-only scan; the fourth `by_accountId` index is required for
`deleteAccount` (§5) and is settled here — not an integrator judgment call.

No `saves.state` changes, no engine changes — this feature is entirely
convex + client (the engine never sees other readers).

### 1.2 Pure additions to `convex/daily.ts` (same BC6 header discipline)

```ts
export const KILLCAM_TURN_CAP = 3;      // R4.1 — opening forks only
export const KILLCAM_MIN_READERS = 10;  // R4.1 — silence under the floor
export const FREE_FORM_KEY = "free-form";

// R1.2 — trim/lowercase/collapse/strip-punctuation/slugify/clamp(64).
// Returns FREE_FORM_KEY when freeForm or the normalized label is empty.
export function choiceKeyForLabel(label: string, freeForm: boolean): string;

export type PulseEntry = {
  turnNumber: number;
  sharePct: number;     // 0-100, Math.round — mirrors computeDistribution
  sameCount: number;
  totalReaders: number;
  phrase: string;       // R2.4 tier table
};

// R2 — reader's own bucket per turn; drops turns under KILLCAM_MIN_READERS.
// readerRows: this account's rows (≤3); allRows: the day's rows for the
// relevant turn numbers. Pure, deterministic, total.
export function computeChoicePulse(
  readerRows: readonly { turnNumber: number; choiceKey: string }[],
  allRows: readonly { turnNumber: number; choiceKey: string }[],
): PulseEntry[];

// R2.4 — table-driven copy. free-form always "wrote their own page";
// 60+ "the well-worn path"; 25-59 "a common thread"; else "the road less
// traveled". Single exported table so tone edits are one-line.
export function pulsePhrase(sharePct: number, freeForm: boolean): string;
```

## 2. Call flow

```
llm-driven turn application (runLlmDrivenBeginStreaming — the SINGLE live streaming-begin site, game.ts:4340; DK1)
  └─ integrator calls recordDailyChoiceIfEligible(ctx, {...}) [exported helper]
       ├─ no save.dailyId / turnNumber > KILLCAM_TURN_CAP / no choice ⇒ no-op
       ├─ choiceKeyForLabel(choiceLabel, freeForm)
       ├─ upsert by (dailyId, accountId, turnNumber):
       │    existing row with SAME saveId ⇒ patch choiceKey/freeForm/updatedAt
       │    existing row with OTHER saveId ⇒ no-op (fork guard, DK6)
       │    none ⇒ insert (cleanDoc)
       └─ insertDailyAnalytics "daily.choice_recorded"  (best-effort, DK2)

rewind mutation (rewindSaveTurns, game.ts:1086 — turn_history delete loop ~:1148)
  └─ integrator calls deleteDailyChoicesFromTurn(ctx, saveId, fromTurnNumber)
       └─ by_save rows with turnNumber ≥ fromTurnNumber deleted (R1.4)

dailyFunctions:getChoicePulse (query — args {dailyId, accountId, guestTokenHash?})
  ├─ loadAndAuthorizeAccount (same as getResults, dailyFunctions.ts:182)
  ├─ readerRows := by_daily_account(dailyId, accountId)   (≤3 rows)
  ├─ for each distinct turnNumber: allRows += by_daily_turn(dailyId, turn)
  └─ computeChoicePulse(readerRows, allRows) → { pulses: PulseEntry[] }

client
  ├─ dailyApi.getChoicePulse (BC1 full path "dailyFunctions:getChoicePulse")
  ├─ ReaderScreen: DailyPulseChip when projection.dailyId present (R3.1, R3.3)
  └─ DailyResults: OpeningForks strip above the ending distribution (R3.2)
```

## 3. Wire shapes (BC2 — adapted in `apps/app/lib/dailyApi.ts`)

Server (`getChoicePulse`) returns `pulses` as an array of
`{ turnNumber, sharePct, sameCount, totalReaders, phrase }` — no optional
fields, so the adapter only validates presence/types and tolerates a missing
projection (empty array on any malformed payload). No null-for-absent mapping
is needed; keep the `adaptDailyToday` tolerance discipline
(`dailyApi.ts:81`).

Scene projection widening (R3.3): `projectLlmDrivenScene`
(`convex/saves.ts:592`) adds optional `dailyId?: string` via conditional
spread; the `RemoteScene` type in `apps/app/lib/gameApi.ts` (grep
`type RemoteScene` ≈ :185; imported by `useTurn.ts` at :31) mirrors it as an
optional field. This is a
reader-known fact (they launched the Daily) — BC10-clean. The existing
projection spoiler test extends to assert NOTHING ELSE new is projected.

Client render model (pure, `dailyApi.ts`, vitest-covered):

```ts
export type RemotePulseEntry = PulseEntry;              // adapted 1:1
export function pulseChipLabel(entry: RemotePulseEntry): string;
// "62% of today's readers · the well-worn path" — copy scoped to "today" (R3.4)
```

## 4. Client surfaces

- **`DailyPulseChip`** (new, `apps/app/components/daily/DailyPulseChip.tsx`):
  a single `Chip`-styled line mounted in ReaderScreen's story-engagement strip
  (beside `ThreadsPill`, `ReaderScreen.tsx:417-425`) — renders the NEWEST
  pulse entry for a completed turn, self-hides when `projection.dailyId` is
  absent, the pulse is empty, or the entry's turn is not yet committed. Zero
  layout shift when hidden (same pattern as ThreadsPill's null return). Poll
  cadence: fetch once per completed turn number change — no interval timer.
- **`OpeningForks`** (new, `apps/app/components/daily/OpeningForks.tsx`):
  up to 3 tiles inside `DailyResults`, each joining the reader's own
  choice-history label (client-known) with its `PulseEntry`. Hidden when no
  entries. Tile copy: turn ordinal, the reader's label (clamped one line),
  `pulseChipLabel`.
- Both surfaces respect reduced-motion (no new animation beyond the existing
  Chip fade) and add no new routes.

## 5. Analytics + lifecycle

| event | payload | fired from |
|---|---|---|
| `daily.choice_recorded` | `dailyId`, `turnNumber`, `choiceKey`, `freeForm` | recording helper inside the turn mutation (DK2) |

Account lifecycle: `deleteAccount` (`accountFunctions.ts:154`) gains one
`deleteByIndex` line for `daily_choice_results` via the account-scoped
`by_accountId` index specified in §1.1 (the `by_daily_account` index leads
with `dailyId`, so it can't front an account-only purge). This mirrors the
`daily_results` cleanup posture and is settled in §1.1 — not an integrator
judgment call; requirements demand purge-on-delete (NFR Security).
`exportAccount` includes the rows in the bundle (same bundle-builder pattern
as `daily_results`).

## 6. Error handling

| scenario | handling |
|---|---|
| recording helper throws (index missing, race) | caught inside the helper — turn proceeds, no row (R1.1) |
| turn past cap / non-daily / authored / co-op follower | helper no-ops (R1.5) |
| fork of a daily save replays turns 1–3 | upsert sees another `saveId` ⇒ no-op (DK6) |
| rewind without re-choose | rows ≥ fromTurn deleted in the rewind mutation (R1.4) |
| under 10 readers at a turn | turn omitted from pulse — chip/tile absent (R2.2) |
| malformed pulse payload at the client | adapter returns empty array — surfaces hide (BC2) |
| guest claims account | rows keyed by stable accountId — nothing to do (DK3), test proves it |
| `daily_choice_results` table absent (deploy skew) | query throws → `convexHttp` error path → adapter empty array → surfaces hide |

## 7. Testing strategy

- **Pure (vitest, table-driven, BC6/R16.4):** `choiceKeyForLabel` matrix
  (case/whitespace/punctuation collapse, unicode, empty → `free-form`, clamp
  at 64); `computeChoicePulse` matrix (threshold boundary at exactly 10,
  rounding parity with `computeDistribution`, multi-turn, reader row with no
  matching aggregate); `pulsePhrase` tier boundaries (24/25, 59/60,
  free-form override).
- **Convex (fake-ctx):** recording helper — eligible insert, upsert-same-save
  patch, fork no-op, cap/no-daily no-ops, analytics fired, throw swallowed;
  `deleteDailyChoicesFromTurn` boundaries; `getChoicePulse` — authorization,
  own-bucket-only payload (assert NO foreign keys/labels in the response —
  the BC10 test), threshold omission, post-claim resolution (DK3).
- **Client (node/vitest):** `dailyApi` adapter tolerance, `pulseChipLabel`
  copy, OpeningForks join logic (label + entry pairing, hide-when-empty).
- **Projection:** extend the BC10 spoiler test for the `dailyId` widening —
  `dailyId` present on daily saves, absent otherwise, and no other new keys.
- **Merge gate:** full monorepo typecheck + suites green, dockerized deploy
  (`docker compose restart convex` / `restart app`) per BC8.
