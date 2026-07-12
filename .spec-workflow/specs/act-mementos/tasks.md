# Tasks — Act Mementos

Execution: one wave, a parallel agent team with disjoint file ownership + an
integrator. Every agent MUST read story-engagement `design.md` §0 (BC1–BC10)
and act-mementos `design.md` §0 (AM1–AM6) before its first edit. Requirement
ids (R1–R4) refer to this spec's `requirements.md`; design section refs
(§1–§7) to this spec's `design.md`. Merge gate: full monorepo typecheck +
full test suite green, then dockerized deploy (`docker compose restart
convex` / `restart app`).

Conventions for every task: mint failures degrade silently — never a turn
failure (BC5), engine purity (BC6), optional fields + legacy self-hide
(BC9), conditional spread + `cleanDoc` (BC4/AM5), schema + `game.ts` wiring
are integrator-owned (BC7/AM1).

---

## Agent AM-ENGINE — owns `packages/engine/src/rank.ts` + engine tests

- [ ] 1.1 `rankProgress` helper (R3.1)
  Add the `RankProgress` type and pure `rankProgress` per design §1.3: next
  tier above the current in `TIERS` order, zero-floored per-metric deficits
  against that tier's own thresholds, null at the top tier. `TIERS` stays
  module-private (AM6). Report the barrel export need to the integrator
  (BC7). Tests: full tier-pair walk including the non-monotonic threshold
  cases, garbage-metric flooring, top-tier null.
  - _Leverage: `packages/engine/src/rank.ts:37-74` (TIERS + librarianRank walk + floorMetric), existing rank tests_
  - _Requirements: R3.1_
  - _Prompt: Implement the task for spec act-mementos, first run spec-workflow-guide to get the workflow guide then implement the task: Role: TypeScript engine developer versed in pure, total functions. Task: implement rankProgress in packages/engine/src/rank.ts exactly per design section 1.3. Restrictions: engine stays pure (BC6); do NOT export TIERS (AM6); never throw — reuse floorMetric semantics for inputs. Success: vitest table-driven suite green over every adjacent tier pair, the non-monotonic beats/tales thresholds, and the top-tier null. Mark the task [-] in tasks.md when starting, log with log-implementation when done, then mark [x]._

## Agent AM-PURE — owns `convex/mementos.ts` (new) + its vitest suite

- [ ] 2.1 `deriveActMemento` + mint helper (R1.1–R1.5, R2.1)
  Create `convex/mementos.ts` mirroring the `keepsakes.ts` layout: the
  `Memento` type, `deriveActMemento` (total; actLabel/beatLabel fallbacks per
  AM2; clamps label ≤80 / description ≤160; roman numerals matching
  ChapterEnd's actRoman), the `MEMENTO_GRANTED` constant, and the exported
  `mintActMementoIfDue` plain helper per design §2 (eligibility gates,
  `by_save_act` idempotence, caller-side `evaluateTextPolicy` with neutral
  fallback, `cleanDoc` insert, fire-and-forget analytics, all failures
  swallowed). Do NOT edit game.ts — report the two AM1 call sites to the
  integrator. Tests: derivation fallback matrix + fake-ctx mint matrix per
  design §7.
  - _Leverage: `convex/keepsakes.ts` (whole-file template: clamps, caller-gates-policy contract), `convex/dailyFunctions.ts:388-422` (exported plain-helper precedent), `convex/dailyFunctions.ts:459-484` (fire-and-forget analytics)_
  - _Requirements: R1.1, R1.2, R1.3, R1.4, R1.5, R2.1_
  - _Prompt: Implement the task for spec act-mementos, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Convex backend developer who writes pure-first modules. Task: create convex/mementos.ts per design sections 1.2 and 2, mirroring keepsakes.ts discipline. Restrictions: deriveActMemento is deterministic and total — absent labels fall back, never wait (AM2); the mint helper never throws out of itself (R1.5) and never runs an LLM call; game.ts is RESERVED — report call sites only. Success: vitest covers the derivation matrix and the fake-ctx mint matrix including idempotent re-cross and policy-block fallback. Mark [-] when starting, log-implementation when done, then [x]._

## Agent AM-SERVER — owns `convex/accountFunctions.ts` + its tests

- [ ] 3.1 Profile projection: `rankProgress` + `mementos` (R2.3, R2.4, R3.2)
  Widen `getProfile` per design §3: compute `rankProgress` from the SAME
  `librarianRank` result `buildProfileMetaAdditions` already produces (AM3),
  read the newest 12 mementos via `by_accountId` plus a total count, and
  emit both null-for-absent. Add the `deleteAccount` purge line and the
  `exportAccount` bundle inclusion. Fake-ctx tests: chip/ticker parity
  (AM3), the 12-cap + total, null emissions, purge, export, post-claim
  resolution (R2.2), and save-deletion leaving mementos intact (R2.1).
  - _Leverage: `convex/accountFunctions.ts:34-102` (getProfile + buildProfileMetaAdditions), `:154-216` (deleteAccount deleteByIndex pattern), `:124-132` (exportAccount)_
  - _Requirements: R2.2, R2.3, R2.4, R3.2_
  - _Prompt: Implement the task for spec act-mementos, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Convex backend developer who owns the account surface. Task: widen getProfile with rankProgress and the capped mementos projection and close the lifecycle loop, per design sections 2, 3, and 5. Restrictions: rankProgress derives from the exact librarianRank value already computed — no second metric count (AM3); queries stay read-only (AM4); emit null-for-absent, never undefined fields (BC2/BC4). Success: fake-ctx suite green including parity, cap, purge, export, claim-survival, and save-deletion-survival tests. Mark [-] when starting, log-implementation when done, then [x]._

## Agent AM-CLIENT — owns `apps/app/lib/storyEngagementW3.ts`, `apps/app/hooks/useAccountProfile.ts`, `apps/app/components/account/MementoShelf.tsx` (new), `apps/app/app/profile/index.tsx`, `apps/app/components/reading/ChapterEnd.tsx` + ReaderScreen prop wiring, client tests

- [ ] 4.1 Adapters + render helpers (R3.3, R4.1)
  Adapt the two new `getProfile` fields in `useAccountProfile` (null →
  optional, beside `adaptLibrarianRank`, `useAccountProfile.ts:328`) and add
  the pure `rankTickerLine` / `mementoStampLine` helpers to
  `storyEngagementW3.ts` per design §3. Tests: adapter tolerance for absent
  fields, ticker copy matrix (single metric, multi metric, pluralization).
  - _Leverage: `apps/app/hooks/useAccountProfile.ts:320-335` (adapter seam), `apps/app/lib/storyEngagementW3.ts:146-161` (rank chip/progress-line helpers + tests)_
  - _Requirements: R3.3, R4.1_
  - _Prompt: Implement the task for spec act-mementos, first run spec-workflow-guide to get the workflow guide then implement the task: Role: client data-layer developer. Task: add the profile adapters and the pure ticker/memento copy helpers per design section 3. Restrictions: pure helpers import nothing from React Native; absent server fields become absent optionals via conditional spread (BC2/BC4); ticker copy lists only non-zero deficits. Success: vitest covers the copy matrix and adapter tolerance. Mark [-] when starting, log-implementation when done, then [x]._

- [ ] 4.2 Profile ticker + Mementos shelf (R3.3, R4)
  Render the ticker line under the rank chip in `profile/index.tsx` (only
  when `rankProgress` is present; top tier unchanged) and build + mount
  `MementoShelf` BELOW the keepsakes shelf per design §4: quiet cards,
  header with total, null render when empty (R4.2). Keepsakes shelf and
  TrophyCrypt untouched (R4.1). Node/vitest tests for hide states.
  - _Leverage: `apps/app/app/profile/index.tsx:45-53` (rank block), existing keepsake shelf rendering in the profile screen, `apps/app/components/endings/TrophyCrypt.tsx` (card style reference — do not modify)_
  - _Requirements: R3.3, R4.1, R4.2, R4.3_
  - _Prompt: Implement the task for spec act-mementos, first run spec-workflow-guide to get the workflow guide then implement the task: Role: React Native client developer on the account surface. Task: mount the rank ticker and the MementoShelf per design section 4. Restrictions: mementos render BELOW keepsakes with smaller visual weight — the hierarchy IS the requirement (R4.1); empty shelf renders nothing (R4.2); no changes to keepsake or crypt components. Success: node/vitest hide-state tests green; profile verified visually with and without mementos. Mark [-] when starting, log-implementation when done, then [x]._

- [ ] 4.3 ChapterEnd act-boundary lines (R3.4)
  Add optional `mementoLine` / `rankTickerLine` props to `ChapterEnd`
  (rendered under the act `Stamp`, hidden when absent) and build them in
  ReaderScreen ONLY when `actStampFromDiffs` returns a stamp, via a
  conditional-spread builder beside `actStampProps` (AM5), sourcing the
  ticker from the already-fetched profile. Tests: props render only with an
  act stamp; non-act boundaries byte-identical to today.
  - _Leverage: `apps/app/components/reading/ChapterEnd.tsx:29-30` (optional act props), `apps/app/components/reading/ReaderScreen.tsx:104-109` (actStampProps builder) and `:459-461` (mount), `apps/app/lib/storyEngagement.ts:239` (actStampFromDiffs)_
  - _Requirements: R3.4_
  - _Prompt: Implement the task for spec act-mementos, first run spec-workflow-guide to get the workflow guide then implement the task: Role: React Native client developer on the reading surface. Task: thread the two optional act-boundary lines into ChapterEnd per design section 4. Restrictions: both props are conditional-spread optionals (AM5) — undefined is never passed; the lines appear ONLY alongside an act stamp; no new polling — reuse the profile data the app already fetches. Success: tests prove act boundaries show the lines and plain chapter boundaries render exactly as before. Mark [-] when starting, log-implementation when done, then [x]._

## INTEGRATOR — owns reserved files (`convex/schema.ts`, `convex/index.ts`, `convex/crons.ts`) + `convex/game.ts` wiring

- [ ] 5.1 Schema + game.ts mint sites + barrel (R1.1, BC7, AM1)
  Add the `mementos` table per design §1.1 (both indexes) and any barrel
  exports agents reported. Wire `mintActMementoIfDue` at BOTH
  turn-application paths — streaming `completeSceneStream` (beside the
  `act_advanced` chapter-cinematic trigger, `game.ts:2106-2113`) and the
  non-streaming mirror (`:4421-4427`) — passing the arc, fired-beat label,
  and story title already in scope. Then: full monorepo typecheck + all
  suites + dockerized deploy as the merge gate.
  - _Leverage: `convex/schema.ts:255` (endings_unlocked as the account-scoped template), `convex/game.ts:2106-2113` + `:4421-4427` (AM1 sites), `convex/game.ts` recordEndingUnlock call sites (same-mutation best-effort precedent)_
  - _Requirements: R1.1, R1.2, R1.4_
  - _Prompt: Implement the task for spec act-mementos, first run spec-workflow-guide to get the workflow guide then implement the task: Role: integrator with sole ownership of reserved files and game.ts. Task: land the mementos table and wire the mint helper at both AM1 sites per design sections 1 and 2. Restrictions: additive edits only to reserved files; both call sites in the same commit — a single-site wire silently halves minting; the helper call is best-effort and must not reorder or block the existing terminal/cinematic logic. Success: dockerized deploy healthy; typecheck + full suites green. Mark [-] when starting, log-implementation when done, then [x]._

- [ ] 5.2 Live verification (R1, R2, R3)
  On cyoa-local: play a fresh llm save across an act boundary and verify the
  memento row, the `memento.granted` event, the ChapterEnd lines, the
  profile shelf + ticker; rewind past the boundary and re-cross (no
  duplicate); delete the save (memento survives — R2.1); confirm a legacy
  arc-less save renders ChapterEnd exactly as before. Record the
  first-session-durable-reward observation (turn number of the first
  memento) in the implementation log as the activation baseline.
  - _Leverage: BC8 deploy flow, operator dashboard / analytics_events queries_
  - _Requirements: R1.2, R2.1, R3.3, R3.4, NFR Reliability_
  - _Prompt: Implement the task for spec act-mementos, first run spec-workflow-guide to get the workflow guide then implement the task: Role: release verifier. Task: drive the full memento + ticker loop on the dockerized cyoa-local env. Restrictions: verify through real play (streamed turns), including the rewind re-cross and save-deletion durability checks; do not ship if a mint failure surfaces to the reader in any form. Success: documented run with row/event samples and the first-memento turn number recorded in the implementation log. Mark [-] when starting, log-implementation when done, then [x]._
