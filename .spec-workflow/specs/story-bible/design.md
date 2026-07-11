# Design — Story Bible

Companion to `requirements.md` (R1–R6) and `tasks.md`. Audience: the agent
team implementing the spec. Inherits story-engagement `design.md` §0 BUILD
CORRECTIONS (BC1–BC10) wholesale — read them first. Spec-specific corrections
below encode what a fresh code audit (2026-07-10) actually found.

---

## 0. SPEC-SPECIFIC BUILD CORRECTIONS (authoritative)

- **SB1 — Turn 1 is the SSE path, not `beginStreamingChoice`.** The opening
  scene flows `getAuthorizedSceneStreamRequest` (`convex/game.ts:1482`) →
  `convex/http.ts` stream → `completeSceneStream` (`game.ts:1614`).
  `beginStreamingChoice` (`game.ts:1123`) is turns ≥2 only. The turn-1 arc is
  persisted by `createArcForOpeningTurn` (`game.ts:2928`, called at `:1760`,
  mirrored on the non-streaming path at `:3746`). Bible attachment logic must
  live on BOTH request-assembly sites (`game.ts:1582-1585` streaming,
  `:3733-3736` non-streaming) or the two paths drift.
- **SB2 — Actions cannot touch the DB.** The bible job is an
  `internalMutation` (insert status row + `ctx.scheduler.runAfter(0, …)`)
  followed by an `actionGeneric` (LLM call) that persists through internal
  mutations — exactly the `queueEndpointCinematic` (`convex/media/
  cinematics.ts:590` → `:765` → `runOmniCinematicJob:803` →
  `_markCinematicReady:1073`) split.
- **SB3 — A module in `convex/llm/` registers with its directory.** The new
  module `convex/llm/storyBible.ts` is referenced as
  `"llm/storyBible:generateStoryBible"` in `runAfter` (BC1). Add it to the
  `convex/index.ts` barrel (integrator, BC7).
- **SB4 — The engine is the source of truth for gate processing, but it is
  pure.** Registry enforcement cannot read the DB: convex loads the bible
  row, passes a `registrySnapshot` into the engine, and the engine returns
  `registryEvents` that convex writes back to the bible row IN THE SAME
  MUTATION as the state write (R2.1). Never patch the bible row from a
  separate mutation.
- **SB5 — Token budget is cumulative and snapshot-tested.**
  `convex/tests/promptScene.test.ts:558-591` pins prompt growth (4 chars ≈ 1
  token heuristic) against the R16.5 cumulative ≤1600 cap. The digest's
  worst-case fixture must be added there; this spec's slice of the budget is
  ≤600 tokens (R3.4).
- **SB6 — `exactOptionalPropertyTypes` idiom everywhere**: conditional spread
  `...(x !== undefined ? { x } : {})` and `cleanDoc(...)` before insert
  (`game.ts:343-345`, `:422`). Never `{ bible: maybe }`.

## 1. Data model

### 1.1 New table `story_bibles` (integrator-owned, BC7)

Copy the `daily_tales` shape (`convex/schema.ts:431` stores `storyArc:
jsonValue`) — a simple per-save side table, NOT rows in `assets`:

```ts
story_bibles: defineTable({
  saveId: v.id("saves"),
  status: v.union(v.literal("queued"), v.literal("generating"),
                  v.literal("ready"), v.literal("failed")),
  bible: v.optional(jsonValue),        // validated StoryBible (absent until ready)
  attachedAtTurn: v.optional(v.number()),
  lastRefreshAct: v.optional(v.number()), // guard: ≤1 refresh per act (R6)
  retryCount: v.number(),              // ≤1 retry (R1.4)
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_saveId", ["saveId"])
```

The bible JSON is engine-typed; consumption state lives INSIDE the entries
(single source of truth, updated transactionally per SB4).

### 1.2 Engine types (`packages/engine/src/bible.ts`, new pure module)

```ts
type SurfaceBand = "early" | "mid" | "late";      // reuse beatBandForTurn bands
type KeyStatus = "planned" | "promised" | "granted" | "retired";

type BibleKey = {
  id: string;            // slug ≤48 (slugify, same as arc ids)
  label: string;         // ≤80
  opensHint: string;     // ≤120
  surfaceBand: SurfaceBand;
  status: KeyStatus;
  promisedAtTurn?: number;
  adopted?: true;        // R4.3 registry-admission keys
  seeded?: true;         // R5.1 engine-seeded via thread
};

type BibleDoor  = { id: string; label: string; keyId: string;
                    gateBand: "mid" | "late"; note: string;
                    status: "planned" | "opened" | "retired" };
type BibleCast  = { id: string; label: string; want: string;
                    secret: string; bondHint: string };
type BibleTwist = { id: string; label: string; precondition: string;
                    status: "pending" | "fired" | "retired" };
type BibleEndingHint = { endingId: string; requires: string };

type StoryBible = {
  keyRegistry: BibleKey[];        // 6–12 at generation; ≤16 after adoption
  lockPlan: BibleDoor[];          // 2–5
  cast: BibleCast[];              // 2–5
  twists: BibleTwist[];           // 2–4
  endingHints: BibleEndingHint[]; // 0–4 after arc fuzzy-match
  motifs: string[];               // 3–6, ≤40 each
  source: "llm";
  version: 1;
};
```

`PlayerState` addition (`packages/engine/src/types.ts`, optional, BC9/R16.3):

```ts
itemsEverGranted?: string[];   // normalized via normalizeItemRef; read with ?? []
```

Appended in `applyEffect`'s `inventory_add` branch
(`packages/engine/src/llm.ts:795`) and in `addItem` callers on the llm path.
No schemaVersion bump, no migration (R16.3 forbids rewrites).

### 1.3 Pure engine functions (`bible.ts`)

- `validateProposedBible(raw: unknown): StoryBible | null` — mirror of
  `validateProposedArc` (`arc.ts:114`): clamp lengths, `slugify` + dedupe
  ids, drop `lockPlan` entries whose `keyId` misses the registry or whose
  `gateBand` precedes the key's `surfaceBand`; null if fewer than 4 salvageable keys
  (R1.3). Never throws.
- `matchEndingHints(bible, arc): StoryBible` — fuzzy-match `endingHints`
  ids to `arc.candidateEndings` via the `normalizeEndingId` machinery
  (`arc.ts:320`); unmatched hints dropped (R1.5).
- `buildBibleDigest(bible, turnNumber, promised): BibleDigest` — the
  band-filtered, capped digest (§4): ≤6 due keys, ≤3 doors, cast, ≤2 twists,
  ≤2 OUTSTANDING KEYS lines. Returns a structured object; the convex prompt
  layer renders it (engine stays prose-free).
- `processGatedChoices(results, state, registry, turnNumber)` returning
  `{ results, registryEvents: RegistryEvent[] }` — R4.2–R4.5 (§3).
- `dueKeySeedings(registry, turnNumber): BibleKey[]` — promised, ungranted,
  `turnNumber - promisedAtTurn ≥ 3` (R5.1).
- `mergeBibleRefresh(current, proposedRaw): StoryBible` — R6 merge:
  consumed/granted/promised entries immutable, ≤2 new keys, relocations
  applied, failure → `current` unchanged.

## 2. Call flow

```
createSave (llm fork, game.ts:408-421)
  ├─ insert story_bibles {status:"queued"} + runAfter(0, "llm/storyBible:generateStoryBible")
  └─ turn 1 proceeds untouched (SSE path; opening cinematic loader already covers the wait)

generateStoryBible (action, mirrors summarizeStory convex/llm/summarizer.ts:333)
  ├─ buildStoryBiblePrompt (pure) ← premise/seed inputs (same fields as turn-1 request)
  ├─ provider fan-out à la callSummarizer (summarizer.ts:170) — cheap-model ordering,
  │   structured JSON contract: storyBibleOutputSchema (engine zod) +
  │   STORY_BIBLE_RESPONSE_SCHEMA wire mirror (convex/llm/responseSchema.ts pattern, :181)
  ├─ validateProposedBible → null ⇒ retryCount<1 ? reschedule : status:"failed" (R1.4)
  ├─ evaluateTextPolicy per string field → blocked strings neutralized (R2.3)
  └─ _setStoryBible internal mutation ⇒ status:"ready"

turn N ≥ 2 request assembly (game.ts:1582-1585 AND :3733-3736 — SB1)
  ├─ load bible row; status:"ready" ⇒ include digest in SceneGenerationRequest.storyBible
  └─ first inclusion: matchEndingHints(arc), patch attachedAtTurn (R1.5)

turn N application (completeSceneStream / applyChoice mutation)
  ├─ evaluateLlmSceneChoices → processGatedChoices(…, registrySnapshot)   [SB4]
  ├─ dueKeySeedings ⇒ scheduleThread(delayNodes:1, inventory_add, note)   (R5.1)
  ├─ write state + apply registryEvents to bible row — SAME mutation      (R2.1)
  ├─ analytics inserts (fire-and-forget, R4.6)
  └─ act_advanced diff ⇒ runAfter(0, refresh) if lastRefreshAct < newAct  (R6)

fork ⇒ copy bible row as-of fork point (R2.4)
```

## 3. Registry enforcement (`processGatedChoices`, replaces the interim rules)

Runs where `evaluateLlmSceneChoices` post-processes today
(`packages/engine/src/llm.ts:1147-1183`). For each `locked` result whose
failing condition is `has_item`:

1. Resolve `itemId` with `normalizeItemRef` against: current inventory,
   `itemsEverGranted ?? []`, sibling-choice `inventory_add` effects in the
   SAME proposal. Hit ⇒ legitimately locked (key exists/imminent) — keep.
2. Else against `registry.keyRegistry` (unretired). Hit ⇒ keep locked, emit
   `{kind:"promise", keyId, turn}` (idempotent if already promised).
3. Else: `promisedCount < 2 && registry.length < 16` ⇒ emit
   `{kind:"adopt", key:{…}}` (id, titleCased label, current `surfaceBand`,
   `status:"promised"`, `adopted:true`), keep locked. Otherwise ⇒
   `unlockChoiceResult` (`llm.ts:1176`) + emit `{kind:"phantom_unlock"}`.
4. Keep-rule rewrite (R4.4): among multiple locked results, keep the most
   attainable — order: promised-registry key > smallest currency/stat
   deficit > array order. Others unlocked (existing ≥2-visible rule
   unchanged, `llm.ts:1166-1171`).
5. Bible-less saves pass an EMPTY registry: step 3 always phantom-unlocks
   (R4.5) — this alone fixes legacy saves.

`RegistryEvent` union: `promise | adopt | phantom_unlock | granted (key
matched an inventory_add this turn) | door_opened | seeded`. Convex folds
events into the bible row; the engine never mutates the registry input.

## 4. Prompt integration (`convex/llm/prompts/scene.ts`)

- New `storyBibleBlock` rendered from `request.storyBible`, inserted in the
  section join (`scene.ts:420-437`) directly after `storySummaryBlock`
  (`:331`) so it reads as canonical continuity. Shape:

```
STORY BIBLE (server plan — canonical, invisible to the reader):
KEYS available to this story (gate ONLY on these ids; grant before or while gating):
- bone-key "the Bone Key" — opens the crypt gate [due now]
- ferry-token "a ferryman's token" — passage across [surfaces later]
DOORS planned: crypt gate (needs bone-key, mid) …
CAST: mira — wants passage north; secret: deserted the Iron Court …
TWISTS held back: the-drowned-bell (needs: reader trusts the ferryman)
OUTSTANDING KEYS: bone-key was teased at turn 4 — surface it naturally soon.
Guidance: weave due entries in when natural; the reader's actions always win;
you may relocate or delay any entry, never force one.
```

- GATED CHOICE tightening (edit at `scene.ts:383`, inside the `hasArc`
  block): "`has_item` conditions may ONLY use ids listed under KEYS, items
  the reader holds, or items granted earlier this run. To tease a new key,
  grant it this scene — never gate on an id the story has not introduced."
- `SceneGenerationRequest.storyBible?: BibleDigest` — add to
  `convex/llm/types.ts:127` type + zod (`:197+`), threaded with conditional
  spread at both assembly sites (SB1). `convex/turn.ts:112`'s minimal
  request stays bible-less (authored path).
- Budget: worst-case digest fixture added to `promptScene.test.ts:558` —
  ≤600 tokens over current worst case (R3.4), cumulative ≤1600 respected.

## 5. Wire shapes / client

**None.** The bible never reaches the client (R2.2) — zero new queries,
zero `apps/app` changes. A projection test in the existing spoiler-test
pattern asserts `projectLlmDrivenScene` output contains no
`bible|keyRegistry|lockPlan|twist|endingHints|motif` keys. The seeded key
arrives through the existing thread badge + effect pips (R5.3).

## 6. Analytics (R4.6 — `analytics_events` fire-and-forget pattern)

| event | payload | fired from |
|---|---|---|
| `bible.generated` | `{saveId, keys, doors, retried}` | `_setStoryBible` |
| `bible.attached` | `{saveId, turn, matchedEndings}` | first digest inclusion |
| `bible.refreshed` | `{saveId, act, added, retired}` | refresh mutation |
| `bible.key_promised` / `key_adopted` / `key_seeded` | `{saveId, keyId, turn}` | turn mutation (events) |
| `bible.gate_phantom_unlocked` | `{saveId, itemId, turn}` | turn mutation |
| `choice.locked_shown` | `{conditionKind, itemId?, everGranted, inRegistry, deficit?}` | turn mutation, once per completed turn (NOT the read-path projection — re-renders would double-count) |

## 7. Error handling

| scenario | handling |
|---|---|
| bible call HTTP/provider failure | `retryCount < 1` ⇒ reschedule once; else `status:"failed"`; save plays bible-less forever (R1.4) |
| unsalvageable payload (under 4 keys) | same as failure path — `validateProposedBible` returns null, never throws |
| text-policy block on a field | neutralize the string, keep the bible (R2.3) |
| bible ready mid-run | digest simply included from the next request; `attachedAtTurn` records when |
| arc missing at attach (legacy/arc-less save) | `endingHints := []`, rest of bible attaches normally |
| promise cap exceeded / registry full | phantom-unlock the excess gate (§3.3) — never a turn failure |
| refresh call failure / merge conflict | keep current bible silently (R6.1) |
| fork | copy bible row verbatim (consumption included); no new bible call (R1.6) |
| co-op followers / authored stories | no bible row created (R1.6) |

## 8. Testing strategy

- **Engine (vitest, table-driven, BC6/R16.4):** `validateProposedBible`
  clamp/dedupe/drop matrix incl. malformed → null; `matchEndingHints` fuzzy
  cases; `buildBibleDigest` band filtering + caps; `processGatedChoices`
  full matrix (held / ever-granted / sibling-grant / registry / adopt /
  cap-overflow / bible-less / keep-rule attainability ordering);
  `dueKeySeedings` boundaries; `mergeBibleRefresh` immutability rules;
  `itemsEverGranted` append + `?? []` on legacy state.
- **Convex (fake-ctx):** `createSave` schedules exactly one job (llm-driven
  only, none on fork/authored); action persists via internal mutation with
  retry-once; request assembly includes digest on ready + both paths (SB1);
  registry events + state written in one mutation; refresh guarded by
  `lastRefreshAct`; analytics payload shapes.
- **Prompt:** snapshot + token-budget extension (`promptScene.test.ts:558`);
  response-schema pin test for `STORY_BIBLE_RESPONSE_SCHEMA` (mirror
  `responseSchema` test pattern).
- **Projection:** spoiler-absence test per §5 (BC10).
- **Merge gate:** full monorepo typecheck + suites green, dockerized deploy
  (`docker compose restart convex` / `restart app`) per BC8.
