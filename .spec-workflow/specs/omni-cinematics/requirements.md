# Requirements Document — Omni Cinematics & Endpoint Media

## Introduction

This spec reframes CYOA's generated media from **per-scene clips** to **endpoint cinematics** powered by **Google Gemini Omni Flash** (`gemini-omni-flash-preview`), and adds a **media-strategy switch** so the new pipeline can be rolled out safely alongside the legacy one.

Two things motivate it:

1. **The original product intent was media at key beats, not every slide.** product.md principle 7 ("full-width background images and ambient sound loops on **key scenes**"), principle 16 ("scene-cinematic videos (Veo) **at key story beats**"), and core-read-loop Requirement 24.2 ("WHEN a **chapter beat or death screen** qualifies for cinematic media") all describe endpoint media. The shipped pipeline drifted into generating a Veo clip on **every** turn (Req 24.2a / 35 i2v chain), which is expensive, incoherent (disconnected 4s clips), and dilutes the "moment."

2. **Omni unlocks capabilities the per-scene pipeline never could:** native synchronized audio, multi-subject reference consistency, conversational/iterative editing, physics-aware generation, and multimodal reasoning that lets a single model **stitch a coherent narrative video from the reader's actual playthrough** — their choices, their party, their key beats — instead of one disconnected shot.

The north star: **a cinematic is a rare, earned, shareable moment** — an opening title sequence, an arc-beat stinger, and above all an **ending cinematic that is the movie of your playthrough**, with your companions, your setting, and a native soundtrack. Moving cinematics from per-turn to endpoint is simultaneously **cheaper** (a 20-turn run drops from ~20 clips to ~2–5 cinematics) and **richer**.

This spec supersedes the per-scene Veo behavior in Requirement 24.2a and the Veo portions of Requirement 35 when `mediaStrategy = endpoint_cinematic`; the per-scene still/anchor pipeline (Req 35 image side) is retained and repurposed as the **reference feed** for endpoint cinematics.

Model-id note: the Gemini native image models are now GA — `gemini-3.1-flash-image` (Nano Banana 2), `gemini-3.1-flash-lite-image` (Nano Banana 2 Lite), `gemini-3-pro-image` (Nano Banana Pro). Req 35's `gemini-3.1-flash-image-preview` reference is updated to the GA id.

---

## Requirements

### Requirement 1 — Media-strategy switch

**User Story:** As the operator (and as a reader in settings), I want to choose how much generated media a run produces, so that we can roll out endpoint cinematics safely and readers can trade cost/richness for speed.

#### Acceptance Criteria

1. WHEN media is resolved for a save THEN Convex SHALL compute an effective `mediaStrategy ∈ { "off", "stills_only", "endpoint_cinematic", "per_scene_legacy" }` from, in precedence order: (a) an operator/env kill-switch, (b) the account's `mediaPrefs.cinematicMode`, (c) the account's entitlement (cinematics require Pro), (d) a default.
2. WHEN `mediaStrategy = "endpoint_cinematic"` THEN Convex SHALL NOT queue a per-turn Veo clip; cinematics are produced only at endpoint triggers (Requirement 2). Per-turn stills MAY still be produced per `stills_only` rules.
3. WHEN `mediaStrategy = "per_scene_legacy"` THEN the existing Req 24.2a / 35 per-scene Imagen→Veo i2v chain SHALL run unchanged (the current behavior).
4. WHEN `mediaStrategy = "stills_only"` THEN only scene stills are produced (no video), using the anchor-consistency pipeline (Req 35 image side).
5. WHEN `mediaStrategy = "off"` THEN no image or video jobs are scheduled; text + narrator TTS only.
6. WHEN the Omni provider is not configured (no `GEMINI_OMNI_MODEL` / API key) THEN `endpoint_cinematic` SHALL degrade to `per_scene_legacy` (or `stills_only` per config) rather than failing, and log a `omni_unconfigured_fallback` metric.
7. WHEN a reader changes `cinematicMode` in `/settings` THEN it SHALL persist to the account (or guest storage) and apply to subsequent triggers immediately; it SHALL NOT retroactively regenerate past cinematics.

### Requirement 2 — Cinematic triggers (endpoints only)

**User Story:** As a reader, I want cinematics to punctuate meaningful moments, so that they feel earned rather than constant.

#### Acceptance Criteria

1. WHEN a save is created AND `mediaStrategy = endpoint_cinematic` THEN Convex SHALL enqueue exactly one **opening cinematic** (an establishing title sequence from the premise, tone, and setting anchor).
2. WHEN the engine completes a **Story Arc Beat** (Requirement 32) THEN Convex MAY enqueue an **arc-beat stinger** cinematic, subject to a per-run cadence cap (Requirement 8) so beats don't over-produce.
3. WHEN the reader crosses a **chapter boundary** (Req 30-series chapter index increments) THEN Convex MAY enqueue a **chapter cinematic**, subject to the same cadence cap.
4. WHEN the save reaches a **terminal ending** (death / success / safe — Requirements 8, 11.4, 19) THEN Convex SHALL enqueue an **ending cinematic** — the highest-value trigger, always produced when strategy permits.
5. WHEN a trigger fires THEN Convex SHALL enqueue at most ONE cinematic per trigger occurrence and SHALL dedupe against an existing non-failed cinematic asset for that `(saveId, trigger, key)`.
6. WHEN cinematic generation is in flight THEN it SHALL NEVER block prose streaming or the read loop (same async, fire-and-forget contract as Req 24.2).

### Requirement 3 — Omni provider and client

**User Story:** As the media system, I want a first-class Omni client, so that cinematics use the latest multimodal video model.

#### Acceptance Criteria

1. WHEN a cinematic job runs THEN it SHALL call **Gemini Omni Flash** (`gemini-omni-flash-preview`, overridable via `GEMINI_OMNI_MODEL`) through a new `convex/media/omniClient.ts` wrapper, distinct from the Veo (`predictLongRunning`) and Imagen clients.
2. WHEN the Omni request is built THEN it SHALL support: a text prompt, an optional first-frame image (i2v), and **multiple subject reference images** (Requirement 4), and SHALL request **native synchronized audio** output (Requirement 6).
3. WHEN Omni returns THEN the client SHALL persist the video (and its audio track) to Convex storage and record provenance (provider `"gemini-omni"`, model, promptHash, references used, duration, resolution, cost estimate, SynthID watermark presence, safety outcome) on the `assets` row.
4. WHEN Omni fails (provider error, safety block, timeout, quota) THEN the job SHALL fall back to the legacy Veo i2v path (if available) or a key still, and log a `omni_cinematic_fallback` metric; the trophy/ending screens SHALL still render from the still.
5. WHEN Omni pricing is estimated THEN the system SHALL record ~`$0.10/sec` (720p) cost on provenance for the operator cost dashboard (Req 15/27), and SHALL respect per-tier quotas (Requirement 8).

### Requirement 4 — Reference accumulation & multi-subject consistency

**User Story:** As a reader, I want the cinematic to show MY protagonist, MY setting, and MY companions, so that it feels like my story.

#### Acceptance Criteria

1. WHEN a run progresses THEN Convex SHALL maintain a bounded **reference set** for the save: the protagonist anchor, the setting anchor (Req 35), the most-relevant **companion NPC portraits** (Req 31 media), and up to N **key-beat stills** (the stills already generated at notable turns).
2. WHEN an endpoint cinematic is generated THEN it SHALL pass the reference set to Omni as multi-subject references (Omni supports multiple subject images), so characters and setting stay consistent across the cinematic's shots.
3. WHEN the reference set exceeds Omni's reference limit THEN Convex SHALL select the highest-salience references (protagonist + setting always; then companions by recency/role; then key beats), and log which were dropped.
4. WHEN no anchors exist (older save, anchor race) THEN the cinematic SHALL proceed text-only or with whatever references are available, and SHALL NOT fail.

### Requirement 5 — Story stitching (the playthrough movie)

**User Story:** As a reader, I want my ending cinematic to be a coherent montage of the journey I actually took, so that it's a keepsake worth sharing.

#### Acceptance Criteria

1. WHEN an ending cinematic is generated THEN Convex SHALL build the prompt from the run's **beat timeline** — an ordered, safety-classified summary of the reader's key decisions and outcomes (derived from turn_history / the story summary / arc-beat completions) — so the cinematic depicts a progression, not a single disconnected shot.
2. WHEN Omni's per-request duration is limited (~10s) THEN the design SHALL support composing a longer sequence via Omni's scene-extension / conversational continuation as those API features become available, degrading gracefully to a single strong shot until then.
3. WHEN the beat timeline is assembled THEN it SHALL pass through the narrative-safety classifier (Req 9/11) before being sent to Omni, exactly as scene prompts are.
4. WHEN the cinematic is persisted THEN it SHALL be linked to the ending's `endings_unlocked` row (Req 8/19) so the trophy crypt can play the reader's own cinematic for that ending.

### Requirement 6 — Native audio soundscape

**User Story:** As a Pro reader, I want the cinematic to sound like the scene, so that the moment lands.

#### Acceptance Criteria

1. WHEN a cinematic is generated THEN it SHALL use Omni's **native synchronized audio** as the diegetic soundscape (ambient / foley reasoned from the visuals), satisfying the "ambient soundscape (Pro)" product feature (principle 14 / Req 24) natively — replacing the need for a separately authored ambient-audio pack in `endpoint_cinematic` mode.
2. WHEN a cinematic plays at an ending THEN the client MAY mix the narrator TTS of the ending prose over the native soundscape at reduced audio duck, respecting the reader's mute preference.
3. WHEN the reader has muted audio or set reduced-motion THEN the cinematic SHALL respect it: muted audio plays silent; reduced-motion holds a poster frame / key still instead of autoplaying video (Req 24.3 parity).

### Requirement 7 — Reader UX: the cinematic moment

**User Story:** As a reader, I want cinematics to feel like a moment, distinct from inline scene art.

#### Acceptance Criteria

1. WHEN an endpoint cinematic is ready THEN the client SHALL present it as a **full-bleed `CinematicMoment`** surface (distinct from the inline `MediaPlate`), with a poster frame, play control, skip, and a replay affordance.
2. WHEN a cinematic is still generating at the moment the reader reaches the endpoint THEN the surface SHALL show the four-state pattern (Skeleton → poster still → buffering → playing) and SHALL fall back to the endpoint's key still if generation hasn't landed, upgrading in place when it does.
3. WHEN the reader is on the endings screen / trophy crypt THEN each unlocked ending with a cinematic SHALL offer inline playback of that reader's own cinematic.
4. WHEN reduced-motion is set THEN the `CinematicMoment` SHALL render the poster still and NOT autoplay.

### Requirement 8 — Cost, entitlement, and cadence

**User Story:** As the operator, I want endpoint cinematics to cost less than per-scene video while staying within tier quotas.

#### Acceptance Criteria

1. WHEN cinematics are produced THEN they SHALL require Pro entitlement (or the dev override), consistent with Req 24.6.
2. WHEN a run uses `endpoint_cinematic` THEN the number of cinematics SHALL be capped per run (e.g., 1 opening + up to K arc/chapter stingers + 1 ending), so total video spend is bounded and materially below the per-scene baseline.
3. WHEN a tier defines media quotas (Req 17) THEN cinematic generation SHALL decrement the video quota and SHALL offer transparent upgrade/overage before exceeding it (Req 24.7 parity).
4. WHEN an operator sets the env kill-switch THEN all cinematic generation SHALL stop and strategy SHALL fall back per Requirement 1.6.

### Requirement 9 — Interactive director's cut (Max tier, phased)

**User Story:** As a Max-tier reader, I want to tweak my ending cinematic in natural language, so that it's truly mine.

#### Acceptance Criteria

1. WHEN a Max-tier reader opens their ending cinematic THEN the UI MAY offer conversational edits ("make it night", "show the betrayal", "slower") that call Omni's conversational-editing surface, each preserving character/audio/camera continuity.
2. WHEN an edit is requested THEN it SHALL pass through the safety classifier (Req 9/11/12) before generation, and SHALL respect mature gating.
3. WHEN an edit completes THEN it SHALL version the cinematic asset (keep the prior version) and decrement the Max-tier interactive quota.
4. This requirement is **phase 4** — later than the core endpoint pipeline; the core is shippable without it.

### Requirement 10 — Publishing & co-op integration

**User Story:** As a reader who shares, I want my ending cinematic to be the hook.

#### Acceptance Criteria

1. WHEN a tale is published (Req 21) AND it has an ending cinematic THEN the published tale MAY feature the cinematic as its lead artifact (subject to mature/safety gating and the owner's consent), giving discovery a video hook instead of a text blurb.
2. WHEN a co-op run reaches an ending (Req 20) THEN Convex MAY produce a single **shared** cinematic attributed to the room, playable by all participants.
3. WHEN a cinematic is shared publicly THEN it SHALL carry SynthID provenance and pass the publishing-surface safety gate (Req 11 publishing).

### Requirement 11 — Safety, provenance, and fallback

**User Story:** As the operator, I want cinematics to obey every existing safety and observability contract.

#### Acceptance Criteria

1. WHEN a cinematic prompt (beat timeline, references, edits) is assembled THEN it SHALL run through the narrative-safety classifier before the Omni call, exactly as scene prompts do (Req 9/11.1).
2. WHEN a cinematic is persisted or rendered THEN it SHALL carry provenance, prompt metadata, provider, cost, safety outcome, and SynthID presence (Req 24.5), and SHALL respect mature gating (Req 12) on every surface.
3. WHEN Omni is unavailable or fails THEN the read loop, endings, and trophy crypt SHALL remain fully functional using the legacy Veo clip or the key still (Requirement 3.4) — cinematics are strictly additive.
4. WHEN a cinematic job runs THEN it SHALL emit analytics (`cinematic.requested|completed|fallback|blocked`, provider, cost, latency) to the operator dashboard (Req 15/27).

### Requirement 12 — Model configuration & migration

#### Acceptance Criteria

1. Image generation SHALL default to the GA `gemini-3.1-flash-image` (Nano Banana 2); `GEMINI_FLASH_IMAGE_MODEL` overrides to `gemini-3-pro-image` (Pro/premium) or `gemini-3.1-flash-lite-image` (cost). (Req 35 model reference updated from the `-preview` id.)
2. Cinematic video SHALL default to `gemini-omni-flash-preview` via `GEMINI_OMNI_MODEL`; Veo 3.1 tiers remain the legacy/fallback provider.
3. The dead `convex/media/imagen.ts` (`imagen-3.0-generate-002`, unused) SHALL be removed; the Imagen fallback in `imagenClient.ts` MAY be retargeted to Nano Banana 2 Lite for consistency.
4. New env vars SHALL be documented: `GEMINI_OMNI_MODEL`, `OMNI_ENABLED` (kill-switch), plus the existing `GEMINI_FLASH_IMAGE_MODEL` / `GEMINI_VEO_MODEL`.

---

## Build Corrections (AUTHORITATIVE — override any conflicting text above)

These seven corrections came out of a code/spec/API review and govern the build. Where they conflict with a requirement above, they win.

**C1 — No server-side "chapter" trigger in P1.** Chapters are a client-only concept (`CHAPTER_TURNS = 4` in `useTurn.ts`, computed from localStorage `choiceHistory`); Convex cannot detect a "chapter boundary." Req 2.3 is deferred. If a chapter trigger is ever added it SHALL be a server turn-number cadence (`turnNumber % N`), not the client notion. **P1 ships opening + ending triggers only.**

**C2 — Arc-beat trigger is contingent on Req 32, which is UNBUILT.** There is no `arcBeat` / `pendingArcBeats` code anywhere. Req 2.2 (arc-beat stingers) is deferred to a phase AFTER Req 32 ships. Do NOT implement arc-beat detection now.

**C3 — Opening cinematic fires AFTER turn-1 anchors land, not at save creation.** The protagonist/setting anchors are generated after turn-1 completion, so a save-creation trigger (Req 2.1) would always be reference-less. The opening trigger SHALL fire once the turn-1 anchor assets exist (the reader is reading turn 1 meanwhile; the title sequence upgrades in behind them).

**C4 — `mediaStrategy` composes with the existing per-modality `mediaPrefs` booleans.** Accounts already carry `imagesEnabled` / `audioEnabled` / `videoEnabled`. The resolver SHALL treat `videoEnabled: false` as capping the effective strategy at `stills_only` (no cinematics), and `imagesEnabled: false` as capping at `off` for the still pipeline. The legacy booleans remain per-modality gates WITHIN a strategy; `cinematicMode` selects the strategy.

**C5 — Ending cinematics link by save, with repeat-unlock handling.** `endings_unlocked` rows are idempotent per `(accountId, endingId)` (first-seen wins), so a second run reaching the same ending has no new unlock row. Cinematics SHALL be keyed to the SAVE (they are `assets` rows with `saveId`). The first cinematic for an ending links to the unlock row; the trophy crypt SHALL list per-save cinematics so repeat playthroughs' cinematics are still reachable.

**C6 — Omni native audio applies to CINEMATICS only.** Req 6.1 does NOT replace per-scene ambient audio loops during normal reading (product principle 14 is a per-scene feature that stays separate/future). Omni native audio satisfies the soundscape AT cinematic moments; it is not the general ambient-audio system.

**C7 — Stitching is single-shot in P1–P2; multi-shot montage is P3 and contingent on the API.** Omni Flash launched with ~10s clips; scene extension and audio-reference inputs are NOT yet in the Gemini API. Through P1–P2 the "playthrough movie" is ONE strong 8–10s shot informed by the (safety-classified) beat timeline. The true multi-shot montage (Req 5.1/5.2) is P3, contingent on Google shipping extension/continuation. The ~$0.10/sec price is a preview estimate — verify on a live key before committing tier pricing/quotas.

**P1 build scope (this team):** the media-strategy switch (Req 1, with C4), the Omni client (Req 3, built to the documented contract, env-gated), cinematics orchestration for the **ending trigger** + opening-after-anchors (Req 2.1 per C3, Req 2.4), the reference set (Req 4, P1: protagonist+setting anchors), the `CinematicMoment` UX + trophy-crypt playback (Req 7, with C5), Veo/still fallback (Req 3.4/11.3), analytics (Req 11.4), and the model-id/env config (Req 12). Deferred: arc-beat (C2), chapter (C1), native-audio-as-ambient (C6), montage (C7), director's cut (Req 9), publishing/co-op cinematics (Req 10).
