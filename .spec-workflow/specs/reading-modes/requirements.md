# Requirements — Reading Modes ("how the tome wishes to be read")

Status: DRAFT FOR REVIEW (2026-07-20). Companion docs: `design.md`
(architecture + §0 SPEC-SPECIFIC BUILD CORRECTIONS RM1–RMn), `tasks.md`
(agent tasks).

Grounding: CYOA renders every scene today through one cosmetic **layout
axis** — `ReaderLayoutVariant` (`apps/app/hooks/useReaderSettings.ts`, grep
`export type ReaderLayoutVariant` ≈ :31; the `READER_LAYOUT_VARIANTS` array ≈
:38) dispatched by `READER_LAYOUTS` (`apps/app/components/reading/layouts/index.ts`,
grep `export const READER_LAYOUTS` ≈ :18) inside `ReaderScreen` (grep
`resolveActiveLayout` ≈ :71, `const Layout = READER_LAYOUTS[activeLayout]` ≈
:468). Those five skins (Book/Mobile/Modern/Journal/GraphicNovel) all render
the SAME choice-bearing projection — the read experience is fixed even though
the paint changes. This spec adds a second axis the layout system never
touched: **how the reader consumes the branch** — hands-free, re-read,
image-first, or truly linear. Four facts anchor the work, each verified
against HEAD: (1) the branching contract is enforced by `MIN_CHOICES = 2`
(`packages/engine/src/llm.ts`, grep `const MIN_CHOICES` ≈ :64) feeding
`llmSceneOutputSchema.choices.min(MIN_CHOICES)` (grep
`choices: z.array(llmChoiceSchema).min` ≈ :339), which bites at BOTH live
parse gates — the SSE gate `parseSceneOutput` (`convex/llm/parse.ts`, grep
`export function parseSceneOutput` ≈ :113, `llmSceneOutputSchema.safeParse`
≈ :121, reached via `LlmRouter.generateScene`/`streamSceneWithResult`), and
the in-mutation MAIN parse inside `completeSceneStream` (`convex/game.ts`,
grep `llmSceneOutputSchema.safeParse` ≈ :2034). (`parseLlmDrivenScene` ≈ :242
is test-only DEAD code — NOT on the live path; do not target it.) So any
linear mode must relax the gate at the schema, not at the wire (`responseSchema.ts`
`MIN_CHOICES` is NOT wired to scene generation, see RM-caution in design).
(2) The media system already resolves per-save intent through a pure
resolver, `computeMediaStrategy` + `resolveMediaStrategy`
(`convex/media/mediaStrategy.ts`, grep `export function computeMediaStrategy`
≈ :48; `MediaStrategy` union ≈ :31) off `saves.mediaPrefs.cinematicMode`
(`convex/schema.ts`, grep `cinematicMode: v.optional` ≈ :41) — the resolver
pattern this spec MIRRORS for any new save-level content mode. (3) A linear,
choice-free read-back already exists as the precedent: `getRunHistory`
(`convex/game.ts`, grep `export const getRunHistory` ≈ :794) is an
owner-authed, entitlement-free per-turn projection, wrapped by
`getRemoteRunHistory` (`apps/app/lib/gameApi.ts`, grep
`export async function getRemoteRunHistory` ≈ :475) and rendered by the
"Scene archive" route (`apps/app/app/read/[saveId]/history/index.tsx`) — a
strictly better reuse target than the published-tale reader
(`talesFunctions.ts` `readTale` ≈ :562 over `published_tales` snapshots),
which is public/friends-gated and media-poorer. (4) The reading CONTRACT has
no home today: `saves.mode` (`convex/schema.ts`, grep
`mode: v.union(v.literal("story"), v.literal("hardcore"))` ≈ :95) is
difficulty only, and `layout` is client-only localStorage — so a mode that
changes what the LLM produces (novel) needs a NEW save-level `readingMode`
field, resolved server-side like `cinematicMode`, NOT a sixth layout skin.
Note the two reserved integrator files this touches are `convex/schema.ts`
and `convex/game.ts` — and `createSave` (grep `export const createSave` ≈
`game.ts`:216) lives INSIDE the reserved surface, so any create-time gate is
integrator-owned. Design §0 RM1–RMn encode the full fresh-audit corrections;
read them before building.

## Introduction

CYOA is one thing today: a branching choose-your-own-adventure where the
reader is always at the wheel. This spec keeps that default and adds four
**reader-selectable reading modes** — the same generated tale, consumed four
different ways — sequenced cheapest-first so the platform earns each one
before paying for the next:

1. **Auto-narrator** ("the tome reads itself") — a lean-back mode where the
   book auto-picks the next choice after a readable pause and reads on; the
   branch is untouched and the reader grabs the wheel back at any page.
   Client-only, zero server surface. *(R1)*
2. **Read-runs-as-books** — re-read your own finished or in-progress save as a
   paged, choice-free book, generalizing the existing run-history projection
   into a "library of lived tales." Client-only presentation over
   `getRunHistory`. *(R2)*
3. **Illustrated Book (Pro)** — an image-first layout with a **guaranteed
   still per scene**, making the optional Pro image load-bearing and turning
   it into a first-class upsell surface. Layout + a media-guarantee fallback.
   *(R3)*
4. **Novel mode** — a TRUE linear book: the branch collapses to a single
   synthetic "Turn the page," driven by a save-level `readingMode` field and a
   mode-scoped linear prompt/schema variant. The deepest mode; it moves the
   branching contract itself. *(R4)*

Two cross-cutting requirements carry the seams: mode selection / persistence /
back-compat *(R5)* and the explicitly **parked** graphic-novel/comic mode
*(R6)*, whose thinking is recorded so it is a deferred decision, not a
forgotten one.

The spine of the design is that three of the four modes are pure presentation
over pipelines that already exist — only novel mode changes what the model is
asked to produce. That asymmetry is deliberate: it lets the platform ship
lean-back reading, re-reading, and the Pro illustration upsell without
touching the live streaming turn path, and reserve the one contract-moving
change for last.

## Alignment with Product Vision

- **The "living book" made literal** (product purpose — "a tome that writes
  itself in response to the reader"): auto-narrator and novel mode let the
  book behave like a book — it can read itself aloud in sequence, or be a
  straight novel — without abandoning the engine underneath. The metaphor
  stops being skin-deep.
- **Pay for richer, not for entry** (principle 7; business objective "convert
  subscribers into Pro via illustration upsells"): Illustrated Book makes the
  Pro still the *point* of a whole reading mode rather than a garnish, giving
  the Pro upsell a concrete, in-context home ("read this tale illustrated").
  Auto-narrator and read-as-books stay free — more joy, not more gate.
- **Agency is the point** (principle 3): preserved, and sharpened. Auto-narrator
  does NOT remove agency — it makes agency *opt-in per page*. The branch, the
  choices, the effects all still exist; the reader has simply delegated the
  next tap and can reclaim it instantly. A flavor-only auto-read would be an
  anti-feature; this is the reader choosing to lean back on a real branch.
- **Story first** (principle 1): every mode is phrased in the book voice ("the
  tome reads itself," "read as a book," "Turn the page") and hides its
  scaffolding. No mode surfaces a stats dashboard or a settings-heavy widget
  over the prose.
- **Endings-and-keepsakes moat** (business objectives): read-as-books turns
  the accumulating library of finished runs into a re-readable shelf, raising
  switching cost; novel mode reaches endings and keepsakes by construction
  (one terminal per read-through), extending the collectible loop to linear
  readers.

---

## Requirements

### R1 — Auto-narrator ("the tome reads itself")

User story: as a reader, I want to lean back and let the book read itself,
picking the path for me, while I keep the power to grab the wheel on any page.

1. WHEN auto-narrator is ON AND a scene has settled with at least one
   non-locked choice AND none of the halt guards apply THEN the client SHALL,
   after a deliberate readable delay, submit a policy-picked choice through the
   EXISTING turn path (`useTurn` `submitChoice` → `beginRemoteStreamingChoice`,
   grep `const submitChoice = useCallback` — `apps/app/hooks/useTurn.ts` ≈
   :459) — the identical path a manual tap uses. Auto-narrator SHALL introduce
   NO new server function, NO new save field, NO schema change, and NO prompt
   change: it is client session state above the existing turn layer.
2. The halt guards SHALL be: streaming in flight, a pending choice
   (`pendingChoiceId`), an ending (`projection.ending`), a chapter boundary
   (`chapterBoundary`), a guttered candle (`burn.guttered` /
   `showCandleGutter`, grep `const showCandleGutter` — `ReaderScreen.tsx` ≈
   :502), a surfaced turn error (`freeformError`), and "every offered choice
   is locked." WHEN any guard is true THEN auto SHALL NOT fire and control
   SHALL return to the reader.
3. The pick policy SHALL be a pure, unit-tested function `pickAutoChoice` that
   filters out `locked` choices (the non-submittable rows — grep `choice.locked`
   — `apps/app/components/choices/ChoiceList.tsx` ≈ :65), selects a
   "narrator's pick" among the remainder (seeded/weighted or uniform, spec's
   design call), and returns `null` when every choice is locked — which
   correctly stalls auto and hands control back (R1.2). It SHALL live in a new
   pure module beside the existing small policy modules (mirroring
   `softSignup.ts` / `lockCoach.ts`) and carry a `.test.mjs`.
4. Re-entrancy SHALL be safe with ZERO change to `useTurn`: `submitChoice`
   already self-guards on `choice.locked || pendingChoiceId` (grep at
   `useTurn.ts` ≈ :460) and clears `pendingChoiceId` in its `finally`, and the
   streaming stub empties `projection.choices` during flight — so a
   double-fired effect no-ops on the pending guard and the empty-choices guard.
5. The reader SHALL be able to reassert control by (a) toggling auto OFF via a
   one-tap affordance in the reader chrome (the `ReaderSaveActions` pill row,
   grep `function ReaderSaveActions` — `ReaderScreen.tsx` ≈ :717), reachable on
   any page; and (b) tapping any choice manually, which SHALL submit unchanged.
   Whether a manual tap also flips auto OFF ("grabbing the wheel") is a design
   choice recorded in §Open Questions.
6. Auto-narrator SHALL be session state only: it SHALL default to OFF and
   SHALL reset to OFF when the reader closes the reader. It SHALL NOT persist
   through `useReaderSettings` (that object round-trips `mediaPrefs` to the
   server and writes localStorage — the auto flag must not).
7. Every auto-advance IS a real metered LLM turn: it SHALL be counted by the
   existing `daily_turn_counter` and hard-stopped server-side
   (`daily_turns_exhausted`) exactly as a manual turn. WHEN the server rejects
   a turn for budget THEN `useTurn` surfaces `freeformError` and auto SHALL
   halt (R1.2) — the guttering candle is the natural throttle. No new
   entitlement or server gate SHALL be added.
8. WHEN a chapter interstitial is showing (`chapterBoundary` set, ChapterEnd
   replacing the layout) THEN auto SHALL either pause for the reader or, to
   stay hands-free, auto-acknowledge after a readable beat via the existing
   `acknowledgeChapter` (grep `acknowledgeChapter` — `ReaderScreen.tsx` ≈
   :295). Which of the two is the shipped default is a design call recorded in
   §Open Questions; the reduced-motion path SHALL shorten or remove the pause.
9. All auto pacing (inter-turn delay, optional per-session advance cap) SHALL
   be reduced-motion aware and SHALL live as named constants in the pure
   policy module.

### R2 — Read your runs as books

User story: as a reader, I want to re-read a run I have lived — finished or in
progress — as a clean, paged, choice-free book, without the rewind chrome.

1. The mode SHALL be a client-only presentation over the EXISTING
   `getRunHistory` projection (grep `export const getRunHistory` —
   `convex/game.ts` ≈ :794), consumed via the existing `getRemoteRunHistory`
   wrapper (`apps/app/lib/gameApi.ts` ≈ :475). It SHALL add NO new Convex
   function, NO schema change, and NO save field — re-reading does not change
   the generation contract, so no `readingMode` value is warranted (contrast
   R4).
2. It SHALL NOT use the published-tale path (`talesFunctions:readTale` over
   `published_tales` snapshots): that path would force publishing or a new
   owner-auth projection duplicating `getRunHistory`, and it is media-poorer
   (no per-scene stills, no narrator audio). `getRunHistory` is the mandated
   reuse target.
3. A new read-only route (`apps/app/app/read/[saveId]/book/index.tsx`) SHALL
   render each turn's prose continuously through the shared `ProseRenderer`
   atom (grep `ProseRenderer` — `apps/app/components/reading/ProseRenderer.tsx`)
   with book typography lifted from `Book.tsx`'s tokens, an optional inline
   still, and NO rewind controls, NO "Turn N" / "You chose:" chrome. The route
   SHALL NEVER import the rewind mutation (`rewindRemoteSaveTurns`) — a
   read-only surface by construction.
4. The choice-free treatment SHALL render choices either as a thin scene-break
   divider OR as a subtle italic transition line ("— you chose to …") derived
   from `turn.choice.choiceLabel`; because each scene was authored assuming the
   prior choice, fully dropping the choice can read as a non-sequitur. Which
   treatment ships is a design call recorded in §Open Questions.
5. Reading a run SHALL be FREE and generate nothing: `getRunHistory` applies
   ownership + session auth only (grep `assertCanAccessSave` — `game.ts` ≈
   :800) with no tier check, surfaces only `status: "ready"` assets, and makes
   no Imagen/Veo/TTS calls and no credit-ledger writes. No entitlement check
   SHALL be added.
6. The mode SHALL work uniformly for in-progress, `ended`, `ended_safely`, and
   `dead` saves (any save with `turn_history` rows), and for both `story` and
   `hardcore` saves — read-back is orthogonal to difficulty. WHEN the save is
   in progress THEN the framing SHALL say "so far" rather than imply a finished
   tale.
7. Entry points SHALL be added: a "Read as book" affordance on finished-save
   rows in the library "Continue reading" surface (grep `ContinueReading` —
   `apps/app/components/library/ContinueReading.tsx`), and a "Read this tale as
   a book" action on the ending panel via its existing handler-passing
   convention (grep `EndingPanel` — `apps/app/components/death/EndingPanel.tsx`).
   A trophy-crypt entry point is OPTIONAL and gated on the crypt card carrying
   the originating `saveId` (verify before relying on it).
8. WHEN a run exceeds the `getRunHistory` truncation cap
   (`RUN_HISTORY_MAX_TURNS`, grep `const RUN_HISTORY_MAX_TURNS` — `game.ts` ≈
   :780, currently 200, with `hasMore`) THEN the book view SHALL NOT silently
   omit the opening: it SHALL either lift the cap for this view or show an
   explicit "earlier chapters not shown" notice (the archive route already does
   the latter). Whether the cap is lifted is a design call recorded in §Open
   Questions.
9. The shared load logic (fetch-state + history load) SHALL be factored into a
   small hook so the archive route and the book route do not diverge.

### R3 — Illustrated Book (image-first, Pro)

User story: as a Pro reader, I want a mode where every scene is illustrated —
a full-bleed still on top, prose beneath, choices as quiet footnotes — and the
picture never just fails to appear.

1. Illustrated Book SHALL be modeled as a bundle of two EXISTING axes plus one
   new fallback policy, NOT a content-contract change: choices stay 2–4 and the
   LLM path is untouched. The two axes are (a) a new `illustratedBook` entry in
   the `ReaderLayoutVariant` union + `READER_LAYOUT_VARIANTS` + `isLayoutVariant`
   guard (all in `useReaderSettings.ts`), registered in `READER_LAYOUTS`
   (`layouts/index.ts`); and (b) the server media guarantee of one still per
   scene.
2. The layout component (`apps/app/components/reading/layouts/IllustratedBook.tsx`,
   NEW) SHALL be cloned from `GraphicNovelLayout` (grep `GraphicNovelLayout` —
   `layouts/GraphicNovel.tsx`) — which already wires `SceneMedia` +
   `ProseRenderer` + `ChoiceList` + endings/HUD/freeform — and re-weighted
   image-first (full-bleed plate on top, prose beneath, choices as footnotes).
   It SHALL consume the identical `ReaderLayoutProps` so the turn pipeline
   never forks.
3. The still is ALREADY produced under every Pro strategy today: `queueSceneImage`
   (grep `export const queueSceneImage` — `convex/media/sceneMedia.ts` ≈ :266)
   queues the image whenever images are enabled + Pro + credits, gating only
   VIDEO on strategy. So Illustrated Book SHALL NOT add a new queue site in
   `game.ts`. Its load-bearing requirement is the FALLBACK, not the generation.
4. WHEN a scene's still cannot be produced (credit exhaustion — today
   `queueSceneImage` deletes the queued row and returns `insufficient_sparks`,
   grep `ctx.db.delete(assetId)` ≈ :382 — or generation failure) THEN in
   Illustrated Book the plate SHALL degrade to a stylized placeholder/degraded
   still with prose intact and a soft nudge, NEVER a permanent bare skeleton
   and NEVER a blocked turn. `MediaPlate` (grep `MediaPlate` —
   `apps/app/components/media/MediaPlate.tsx`) SHALL gain a mode-aware
   `placeholder` treatment for the credit-exhausted / gen-failed case.
5. The fallback change to `queueSceneImage` SHALL be MODE-SCOPED: only the
   guaranteed-still mode renders a placeholder / emits an out-of-credits signal
   through the scene-media projection; for every other reader the existing
   behavior (delete row, hold at skeleton) SHALL be byte-identical. The
   placeholder itself SHALL NOT be metered or Pro-gated (model it like the
   NPC/anchor portraits `chargeMediaSpend` never bills), else exhaustion
   cascades.
6. A turn SHALL NEVER block on media in this mode: image generation stays
   async fire-and-forget and turn advancement stays choice-submission only, so
   the reader can always read prose and choose before the still lands. The
   image-first layout SHALL keep prose readable while the plate is a
   placeholder/skeleton (the "reader out-paces generation" wobble is mitigated
   by the placeholder, not by blocking).
7. Illustrated Book SHALL be Pro-gated at selection in BOTH pickers (the
   settings `cinematicMode` group and the in-reader "Reading layout" group,
   grep `Reading layout` — `apps/app/components/reading/ReaderSettingsDrawer.tsx`
   ≈ :169). A non-Pro reader SHALL see it as locked → paywall (or a sample),
   never selectable into a permanent skeleton. The dev unlock
   (`CYOA_DEV_FORCE_PRO_MEDIA` / `devForceProMedia`) SHALL still preview the
   full mode.
8. Selecting Illustrated Book SHALL couple the two axes: it SHALL force images
   ON and a stills-guaranteeing media strategy AND set `layout = illustratedBook`
   together, so a reader can NEVER be in the image-first skin while the server
   produces no still. Because `settings.layout` is client-only localStorage
   while the still-producing `cinematicMode` round-trips to the server via
   `mediaPrefs`, the two selections SHALL be kept in sync in both pickers
   (RM-desync in design §0).
9. Whether Illustrated Book gets its own `MediaStrategy` value
   (`illustrated_book` — extending the union in `mediaStrategy.ts`,
   `computeMediaStrategy`, and the second `CinematicMode` definition in
   `convex/account.ts`, plus one additive `v.literal("illustrated_book")` in
   the `saves.mediaPrefs.cinematicMode` schema union ≈ :41) OR reuses
   `stills_only` and carries the guarantee entirely in the `queueSceneImage`
   fallback + layout is a design call recorded in §Open Questions. A distinct
   value earns its keep because its exhaustion behavior differs from
   `stills_only` (which drops silently) and lets the RESOLVER own the guarantee;
   the reuse path is cheaper but leaves the guarantee implicit. Whichever is
   chosen, the two `CinematicMode` definitions SHALL be updated in lockstep.

### R4 — Novel mode (TRUE linear book)

User story: as a reader, I want to read a generated tale as a straight
novel — chapter after chapter, "Turn the page," one ending — with no branching
choices at all.

1. Novel mode SHALL be homed in a NEW save-level field
   `readingMode: v.optional(v.union(v.literal("branching"), v.literal("novel")))`
   on the `saves` table (`convex/schema.ts`, integrator-owned, near
   `keepsakeCarried` ≈ :152), OPTIONAL so every legacy save resolves to
   "branching." It SHALL NOT be modeled as a sixth layout variant — the layout
   axis stays cosmetic; `readingMode` is an orthogonal content axis, resolved
   like `cinematicMode`.
2. Linear SHALL be implemented as "one synthetic choice." The whole turn
   pipeline is choice-count agnostic, so in novel mode the server SHALL stamp a
   single fixed choice `{ id: "turn-page", label: "Turn the page" }` (no
   effects) onto the proposal SERVER-SIDE, never trusted from the model.
3. The branching gate SHALL be relaxed at the SCHEMA, additively. A new
   `llmNovelSceneOutputSchema` (`packages/engine/src/llm.ts`, mirroring
   `llmSceneOutputSchema` but `choices: z.array(...).min(0).max(1)`, all other
   fields identical) SHALL be selected by `readingMode` at the load-bearing
   sites: the SSE gate `parseSceneOutput` (`convex/llm/parse.ts` ≈ :113,
   threaded from `LlmRouter.generateScene` via `request.readingMode`), the
   in-mutation MAIN `completeSceneStream` parse (`convex/game.ts` ≈ :2034),
   AND the pre-parse choice-label classifier in `completeSceneStream` — miss
   any one and a valid
   0/1-choice novel payload is rejected as an invalid shape and the turn
   fails/retries. The existing `llmSceneOutputSchema.min(MIN_CHOICES=2)` SHALL
   be left UNCHANGED for branching saves; `responseSchema.ts` SHALL NOT be
   touched (it does not gate scene generation — RM-caution in design §0).
4. After validation the server SHALL stamp the synthetic `turn-page` choice
   into BOTH the proposal's `choices` and the persisted `choiceViews`, so (a)
   the client renders one page-turn affordance and (b) the next turn's phase-A
   cursor advance (`advanceLlmTurnCursor`, grep `export function advanceLlmTurnCursor`
   — `llm.ts` ≈ :524) resolves choiceId `turn-page` against the prior proposal
   and applies its empty effects cleanly. The alternative — routing the
   page-turn through the existing `freeform: true` branch of
   `advanceLlmTurnCursor` (which advances with no proposal lookup and no
   effects) — is a permitted equivalent recorded in design; whichever is chosen
   MUST avoid `llm_choice_not_found`.
5. Novel mode SHALL use a prompt variant: `buildLlmDrivenPrompt`
   (`convex/llm/prompts/scene.ts` ≈ :409) SHALL branch on `readingMode ===
   "novel"` to DROP the "choices is an array of 2 to 4 entries" rule (grep
   `choices is an array of 2 to 4` ≈ :515), the CHOICE DIVERGENCE rule (grep
   `CHOICE DIVERGENCE` ≈ :523), and the arc-save choice-consequence/gated-choice
   rules, emit a prose+terminal-only output shape, and use chapter-length
   prose. It SHALL KEEP terminal handling, anti-repetition, continuity,
   `visualDescription`, and the arc/pursuit spine (a linear read is IMPROVED by
   the arc driving one dramatic question to one climax). `readingMode` SHALL be
   threaded through `SceneGenerationRequest` (type ≈ :127 and
   `sceneGenerationRequestSchema` ≈ :223 in `convex/llm/types.ts`) and
   `sceneLength` forced to `"chapter"` at the request-build site.
6. Turn advancement SHALL stay choice-submission: `useTurn` `submitChoice`
   needs NO structural change — in novel mode it submits the server-provided
   `turn-page` id through the same streaming/persist path. The page-turn
   gesture (swipe/tap "Turn the page" instead of a button row) is a Novel
   LAYOUT concern reading `readingMode` off the projection; the projection
   (`projectLlmDrivenScene` — `convex/saves.ts` ≈ :592) SHALL carry
   `readingMode` to the client.
7. Novel mode SHALL be llm-driven ONLY (the branch lives inside the existing
   `storyMode === "llm-driven"` guard at both the request-build and
   `completeSceneStream` sites); authored/scripted stories keep their required
   `StoryNode.choices` arrays and NEVER see the novel path. It SHALL be
   orthogonal to `saves.mode` — a novel save can still be `story` or `hardcore`.
8. Endings and keepsakes SHALL work unchanged: a terminal yields one ending
   per read-through; replay regenerates a different linear book from the same
   premise; `keepsakeCarried` continues to carry relics between runs. This is
   what makes linear stories replayable with zero engine change.
9. Whether novel mode is gated behind Pro/Unlimited at `createSave` (grep
   `export const createSave` — `convex/game.ts` ≈ :216, a RESERVED
   integrator-owned site) is a founder decision recorded in §Open Questions;
   the cost argument is real (chapter prose every turn roughly doubles output
   tokens vs branching while consuming the same daily turn). The design SHALL
   provide a pure `resolveReadingMode({ desired, isPro })` seam (mirroring
   `computeMediaStrategy`) so a gate is a one-line change, and SHALL default to
   the "gate at createSave, keep for the save's lifetime" posture to avoid
   mid-read contract flips (posture A over per-turn degrade).

### R5 — Mode selection, persistence, and back-compat (cross-cutting)

User story: as a reader, I want to choose how I read from a clear place, have
it remembered where it should be, and never have my old saves change under me.

1. The two AXES SHALL stay distinct in code and in the UI: the cosmetic
   `layout` axis (client localStorage, five existing skins + Illustrated Book)
   and the content `readingMode` axis (server save field, branching | novel).
   Auto-narrator is a THIRD, ephemeral axis (session state, R1.6). No mode
   SHALL collapse these into one control.
2. Persistence SHALL match each mode's nature: auto-narrator resets per session
   (R1.6); layout/Illustrated Book persist in `useReaderSettings` +
   `mediaPrefs` as today; `readingMode` persists on the save row and is
   resolved server-side. Illustrated Book's layout↔strategy coupling (R3.8)
   SHALL be enforced wherever the mode is selected.
3. Back-compat SHALL be total and keyed off explicit values: every branch keys
   off `readingMode === "novel"` (absent ⇒ branching), `cinematicMode` (absent
   ⇒ legacy default), and stored `layout` (absent ⇒ `book`). Legacy saves,
   authored/scripted saves, co-op reads, and the deprecated non-streaming LLM
   path (`runLlmDrivenSubmitChoice`, DEAD CODE — grep `@deprecated DEAD CODE`)
   SHALL be byte-identical to today. `runLlmDrivenSubmitChoice` SHALL NOT be
   re-wired.
4. `saves.mode` (story | hardcore difficulty) SHALL remain orthogonal and
   untouched by all four modes; the published-tale reader and `published_tales`
   SHALL remain untouched.
5. Whether a reader may switch reading mode MID-RUN or only at start is a
   founder decision recorded in §Open Questions; the design SHALL make the
   safe default explicit per mode (auto-narrator: always mid-run; layout:
   always mid-run as today; novel `readingMode`: locked at `createSave` under
   posture A, R4.9).
6. The reserved-file surface SHALL be minimal and integrator-owned:
   `convex/schema.ts` (one additive optional `readingMode` field for R4, plus
   at most one additive `cinematicMode` literal for R3 if the distinct-strategy
   option is chosen) and `convex/game.ts` (the `readingMode` threading +
   synthetic-choice stamp for R4, and the mode-scoped `queueSceneImage`
   fallback for R3). `convex/index.ts` and `convex/crons.ts` SHALL need NO
   change (media/game/saves functions register by path; no new cron).

### R6 — PARKED: true graphic-novel / comic mode (deferred, do NOT build)

User story (recorded, not scheduled): as a Pro reader, I might one day want a
paneled comic page with speech bubbles and per-panel art.

1. This mode SHALL NOT be specified for build in this spec. It is recorded here
   so it is a deliberate deferral, not an omission.
2. The reasons for parking SHALL be honored as the revisit criteria: (a)
   multi-image pages explode generation cost (several stills per page vs one),
   directly against the cost discipline that lets R1/R2 ship free; (b) it
   demands panel-scripting from prose (breaking a scene into shots, ordering,
   and dialogue extraction) — a new authoring surface the LLM path does not
   produce today; and (c) it needs much stricter character consistency across
   panels than the current still pipeline guarantees.
3. It SHALL be revisited only AFTER the Omni cinematics direction settles (it
   shares the endpoint-media cost question) AND only IF Illustrated Book (R3)
   proves real demand for image-first reading. Until both hold, no schema,
   prompt, or media work SHALL be spent toward it.

## Non-Goals (explicit)

- **A new turn/content path for auto-narrator, read-as-books, or Illustrated
  Book** — three of four modes are pure presentation over existing pipelines;
  only novel mode moves the contract.
- **Server state or entitlement gates for auto-narrator** — it rides the
  existing per-turn daily budget; no new counter, no new gate.
- **Using the published-tale reader for read-as-books** — `getRunHistory` is
  the mandated reuse target (R2.2).
- **Making the read-as-books route capable of rewind or any write** — read-only
  by construction (R2.3).
- **A new still queue site for Illustrated Book** — the still is already
  produced; only the fallback is new (R3.3).
- **Metering or Pro-gating the Illustrated Book placeholder** — it is a
  fallback, not a product (R3.5).
- **Touching `responseSchema.ts` for novel mode** — it does not gate scene
  generation; the real gate is `packages/engine/src/llm.ts` (R4.3).
- **Re-wiring the deprecated non-streaming `runLlmDrivenSubmitChoice`** — dead
  code, stays dead (R5.3).
- **The parked comic/graphic-novel mode** — R6; no build.
- **Rank/keepsake formula changes** — novel mode reaches the EXISTING ending
  and keepsake mechanics unchanged; no new collectible surface here.

## Non-Functional Requirements

### Performance
- Auto-narrator adds one client timer + one pure pick per settled scene; each
  advance is exactly one already-metered turn — no extra server cost. Read-as-
  books adds ZERO server calls beyond the existing `getRunHistory` read and
  generates nothing. Illustrated Book adds no new generation (the still already
  fires); its only new server work is a mode-scoped fallback branch and an
  out-of-credits signal on an existing projection. Novel mode adds no new
  round-trips but roughly doubles per-turn output tokens (chapter prose) — the
  cost argument behind the R4.9 gate.

### Reliability
- Every mode degrades to today's behavior. Auto: any halt guard or turn error
  stops it and returns control (R1.2). Book view: missing/legacy fields and the
  200-turn cap self-handle (R2.6, R2.8). Illustrated: the turn NEVER blocks on
  media and exhaustion degrades to a placeholder, never a blank plate (R3.4,
  R3.6). Novel: absent `readingMode` ⇒ identical branching path; the min(2)
  gate stays for branching saves (R4.3, R5.3).

### Code Architecture
- Auto-narrator's session state lives in a new `useAutoNarrator` hook and its
  pick policy in a pure, tested `autoNarrator.ts` module (mirroring
  `softSignup.ts` / `lockCoach.ts`), keeping `ReaderScreen` the "thin shell"
  its own doc comment describes. Read-as-books shares a load hook with the
  archive route (R2.9). Illustrated Book is a new layout cloned from
  `GraphicNovel` consuming the identical `ReaderLayoutProps`. Novel mode's
  `llmNovelSceneOutputSchema` is ADDITIVE (existing schema untouched) and its
  `resolveReadingMode` mirrors `computeMediaStrategy` (pure resolver + thin
  adapter). Reserved-file edits (schema.ts, game.ts) are integrator-owned;
  `exactOptionalPropertyTypes` conventions throughout.

### Security / Safety
- No mode introduces a new text-policy surface: read-as-books displays only the
  reader's own already-persisted prose; novel prose passes the same generation
  path (and thus the same policy) as branching prose; auto-narrator submits the
  reader's own turns. All reads stay owner-authed (`assertCanAccessSave` +
  session) exactly as today; Illustrated Book stays Pro-gated at selection and
  never renders a metered/gated placeholder (R3.5, R3.7). Novel mode's
  create-time gate (if adopted) uses `hasPaidEntitlement`, matching the media
  precedent.

## Open Questions (founder decisions)

These are flagged for the founder to resolve before or during design; the spec
takes a recommended default where noted but does not presume the answer.

1. **Locked-at-start vs switchable mid-run.** Auto-narrator and layout are
   mid-run by nature; the open decision is novel `readingMode`: lock it at
   `createSave` for the save's lifetime (recommended posture A, R4.9 — avoids
   mid-read contract flips) or resolve per-turn so a lapsed Pro degrades to
   branching mid-read (posture B, matches `mediaStrategy` exactly but risks a
   prose-only prompt suddenly asked for 2–4 choices)?
2. **Does novel mode consume daily turns at the same rate as branching?** Each
   page-turn is one metered turn today, but chapter prose roughly doubles token
   COGS per turn (R4 cost note). Keep 1 page = 1 daily turn (simplest, but
   heavier readers pay the same allowance for ~2× cost), discount novel turns,
   or gate novel behind Pro/Unlimited so the cost is amortized (R4.9)?
3. **Do the modes get endings / keepsakes?** Novel reaches one ending + the
   existing keepsake loop by construction (R4.8, recommended: yes, unchanged).
   Read-as-books is a read-back and mints nothing new (recommended: no new
   ending on re-read). Confirm auto-narrator's auto-advanced turns mint
   keepsakes/mementos identically to manual turns (they run the same path, so
   yes by construction) — flagged so the founder confirms auto-earned
   collectibles are intended.
4. **Is auto-narrator ungated or positioned as a Pro perk?** Recommended: ship
   the mechanic ungated (it already burns the daily budget at the manual rate);
   any Pro positioning is a one-line client check on the toggle, not a server
   change (R1.7).
5. **Read-as-books choice-free treatment.** Drop choices entirely (cleanest,
   risks non-sequitur prose) or render the chosen action as a subtle italic
   transition line (safer for continuity) (R2.4)?
6. **Read-as-books 200-turn cap.** Lift `RUN_HISTORY_MAX_TURNS` for the book
   view (a true whole-book read) or show an explicit "earlier chapters not
   shown" notice (cheaper, matches the archive) (R2.8)?
7. **Illustrated Book: new `MediaStrategy` value vs reuse `stills_only`.** A
   distinct `illustrated_book` value lets the resolver own the guarantee and
   differ from `stills_only`'s silent-drop, at the cost of one additive schema
   literal + updating both `CinematicMode` definitions; reuse is cheaper but
   leaves the guarantee implicit in the layout + fallback (R3.9)?
8. **Auto-narrator chapter-boundary behavior.** At a chapter interstitial,
   pause for the reader (safer) or auto-acknowledge after a beat to stay fully
   hands-free (R1.8)? And does a manual choice tap flip auto OFF ("grab the
   wheel") or leave it running (R1.5)?
