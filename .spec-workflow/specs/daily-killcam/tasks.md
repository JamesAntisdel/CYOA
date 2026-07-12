# Tasks — Daily Killcam

Execution: one wave, a parallel agent team with disjoint file ownership + an
integrator. Every agent MUST read story-engagement `design.md` §0 (BC1–BC10)
and daily-killcam `design.md` §0 (DK1–DK6) before its first edit. Requirement
ids (R1–R4) refer to this spec's `requirements.md`; design section refs
(§1–§7) to this spec's `design.md`. Merge gate: full monorepo typecheck + full
test suite green, then dockerized deploy (`docker compose restart convex` /
`restart app`).

Conventions for every task: recording/pulse failures degrade to "no chip",
never a turn failure (BC5), pure logic stays in `convex/daily.ts` (BC6),
schema + `game.ts` wiring are integrator-owned (BC7 / DK1), conditional
spread + `cleanDoc` (BC4), full function paths in client strings (BC1).

---

## Agent DK-PURE — owns `convex/daily.ts` + `convex/tests/daily.test.ts`

- [ ] 1.1 Choice-key derivation + constants + phrase table (R1.2, R2.4, R4.1)
  Add `KILLCAM_TURN_CAP`, `KILLCAM_MIN_READERS`, `FREE_FORM_KEY`,
  `choiceKeyForLabel`, and `pulsePhrase` per design §1.2, with the rationale
  comments R4.1 demands beside the constants. Keep the module's BC6 header
  contract (no Date.now / Math.random / console). Tests: normalization
  matrix, empty/unicode labels, clamp at 64, tier boundaries, free-form
  override.
  - _Leverage: `convex/daily.ts:1-16` (pure-module header discipline), `packages/engine` slugify via existing daily imports, `convex/daily.ts:185` (rounding style to mirror)_
  - _Requirements: R1.2, R2.4, R4.1_
  - _Prompt: Implement the task for spec daily-killcam, first run spec-workflow-guide to get the workflow guide then implement the task: Role: TypeScript developer versed in pure, total functions. Task: add the killcam constants, choiceKeyForLabel, and the pulsePhrase tier table to convex/daily.ts exactly per design section 1.2. Restrictions: module stays pure per its own header (BC6); never throw on malformed labels — degrade to the free-form key; copy strings live in ONE exported table. Success: vitest table-driven suite green covering every normalization and tier boundary. Mark the task [-] in tasks.md when starting, log with log-implementation when done, then mark [x]._

- [ ] 1.2 `computeChoicePulse` aggregation (R2.1, R2.2, R2.3)
  Implement `computeChoicePulse` per design §1.2: group the day's rows per
  turn, find the reader's bucket, emit `PulseEntry` with server-rounded
  `sharePct` (mirror `computeDistribution` rounding, `daily.ts:185`), drop
  turns under `KILLCAM_MIN_READERS`, sort by `turnNumber`. Pure and
  deterministic. Tests: threshold boundary at exactly 10, rounding parity,
  reader row with no aggregate match, multi-turn ordering.
  - _Leverage: `convex/daily.ts:185-231` (computeDistribution grouping + rounding pattern)_
  - _Requirements: R2.1, R2.2, R2.3_
  - _Prompt: Implement the task for spec daily-killcam, first run spec-workflow-guide to get the workflow guide then implement the task: Role: TypeScript developer versed in pure aggregation logic. Task: implement computeChoicePulse per design section 1.2, mirroring computeDistribution's grouping and Math.round discipline. Restrictions: pure over its inputs; output contains ONLY the reader's own bucket per turn — no foreign bucket keys or counts ever leave the function (BC10); turns under the reader floor are omitted, not zeroed. Success: table-driven tests cover the full threshold/rounding/ordering matrix. Mark [-] when starting, log-implementation when done, then [x]._

## Agent DK-SERVER — owns `convex/dailyFunctions.ts`, `convex/saves.ts` touch point, `convex/tests/dailyFunctions.test.ts`

- [ ] 2.1 Recording + rewind helpers (R1.1–R1.6)
  Export `recordDailyChoiceIfEligible` and `deleteDailyChoicesFromTurn` from
  `convex/dailyFunctions.ts` as PLAIN helpers (the
  `insertDailyResultIfAbsent` pattern, `dailyFunctions.ts:388` — the
  integrator wires game.ts, DK1). Eligibility gates (daily save, llm-driven,
  turn ≤ cap, choice present), `choiceKeyForLabel`, upsert by
  (`dailyId`, `accountId`, `turnNumber`) with the other-`saveId` fork no-op
  (DK6), `cleanDoc` inserts, `daily.choice_recorded` analytics via
  `insertDailyAnalytics`, all failure paths swallowed. Fake-ctx tests per
  design §7.
  - _Leverage: `convex/dailyFunctions.ts:388-422` (insertDailyResultIfAbsent template), `:459-484` (insertDailyAnalytics), `convex/lib/docs.ts` (cleanDoc)_
  - _Requirements: R1.1, R1.2, R1.3, R1.4, R1.5, R1.6_
  - _Prompt: Implement the task for spec daily-killcam, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Convex backend developer. Task: build the recording and rewind-deletion helpers per design section 2, copying the insertDailyResultIfAbsent skeleton. Restrictions: helpers never throw out of themselves (a killcam failure must never fail a turn — R1.1); do NOT edit game.ts (RESERVED — report the two llm-driven call sites from DK1 to the integrator); never store free-form typed text (DK4). Success: fake-ctx tests cover insert/upsert/fork-no-op/cap-no-op/rewind-delete/swallowed-throw plus the analytics payload. Mark [-] when starting, log-implementation when done, then [x]._

- [ ] 2.2 `getChoicePulse` query + projection widening (R2, R3.3)
  Register `dailyFunctions:getChoicePulse` per design §2 flow (authorize like
  `getResults`, bounded index reads, `computeChoicePulse`). Widen
  `projectLlmDrivenScene` (`convex/saves.ts:592`) with optional `dailyId`
  via conditional spread (BC4/BC9). Extend the BC10 projection spoiler test:
  `dailyId` present on daily saves, absent otherwise, no other new keys.
  Fake-ctx tests: authorization, own-bucket-only response (assert no foreign
  keys/labels), threshold omission, post-claim resolution (DK3).
  - _Leverage: `convex/dailyFunctions.ts:169-207` (getResults authorization + shape), `convex/saves.ts:592` (projection choke point), existing projection spoiler tests_
  - _Requirements: R2.1, R2.2, R2.3, R2.5, R3.3_
  - _Prompt: Implement the task for spec daily-killcam, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Convex backend developer who owns read-path spoiler discipline. Task: register getChoicePulse and widen the scene projection with dailyId per design sections 2 and 3. Restrictions: queries are read-only — no analytics writes (DK2); the response carries ONLY the reader's own bucket entries (BC10 test mandatory); projection widening is conditional-spread, legacy saves byte-identical (BC9). Success: fake-ctx suite green including the post-claimGuest resolution test and the no-foreign-data assertion. Mark [-] when starting, log-implementation when done, then [x]._

## Agent DK-CLIENT — owns `apps/app/lib/dailyApi.ts`, `apps/app/components/daily/**`, ReaderScreen mount, client tests

- [ ] 3.1 Transport + render model (R2.3, R3.4)
  Add `getChoicePulse` to `dailyApi.ts` with the full BC1 path string, a
  tolerant adapter (malformed → empty array, `adaptDailyToday` discipline),
  and the pure `pulseChipLabel` render model with copy scoped to "today's
  readers" (R3.4). Extend `lib/__tests__/dailyApi.test.ts`.
  - _Leverage: `apps/app/lib/dailyApi.ts:22-100` (transport + adapter + BC notes pattern), `apps/app/lib/__tests__/dailyApi.test.ts`_
  - _Requirements: R2.3, R3.4_
  - _Prompt: Implement the task for spec daily-killcam, first run spec-workflow-guide to get the workflow guide then implement the task: Role: client transport developer. Task: add the getChoicePulse wrapper, tolerant adapter, and pulseChipLabel per design section 3. Restrictions: path string is the FULL "dailyFunctions:getChoicePulse" (BC1); the client renders sharePct verbatim — no percentage math client-side (DK5); pure helpers import nothing from React Native. Success: vitest covers adapter tolerance and label copy. Mark [-] when starting, log-implementation when done, then [x]._

- [ ] 3.2 `DailyPulseChip` + `OpeningForks` surfaces (R3.1, R3.2)
  Build the two components per design §4 and mount them: the chip in
  ReaderScreen's story-engagement strip (beside `ThreadsPill`,
  `ReaderScreen.tsx:417-425`), gated on `projection.dailyId`; the
  OpeningForks strip inside `DailyResults` above the ending distribution.
  Both self-hide with zero layout shift. `RemoteScene` gains the optional
  `dailyId` field (adapter side of 2.2's widening). Node/vitest tests for the
  join/hide logic.
  - _Leverage: `apps/app/components/reading/ReaderScreen.tsx:415-426` (ThreadsPill mount + self-hide pattern), `apps/app/components/daily/DailyResults.tsx`, `apps/app/hooks/useTurn.ts` (RemoteScene + choice history labels)_
  - _Requirements: R3.1, R3.2, R3.3_
  - _Prompt: Implement the task for spec daily-killcam, first run spec-workflow-guide to get the workflow guide then implement the task: Role: React Native client developer on the reading surface. Task: build DailyPulseChip and OpeningForks per design section 4 and mount both. Restrictions: chip attaches only to the reader's own committed choice and renders null when the save is not a daily, the pulse is empty, or the turn is uncommitted (R3.1); fetch once per completed-turn change, no interval polling; book-voice copy from pulseChipLabel only. Success: node/vitest tests cover hide states and the label/entry join; surfaces verified in the app against a seeded pulse. Mark [-] when starting, log-implementation when done, then [x]._

## INTEGRATOR — owns reserved files (`convex/schema.ts`, `convex/index.ts`, `convex/crons.ts`) + `convex/game.ts` wiring

- [ ] 4.1 Schema + game.ts call sites + lifecycle (R1.1, R1.4, BC7, DK1)
  Add `daily_choice_results` per design §1.1 (three indexes; decide the
  account-purge path per design §5 — an additional accountId-leading index is
  acceptable). Wire `recordDailyChoiceIfEligible` at BOTH llm-driven
  turn_history sites (`game.ts:4027`, `:4521`) and
  `deleteDailyChoicesFromTurn` in the rewind plan (`game.ts:850-902`). Add
  the `deleteAccount` purge + `exportAccount` bundle lines
  (`accountFunctions.ts:154`, `:124`). Then: full monorepo typecheck + all
  suites + dockerized deploy as the merge gate.
  - _Leverage: `convex/schema.ts:481` (daily_results template), `convex/game.ts:4027+4521` (DK1 sites), `convex/accountFunctions.ts:154-216` (deleteAccount deleteByIndex pattern)_
  - _Requirements: R1.1, R1.4, R1.5, NFR Security_
  - _Prompt: Implement the task for spec daily-killcam, first run spec-workflow-guide to get the workflow guide then implement the task: Role: integrator with sole ownership of reserved files and game.ts. Task: land the daily_choice_results table, wire both recording call sites plus the rewind deletion, and close the account-lifecycle loop per design sections 1, 2, and 5. Restrictions: additive edits only to reserved files; both DK1 sites wired in the same commit — a single-site wire is a silent half-count bug; nothing merges until typecheck + full suites are green. Success: dockerized deploy healthy; a fresh daily run writes rows for turns 1–3 and a rewind removes them. Mark [-] when starting, log-implementation when done, then [x]._

- [ ] 4.2 Live verification + telemetry baseline (R2, R3)
  On cyoa-local: seed ≥10 daily runs (script or fake-ctx seeding into
  `daily_choice_results` is acceptable for the floor), play a fresh daily,
  verify the chip appears after turns 1–3 with server-computed percentages,
  the OpeningForks strip renders on the results screen, sub-threshold turns
  stay silent, and `daily.choice_recorded` events land in `analytics_events`.
  Record the day's bucket-spread (distinct choiceKeys per turn) in the
  implementation log as the honesty baseline for the turn-cap decision.
  - _Leverage: BC8 deploy flow, `dailyFunctions:mintDailyTale` date override for backfills, operator analytics queries_
  - _Requirements: R2.2, R3.1, R3.2, R4.1_
  - _Prompt: Implement the task for spec daily-killcam, first run spec-workflow-guide to get the workflow guide then implement the task: Role: release verifier. Task: drive the daily killcam loop end to end on the dockerized cyoa-local env and capture the baseline. Restrictions: verify through real play for the reader-facing half (streamed turns, real chip render), seeding only to cross the 10-reader floor; do not ship if any killcam failure surfaces to the reader. Success: documented run with screenshots/event samples and the bucket-spread baseline recorded in the implementation log. Mark [-] when starting, log-implementation when done, then [x]._
