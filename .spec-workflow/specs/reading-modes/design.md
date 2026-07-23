# Design — Reading Modes

Companion to `requirements.md` (R1–R6) and `tasks.md`. Audience: the agent
team implementing the spec. Inherits story-engagement `design.md` §0 BUILD
CORRECTIONS (BC1–BC10) wholesale — read them first. Spec-specific corrections
below encode what a fresh code audit (2026-07-20, HEAD `3590896`) actually
found. The spine: three of the four modes are pure presentation over pipelines
that already exist; only novel mode (R4) moves the branching contract. Read §0
before touching anything.

---

## 0. SPEC-SPECIFIC BUILD CORRECTIONS (authoritative)

- **RM1 — there is ONE live llm-driven turn path; the deprecated non-streaming
  helper is dead code, do NOT wire novel mode into it.** As of commit
  `be57970` the `submitChoice` action routes every llm-driven turn through the
  streaming flow: `beginStreamingChoice` → `getAuthorizedSceneStreamRequest`
  (`convex/game.ts`, grep `export const getAuthorizedSceneStreamRequest` ≈
  :1742) → `generateScene` (SSE, in the action) → `runLlmDrivenBeginStreaming`
  (grep `async function runLlmDrivenBeginStreaming` ≈ :4253) →
  `completeSceneStream` (grep `export const completeSceneStream` ≈ :1896). The
  old non-streaming `runLlmDrivenSubmitChoice` (grep `@deprecated DEAD CODE` ≈
  :4422) calls `router.generateScene` inside a mutation, crashes real
  providers, and is unreachable — its own `llmSceneOutputSchema` handling is
  inert. **Novel mode's server work lives ONLY at the two live sites:**
  `getAuthorizedSceneStreamRequest` (thread `readingMode` + force
  `sceneLength: "chapter"`) and `completeSceneStream` (select the novel schema
  + stamp the synthetic choice). Wiring anything into
  `runLlmDrivenSubmitChoice` is inert today and a landmine when the dead helper
  is deleted.

- **RM2 — the branching contract is enforced by the ENGINE Zod schema, not by
  the wire responseSchema; vary it additively.** `MIN_CHOICES = 2`
  (`packages/engine/src/llm.ts`, grep `const MIN_CHOICES` ≈ :64) feeds
  `llmSceneOutputSchema.choices.min(MIN_CHOICES).max(MAX_CHOICES)` (grep
  `choices: z.array(llmChoiceSchema).min` ≈ :339). That schema is the real
  gate. **CAUTION — red herring:** `convex/llm/responseSchema.ts` also declares
  a `MIN_CHOICES`, but `vertex.ts` deliberately does NOT pass a responseSchema
  for SCENE generation (only the story-bible wires its schema); so
  `responseSchema.ts` gates nothing here and MUST NOT be edited for novel mode
  (a spec Non-Goal). The fix is an ADDITIVE sibling schema
  `llmNovelSceneOutputSchema` (identical to `llmSceneOutputSchema` but
  `choices: z.array(llmChoiceSchema).min(0).max(1)`), leaving the branching
  schema byte-identical for every branching/legacy save.

- **RM3 — `llmSceneOutputSchema.safeParse` runs at FOUR sites inside
  `completeSceneStream` plus the SSE parse; only two GATE, but all four must
  read the mode or a valid novel payload degrades.** Grep
  `llmSceneOutputSchema.safeParse` in `convex/game.ts`: (a) the pre-parse
  choice-label classifier (≈ :1979) returns `[]` on failure — a novel payload
  would silently lose its (intentionally empty) labels, tolerable but select
  the novel variant for correctness; (b) the MAIN parse (≈ :2034) THROWS
  `llm_scene_invalid_shape` on failure — this is the load-bearing gate, it
  MUST use the novel variant when `save.readingMode === "novel"`; (c) the
  visual-prompt parse (≈ :2424) and (d) the NPC-mention parse (≈ :2492) return
  `null` on failure — defensive, non-fatal, but select the novel variant so a
  legit prose-only payload still yields `visualDescription`/NPC data. The
  FIFTH site is the LIVE SSE gate `parseSceneOutput` (`convex/llm/parse.ts`,
  grep `export function parseSceneOutput` ≈ :113, `llmSceneOutputSchema.safeParse`
  ≈ :121) — reached via `LlmRouter.generateScene` (`convex/llm/router.ts` ≈ :72,
  parse call ≈ :91, plus the deterministic-fallback call ≈ :143) from
  `streamSceneWithResult` (`convex/http.ts` ≈ :254). It ALSO gates: a rejected
  novel payload falls through to `authoredSceneSchema.parse` (parse.ts ≈ :142),
  yields NO `proposal`, so `completeSceneStream` receives a null proposal
  (http.ts warns ≈ :266) and throws — miss it and the stream rejects before
  `completeSceneStream` ever sees the payload. `readingMode` must therefore be
  threaded into `parseSceneOutput`'s signature and passed from
  `generateScene(request)` via `request.readingMode`. **NOTE — do NOT target
  `parseLlmDrivenScene` (parse.ts ≈ :242): it is imported ONLY by
  `convex/tests/parseDropLogging.test.ts` and is NOT on the live path (the
  same dead-path class RM1 warns about).** Five sites, one mode flag.

- **RM4 — the reading CONTRACT has no home today; add a save-level
  `readingMode`, default-absent, resolved server-side like `cinematicMode` —
  NOT a sixth layout skin.** `saves.mode` (`convex/schema.ts`, grep
  `mode: v.union(v.literal("story")` ≈ :95) is difficulty only, and `layout`
  is client-only localStorage. Novel mode changes what the LLM PRODUCES, so it
  is a content axis: a new OPTIONAL `readingMode` field on the `saves` table
  (integrator-owned, RESERVED `schema.ts`), absent ⇒ `"branching"`, so every
  legacy save resolves to today's exact path. The layout axis
  (`ReaderLayoutVariant`, `apps/app/hooks/useReaderSettings.ts` grep
  `export type ReaderLayoutVariant` ≈ :31) stays cosmetic and orthogonal.

- **RM5 — mirror `computeMediaStrategy`; do NOT invent a new resolver shape.**
  The media system already resolves per-save intent through a pure resolver +
  thin adapter: `computeMediaStrategy(input) → MediaStrategy`
  (`convex/media/mediaStrategy.ts`, grep `export function computeMediaStrategy`
  ≈ :48) fed by `saves.mediaPrefs.cinematicMode`, with the `devForceProMedia`
  unlock seam. Novel mode's `resolveReadingMode({ desired, isPro })` copies
  that shape exactly — a pure function returning the effective mode (degrade
  `novel → branching` for non-Pro if the R4.9 gate is adopted), colocated with
  the pure engine/saves helpers, so any entitlement gate is a one-line change,
  not a threading job.

- **RM6 — `CinematicMode` is DEFINED TWICE; for Illustrated Book's
  distinct-strategy option the two definitions move in lockstep.** The union
  lives in `apps/app/hooks/useReaderSettings.ts` (grep `export type
  CinematicMode` ≈ :18, plus `CINEMATIC_MODES` ≈ :24 and `isCinematicMode`) AND
  in `convex/account.ts` (grep `export type CinematicMode` ≈ :13, consumed by
  `resolveMediaPrefs` ≈ :134/:151). If R3 adds an `illustrated_book` strategy
  value, BOTH unions + the `MediaStrategy` union (`mediaStrategy.ts` ≈ :31) +
  `computeMediaStrategy` + one additive `v.literal("illustrated_book")` in the
  `saves.mediaPrefs.cinematicMode` schema union (`schema.ts`, grep
  `cinematicMode: v.optional` ≈ :41) must all change together, or
  `resolveMediaPrefs` silently drops the new mode. Easy to miss — flagged.

- **RM7 — layout is client-only localStorage; the still-producing
  `cinematicMode` round-trips to the server — Illustrated Book MUST couple
  them or the reader gets a permanent skeleton.** `settings.layout` persists
  only to localStorage in `useReaderSettings`; the media guarantee is server
  state (`mediaPrefs` → `computeMediaStrategy`). A reader who picks the
  image-first skin while the server strategy is `off`/images-disabled sees a
  full-bleed plate that never fills. Selecting Illustrated Book (R3.8) must
  set `layout = illustratedBook` AND force images-on + a stills-guaranteeing
  strategy TOGETHER in BOTH pickers.

- **RM8 — the still is ALREADY produced under every Pro strategy; the ONLY
  load-bearing gap is the credit-exhaustion path.** `queueSceneImage`
  (`convex/media/sceneMedia.ts`, grep `export const queueSceneImage` ≈ :266)
  queues the image whenever images are enabled + Pro + credits, gating only
  VIDEO on strategy — so `stills_only` and every Pro mode already yield one
  still per scene, and Illustrated Book needs NO new queue site in `game.ts`.
  On `chargeMediaSpend` failure it currently `ctx.db.delete(assetId)` and
  returns `insufficient_sparks` (grep `ctx.db.delete(assetId)` ≈ :382) — the
  still silently vanishes and `MediaPlate` holds at skeleton forever. For a
  mode whose whole promise is "guaranteed still," that blank plate IS the
  failure. The fix is a MODE-SCOPED fallback (keep a placeholder asset / emit
  an out-of-credits signal) that never bills and never blocks the turn; every
  other reader keeps the exact delete-and-skeleton behavior.

- **RM9 — `getRunHistory` is the mandated read-back source; the published-tale
  path is the wrong tool.** `getRunHistory` (`convex/game.ts`, grep
  `export const getRunHistory` ≈ :794) is owner-authed
  (`assertCanAccessSave`, grep at ≈ :800), entitlement-free, and returns the
  full oldest→newest per-turn projection WITH per-scene stills + narrator,
  already wrapped by `getRemoteRunHistory` (`apps/app/lib/gameApi.ts`, grep
  `export async function getRemoteRunHistory` ≈ :475) and rendered by the
  "Scene archive" route. `talesFunctions:readTale` over `published_tales`
  snapshots is public/friends-gated and media-poorer — reusing it would force
  publishing or a duplicate owner-auth projection. The book route (R2) is a
  pure presentation surface over `getRunHistory` and MUST NEVER import the
  rewind mutation (`rewindRemoteSaveTurns`) — read-only by construction.

- **RM10 — auto-narrator adds ZERO server surface; `useTurn` needs ZERO
  change.** `submitChoice` (`apps/app/hooks/useTurn.ts`, grep
  `const submitChoice = useCallback` ≈ :459) already self-guards
  `if (choice.locked || pendingChoiceId) return;` (≈ :460), clears
  `pendingChoiceId` in its `finally` (≈ :583), and the streaming stub empties
  `projection.choices` during flight — so a double-fired auto effect no-ops on
  both the pending guard and the empty-choices guard. Auto-narrator re-fires
  the SAME turn path a manual tap uses, so every auto-advance is a real
  `daily_turn_counter`-metered turn, hard-stopped server-side
  (`daily_turns_exhausted` → `freeformError` → auto halts). No new function, no
  new field, no schema change, no gate.

## 1. Data model

### 1.1 New save field `readingMode` (R4 only — integrator-owned, RESERVED, BC7)

The ONLY schema change in this spec. Added to the `saves` table near
`keepsakeCarried` (`convex/schema.ts`, grep `keepsakeCarried: v.optional` ≈
:152):

```ts
readingMode: v.optional(
  v.union(v.literal("branching"), v.literal("novel")),
),
```

OPTIONAL so every existing save reads back as `"branching"` (absence is the
default, never a migration). No index change — the field is read only through
the already-loaded `save` doc on the live turn path. Auto-narrator (R1),
read-as-books (R2), and Illustrated Book's layout (R3) add NO save field: the
first is session state, the second is a read-back, the third is a
layout+strategy bundle over the EXISTING `mediaPrefs.cinematicMode` axis.

### 1.2 Optional `illustrated_book` strategy literal (R3 — ONLY if the
distinct-strategy Open Question resolves that way, RM6)

If R3.9 chooses a distinct `MediaStrategy` over reusing `stills_only`, ONE
additive literal joins the `saves.mediaPrefs.cinematicMode` union
(`schema.ts` ≈ :41):

```ts
cinematicMode: v.optional(
  v.union(
    v.literal("off"),
    v.literal("stills_only"),
    v.literal("endpoint_cinematic"),
    v.literal("per_scene_legacy"),
    v.literal("illustrated_book"),   // additive; absence unchanged
  ),
),
```

Additive and back-compat: absence still resolves to the legacy default. If the
reuse-`stills_only` path is chosen instead, `schema.ts` needs NOTHING for R3.
Either way the two `CinematicMode` TS definitions (RM6) move in lockstep.

### 1.3 New pure module `packages/engine/src/llm.ts` addition (R4, additive)

```ts
// R4.3 — identical to llmSceneOutputSchema EXCEPT choices.min(0).max(1).
// prose / terminal / beatFired / twistFired / visualDescription unchanged.
export const llmNovelSceneOutputSchema = z
  .object({ /* …same fields… */,
    choices: z.array(llmChoiceSchema).min(0).max(1),
  })
  .strict();

export type LlmNovelSceneProposal = z.infer<typeof llmNovelSceneOutputSchema>;
```

The existing `llmSceneOutputSchema` (min 2) is UNCHANGED — branching and the
story-bible schema are unaffected. A tiny selector keeps the five parse sites
honest:

```ts
// picks the schema by mode; the ONLY place the mode → schema mapping lives.
export function sceneSchemaFor(readingMode: "branching" | "novel" | undefined) {
  return readingMode === "novel" ? llmNovelSceneOutputSchema
                                 : llmSceneOutputSchema;
}
```

### 1.4 New pure resolver (R4, mirror of `computeMediaStrategy`, RM5)

```ts
// resolveReadingMode — pure, total, seam for the R4.9 Pro gate.
// desired absent ⇒ "branching"; non-Pro under posture A degrades novel→branching
// ONLY at createSave (never mid-run — R4.9 posture A default).
export function resolveReadingMode(input: {
  desired?: "branching" | "novel";
  isPro: boolean;
}): "branching" | "novel";
```

Back-compat discipline throughout: `cleanDoc` on any insert/patch,
conditional-spread for optional projection fields (never pass `undefined` —
`exactOptionalPropertyTypes`, BC4), every branch keyed off an EXPLICIT value
(`readingMode === "novel"`, `cinematicMode === "illustrated_book"`,
`layout === "illustratedBook"`), so absence is always today's path.

## 2. Call flow per mode

### R1 — Auto-narrator (client-only, zero server surface, RM10)

```
ReaderScreen (the ONE integration point — already owns both sides of the turn)
  ├─ destructures projection, submitChoice, pendingChoiceId, freeformError,
  │    chapterBoundary, acknowledgeChapter from useTurn (≈ :287-295)
  ├─ derives isTerminalView (≈ :494), showCandleGutter (≈ :502)
  └─ useAutoNarrator({ projection, submitChoice, guards }) [NEW hook]
       ├─ autoOn: session useState, default OFF (R1.6)
       ├─ effect keyed on projection.scene.id; fires ONLY when ALL pass:
       │    autoOn && !streaming && !pendingChoiceId && !projection.ending
       │    && !chapterBoundary && !showCandleGutter && !freeformError
       │    && choices has ≥1 non-locked entry                       (R1.2)
       ├─ after AUTO_DELAY_MS (reduced-motion-aware): submitChoice(pick)
       │    pick = pickAutoChoice(projection.choices)  [pure, R1.3]
       │      → filters locked, "narrator's pick", null when all locked
       └─ re-entrancy: submitChoice self-guards (RM10) — double-fire no-ops

reassert control (R1.5):
  ├─ toggle OFF in ReaderSaveActions pill row (grep function ReaderSaveActions
  │    ≈ :717) — one tap, any page
  └─ manual choice tap → submitChoice unchanged (mid-run auto-off is an OQ)

chapter interstitial (R1.8): chapterBoundary set ⇒ Layout replaced by
  ChapterEnd, no choices ⇒ auto PAUSES, or auto-acknowledgeChapter after a
  beat (OQ8); reduced-motion shortens/removes the pause.

metering (R1.7): each auto-advance IS a real turn → daily_turn_counter →
  daily_turns_exhausted → useTurn sets freeformError → auto halts (R1.2).
```

### R2 — Read runs as books (client-only presentation over `getRunHistory`, RM9)

```
route apps/app/app/read/[saveId]/book/index.tsx  [NEW, read-only]
  ├─ useRunHistory(accountId, saveId) [NEW shared hook — factored out of the
  │    archive route's FetchState + loadHistory so the two don't diverge, R2.9]
  │    └─ getRemoteRunHistory → game:getRunHistory (owner-auth, entitlement-free)
  ├─ renders each turn's prose continuously via ProseRenderer with book
  │    typography lifted from Book.tsx tokens (R2.3)
  ├─ optional inline still (turn.media.imageUri via MediaPlate)
  ├─ choice-free treatment: thin scene-break divider OR subtle italic
  │    "— you chose to …" from turn.choice.choiceLabel (OQ5, R2.4)
  ├─ NO rewind, NO "Turn N"/"You chose:" chrome; NEVER imports rewind (RM9)
  └─ 200-turn cap (RUN_HISTORY_MAX_TURNS, grep ≈ :780): lift for this view OR
       "earlier chapters not shown" notice (OQ6, R2.8)

entry points (R2.7):
  ├─ ContinueReading finished-save rows → /read/[saveId]/book
  ├─ EndingPanel "Read this tale as a book" via its handler-passing convention
  └─ TrophyCrypt (OPTIONAL, only if the crypt card carries saveId — verify)

free + generates nothing (R2.5): getRunHistory surfaces only status:"ready"
  assets, no Imagen/Veo/TTS, no ledger writes, no daily counter. No gate.
```

### R3 — Illustrated Book (layout + media-guarantee fallback, RM7/RM8)

```
selection (R3.7/R3.8) in BOTH pickers (settings cinematicMode group +
  ReaderSettingsDrawer "Reading layout" group, grep Reading layout ≈ :169):
  ├─ Pro-gated → non-Pro sees locked → /paywall (devForceProMedia previews)
  └─ picking it sets layout=illustratedBook AND forces images-on + a
       stills-guaranteeing strategy TOGETHER (RM7 coupling)

turn (unchanged pipeline): completeSceneStream → queueSceneImage already fires
  the still under the Pro strategy (RM8) — NO new queue site.

fallback (R3.4/R3.5 — the load-bearing, MODE-SCOPED change):
  queueSceneImage on chargeMediaSpend failure:
    ├─ Illustrated Book: keep a lightweight placeholder asset AND/OR emit an
    │    outOfCredits signal on the getSceneMedia projection — never bill it,
    │    never Pro-gate it (model like the NPC/anchor portraits chargeMediaSpend
    │    never bills)
    └─ every other reader: EXISTING behavior — ctx.db.delete(assetId),
         hold at skeleton (byte-identical)
  MediaPlate gains a mode-aware `placeholder` treatment (grep MediaPlate —
    apps/app/components/media/MediaPlate.tsx): stylized frame + prose, a soft
    "out of illustration credits — top up" nudge, NEVER a bare skeleton and
    NEVER a blocked turn (R3.6).

layout (R3.2): IllustratedBook.tsx [NEW] cloned from GraphicNovelLayout (grep
  GraphicNovelLayout — layouts/GraphicNovel.tsx), re-weighted image-first
  (full-bleed plate on top, prose beneath, ChoiceList as footnotes),
  consuming the identical ReaderLayoutProps so the pipeline never forks.
```

### R4 — Novel mode (the one contract-moving mode, RM1–RM4)

**POSTURE CHANGE (R4.9): posture A → posture B.** The reading mode is no longer
locked at create — the reading-modes-cleanup adds a live switch,
`readingModeFunctions:setReadingMode`, that patches `save.readingMode` mid-run
and **applies from the next turn onward**. This is safe because each scene is
stamped its mode at GENERATION from the live save field (game.ts ≈ :1936), so
the current scene keeps its prior stamp and only the next generation reads the
new value. `createSave` still resolves the initial mode via `resolveReadingMode`;
the switch re-gates `novel` per switch through that SAME seam (Pro-only), while
switching to `branching` is always allowed (a lapsed Pro is never stranded on a
prose-only prompt).

```
createSave (game.ts ≈ :216, RESERVED integrator site):
  └─ persist readingMode = resolveReadingMode({ desired, isPro })  (RM5, R4.9
       posture B: gate the INITIAL mode here; mid-run flips go through
       setReadingMode, which re-gates novel per switch and applies next turn)

turn request (getAuthorizedSceneStreamRequest ≈ :1742, RESERVED, llm-driven
  branch only, R4.7):
  ├─ read save.readingMode; when "novel":
  │    add readingMode:"novel" to the SceneGenerationRequest
  │    set sceneLength = "chapter" (grep sceneLength ≈ :1851)
  └─ buildLlmDrivenPrompt (scene.ts ≈ :409) branches on readingMode==="novel":
       DROP "choices is an array of 2 to 4" (grep ≈ :515), CHOICE DIVERGENCE
       (grep ≈ :523), arc choice-consequence/gated-choice rules; emit
       prose+terminal-only shape; chapter-length prose. KEEP terminal,
       anti-repetition, continuity, visualDescription, arc/pursuit spine (R4.5).

stream + persist (completeSceneStream ≈ :1896, RESERVED):
  ├─ select sceneSchemaFor(save.readingMode) at ALL five parse sites (RM3):
  │    parseSceneOutput parse.ts:121 (LIVE SSE gate, via router.generateScene —
  │    NOT the dead parseLlmDrivenScene:242), classifier :1979, MAIN :2034 (the
  │    throw), visual :2424, npc :2492
  ├─ after validation, STAMP the synthetic single choice server-side (R4.2/4.4):
  │    { id: "turn-page", label: "Turn the page" }  (no effects), into BOTH
  │    proposal.choices AND persisted choiceViews
  └─ suppress the "Turn the page" choiceLabel memory/summarizer beat (lean on
       prose continuity — R4 memory-noise risk)

next turn phase-A (advanceLlmTurnCursor, engine llm.ts grep
  export function advanceLlmTurnCursor ≈ :524):
  ├─ resolves choiceId "turn-page" against the PRIOR proposal.choices (≈ :569)
  │    → applies its empty effects cleanly (avoids llm_choice_not_found)
  └─ EQUIVALENT permitted: route through the freeform:true branch (≈ :588)
       which advances with no proposal lookup + no effects (R4.4)

client (R4.6): useTurn submitChoice UNCHANGED — submits the server-provided
  "turn-page" id through the same streaming/persist path. Novel LAYOUT renders
  it as a page-turn gesture, reading readingMode off the projection
  (projectLlmDrivenScene — convex/saves.ts grep ≈ :592 carries readingMode).

endings/keepsakes (R4.8): terminal → one ending per read-through; replay
  regenerates a different linear book; keepsakeCarried unchanged.
```

## 3. Wire shapes

Only novel mode widens a wire shape; the other three are client-only or reuse
existing projections verbatim.

**R4 — `SceneGenerationRequest` (`convex/llm/types.ts`, grep
`export type SceneGenerationRequest` ≈ :127, and `sceneGenerationRequestSchema`
≈ :223):** add an OPTIONAL field, threaded exactly like the existing `mode`
field:

```ts
readingMode?: "branching" | "novel";   // absent ⇒ branching (BC-clean widening)
```

Absent on every request today; the schema's `.optional()` tolerates old
callers (deploy-skew safe both ways). No arg-name change (BC3 is about args).

**R4 — client projection (`projectLlmDrivenScene`, `convex/saves.ts` ≈ :592):**
carry `readingMode` to the client via conditional spread so a Novel layout can
render the page-turn affordance:

```ts
...(save.readingMode === "novel" ? { readingMode: "novel" as const } : {}),
```

This is a reader-known fact (they chose novel at create) — BC10-clean, no
spoiler. `useTurn`'s `RemoteScene` mirrors it as an optional field.

**R3 — scene-media projection (`getSceneMedia`):** if the distinct-strategy or
signal path is chosen, add an OPTIONAL `outOfCredits?: boolean` (or a
`placeholder` asset status) so `MediaPlate` can pick the degraded treatment
(R3.4). Old clients ignore it; new clients tolerate absence.

**R1 / R2:** NO wire change. Auto-narrator rides `submitChoice` verbatim;
read-as-books consumes `getRemoteRunHistory`
(`RemoteRunHistoryTurn`/`RemoteRunHistory`, `gameApi.ts` ≈ :449-471) unchanged.

## 4. Client surfaces

- **Auto-narrator (R1):** a NEW hook `apps/app/hooks/useAutoNarrator.ts`
  (session `autoOn` + the timed, guard-gated advance effect) and a NEW pure
  module `apps/app/components/reading/autoNarrator.ts` (`pickAutoChoice` +
  `AUTO_DELAY_MS` / per-session cap constants), mirroring the existing
  `softSignup.ts` / `lockCoach.ts` small-policy pattern so each gets a
  `.test.mjs`. The toggle affordance mounts inline in the `ReaderSaveActions`
  pill row (grep `function ReaderSaveActions` — `ReaderScreen.tsx` ≈ :717) for
  one-tap "grab the wheel"; optionally echoed in `ReaderSettingsDrawer` BUT the
  flag MUST stay ReaderScreen session state, NEVER routed through
  `useReaderSettings` (which persists localStorage + syncs `mediaPrefs` to the
  server — R1.6). `ReaderScreen` stays the "thin shell" its own doc comment
  describes.

- **Read-as-books (R2):** a NEW read-only route
  `apps/app/app/read/[saveId]/book/index.tsx` over a NEW shared hook
  `useRunHistory` (factored from the archive route's fetch-state + load so the
  two never diverge, R2.9), rendering prose through the shared `ProseRenderer`
  atom (grep `ProseRenderer` — `apps/app/components/reading/ProseRenderer.tsx`)
  with book typography lifted from `Book.tsx` tokens. `BookLayout` itself is
  REFERENCE-ONLY, not reusable — it is coupled to the live choice-bearing
  projection (ChoiceList/StatsHud/EndingPanel/streaming/fork). Entry points:
  `ContinueReading` finished-save rows and `EndingPanel` (via its
  handler-passing convention), optionally `TrophyCrypt` if it carries `saveId`.
  The route NEVER imports `rewindRemoteSaveTurns` (RM9).

- **Illustrated Book (R3):** a NEW layout
  `apps/app/components/reading/layouts/IllustratedBook.tsx` cloned from
  `GraphicNovelLayout`, registered by adding `illustratedBook` to the
  `ReaderLayoutVariant` union + `READER_LAYOUT_VARIANTS` + `isLayoutVariant`
  guard (`useReaderSettings.ts`) and the `READER_LAYOUTS` record
  (`apps/app/components/reading/layouts/index.ts`, grep
  `export const READER_LAYOUTS` ≈ :18). `MediaPlate` gains a mode-aware
  `placeholder` treatment (R3.4). Both pickers (settings `cinematicMode` group;
  `ReaderSettingsDrawer` "Reading layout" group, grep `Reading layout` ≈ :169)
  Pro-gate the option and enforce the layout↔strategy coupling (RM7, R3.8).
  `ReaderScreen`'s `resolveActiveLayout` (grep ≈ :71) + `READER_LAYOUTS`
  dispatch (grep `const Layout = READER_LAYOUTS` ≈ :468) must reach the new
  layout, and it must not silently sit on `imagesEnabled=false`.

- **Novel page-turn (R4):** a Novel reading affordance under
  `apps/app/components/reading/layouts/` (or a projection-driven branch in the
  existing layouts) that renders the single server `turn-page` choice as a
  swipe/tap "Turn the page" instead of a `ChoiceList` button row, reading
  `readingMode` off the projection. Distinct from the five cosmetic skins
  because the AFFORDANCE changes, not just the paint. `useTurn` is untouched
  (RM10/R4.6).

## 5. Deferred — parked graphic-novel / comic mode (R6, do NOT build)

Recorded so it is a deliberate deferral, not an omission. A true paneled comic
(speech bubbles, per-panel art) is NOT specified for build here. Revisit
criteria = the reasons for parking: (a) multi-image pages explode generation
cost (several stills per page vs one), directly against the cost discipline
that lets R1/R2 ship free; (b) it demands panel-scripting from prose (shot
breakdown, ordering, dialogue extraction) — an authoring surface the LLM path
does not produce today; (c) it needs stricter cross-panel character
consistency than the current still pipeline guarantees. Revisit ONLY after the
Omni cinematics direction settles (shared endpoint-media cost question) AND
only IF Illustrated Book (R3) proves real demand for image-first reading. Until
both hold, no schema/prompt/media work is spent toward it.

## 6. Error handling

| scenario | handling |
|---|---|
| auto effect double-fires (React strict / rapid re-render) | `submitChoice` self-guards on `pendingChoiceId` + empty `choices` — no-op (RM10, R1.4) |
| server rejects an auto turn for daily budget | `useTurn` sets `freeformError` → auto halts, control returns (R1.2/R1.7) |
| every offered choice is locked | `pickAutoChoice` returns `null` → auto stalls, hands control back (R1.3) |
| chapter interstitial during auto | auto pauses or auto-acknowledges after a beat (OQ8); reduced-motion shortens the pause (R1.8) |
| reader closes the reader | `autoOn` is session state → resets to OFF (R1.6) |
| book route: run exceeds 200-turn cap | lift cap for the view OR "earlier chapters not shown" notice — never silent omission (R2.8) |
| book route: in-progress save | framing says "so far," not a finished tale (R2.6) |
| book route: legacy/missing fields | `getRunHistory` already falls back (choiceLabel→choiceId, missing prose suppressed, synthetic ids → "Turn N") — inherited (R2.6) |
| Illustrated Book: still credit exhausted mid-read | mode-scoped placeholder + nudge, turn advances; other readers keep delete-and-skeleton (RM8, R3.4/3.5) |
| Illustrated Book: reader out-paces generation | prose stays readable over a placeholder/skeleton; turn never blocks on media (R3.6) |
| Illustrated Book selected by non-Pro | picker shows locked → paywall; never selectable into a permanent skeleton (R3.7) |
| layout↔strategy desync (image-first skin, no still) | coupling in both pickers prevents it (RM7, R3.8) |
| novel payload with 0/1 choices at a parse site | `sceneSchemaFor` selects `llmNovelSceneOutputSchema` at all five sites — validates (RM3, R4.3) |
| novel: `turn-page` id missing from prior proposal | stamp into proposal.choices (not only choiceViews) OR route the `freeform:true` branch — avoids `llm_choice_not_found` (R4.4) |
| novel prompt asked for choices after a lapse (posture B) | switch to `novel` is re-gated per switch via `setReadingMode`; a lapsed Pro can only step DOWN to `branching`, and the flip applies from the NEXT turn (current scene keeps its stamp) — no mid-read contract flip on the live scene (R4.9) |
| legacy save (no `readingMode`) | resolves to `"branching"` → byte-identical branching path, min(2) gate intact (RM4, R5.3) |
| authored/scripted or co-op-follower turn | novel branch lives inside the `storyMode === "llm-driven"` guard — never taken (R4.7) |
| someone edits `responseSchema.ts` for novel | wrong file — not wired to scenes; a Non-Goal, caught in review (RM2) |
| someone wires novel into `runLlmDrivenSubmitChoice` | dead code — inert today, landmine later; forbidden (RM1, R5.3) |

## 7. Testing strategy

- **Pure engine (vitest, table-driven, BC6):** `llmNovelSceneOutputSchema`
  accepts 0- and 1-choice payloads and rejects 2+ where branching accepts
  them; `llmSceneOutputSchema` matrix UNCHANGED (regression pin — proves the
  additive sibling did not perturb branching); `sceneSchemaFor` mapping;
  `advanceLlmTurnCursor` resolves a synthetic `turn-page` id AND the
  `freeform:true` no-lookup branch (both avoid `llm_choice_not_found`);
  `resolveReadingMode` (desired absent ⇒ branching, non-Pro degrade under
  posture A, isPro passthrough).
- **Pure client (vitest/node):** `pickAutoChoice` (filters locked, null when
  all locked, deterministic under a seed, "narrator's pick" weighting);
  reduced-motion pacing constants honored; auto guard predicate truth table
  (each halt guard individually blocks).
- **Convex (fake-ctx):** novel path through `completeSceneStream` — novel
  payload validates at the MAIN parse (:2034 throw-site) and the four other
  parse sites, synthetic `turn-page` stamped into BOTH `proposal.choices` and
  `choiceViews`, memory beat suppressed; branching payload UNCHANGED;
  `getAuthorizedSceneStreamRequest` forces `sceneLength:"chapter"` +
  `readingMode` only for novel llm-driven saves; `createSave` persists the
  resolved mode (posture A gate); `queueSceneImage` mode-scoped fallback —
  Illustrated Book keeps a placeholder / emits the signal and does NOT bill,
  every other mode still `delete`s and holds at skeleton (byte-identical
  regression).
- **Client (node/vitest):** `useAutoNarrator` re-entrancy + halt-on-error +
  session-reset; `useRunHistory` shared load parity between archive and book
  routes; the book route never imports `rewindRemoteSaveTurns` (import-graph
  assertion); `IllustratedBook` consumes the identical `ReaderLayoutProps`;
  both pickers Pro-gate Illustrated Book and enforce the layout↔strategy
  coupling; the Novel layout renders one page-turn affordance from the
  projected `readingMode`.
- **Projection:** extend the BC10 spoiler test for the `readingMode` widening —
  present on novel saves, absent otherwise, and no other new keys leak.
- **Back-compat regression:** a save with no `readingMode` / no
  `cinematicMode` / no stored `layout` renders identically to today (branching
  path, legacy media default, `book` layout); `runLlmDrivenSubmitChoice` stays
  unreferenced by any new code.
- **Merge gate:** full monorepo typecheck + suites green, dockerized deploy
  (`docker compose restart convex` / `restart app`) per BC8.
