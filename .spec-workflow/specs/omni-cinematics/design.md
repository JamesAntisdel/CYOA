# Design Document — Omni Cinematics & Endpoint Media

## Overview

Replace the per-turn Veo clip with **endpoint cinematics** produced by Gemini Omni Flash, gated behind a **media-strategy switch**. The per-scene still/anchor pipeline is retained and repurposed as the **reference feed**. The headline deliverable is the **ending cinematic**: a coherent, native-audio, multi-reference "movie of your playthrough" linked to the unlocked ending.

Core invariants (unchanged from core-read-loop): engine is pure; Convex is authoritative; LLM/media are content providers only; safety gates run before prompting and before rendering; media never blocks the read loop; default content is general-audience.

## Key concepts

- **Media strategy** — one of `off | stills_only | endpoint_cinematic | per_scene_legacy`, resolved server-side from env kill-switch → account `mediaPrefs.cinematicMode` → entitlement → default. Single resolver `resolveMediaStrategy(ctx, account, entitlement)` in `convex/media/mediaStrategy.ts`; every media scheduling site consults it.
- **Cinematic trigger** — `opening | arc_beat | chapter | ending{death,success,safe}`. Detected in the turn/engine completion path; enqueues at most one cinematic per occurrence, deduped by `(saveId, trigger, key)`.
- **Reference set** — bounded, salience-ranked images for a save: protagonist anchor + setting anchor (always) → companion NPC portraits (by role/recency) → key-beat stills. Stored/derived from existing `assets`; assembled by `buildCinematicReferences(save)`.
- **Beat timeline** — an ordered, safety-classified summary of the reader's key decisions/outcomes (from turn_history + storySummary + arcBeatCompletions), the narrative spine of the stitched cinematic.
- **Cinematic asset** — a new asset `kind: "cinematic"` (distinct from `image` / `video`), carrying `trigger`, `references[]`, `beatTimelineHash`, provider `"gemini-omni"`, audio track, SynthID flag, cost. Linked to `endings_unlocked` for ending cinematics.

## Architecture

```
turn completion / engine terminal / arc-beat / chapter
        │
        ▼
 detectCinematicTrigger(save, event)         ← convex/media/cinematicTriggers.ts
        │ (strategy = endpoint_cinematic, Pro, within cadence cap)
        ▼
 queueEndpointCinematic({saveId, trigger})   ← convex/media/cinematics.ts
        │  builds beatTimeline (safety-classified) + reference set
        ▼
 runOmniCinematicJob (action)                ← convex/media/cinematics.ts
        │  omniClient.generateCinematic({prompt, references[], i2vStill?, audio:true})
        ▼  ← convex/media/omniClient.ts  (gemini-omni-flash-preview)
 store video+audio → assets(kind:"cinematic") + provenance + analytics
        │  on failure → Veo i2v fallback → key still
        ▼
 reactive query → <CinematicMoment/>          ← apps/app/components/media/CinematicMoment.tsx
                  trophy crypt inline playback ← endings screen
```

Legacy path (`per_scene_legacy`) is the current `runImagenJob → queueSceneVideo` chain, untouched and selected by the strategy resolver.

## Components / file ownership

- `convex/media/mediaStrategy.ts` (new) — strategy resolver + env kill-switch.
- `convex/media/cinematicTriggers.ts` (new) — pure trigger detection from a turn/terminal/beat event (unit-tested).
- `convex/media/cinematics.ts` (new) — `queueEndpointCinematic`, `runOmniCinematicJob`, `buildCinematicReferences`, `buildBeatTimeline`; cadence caps; dedupe; fallback.
- `convex/media/omniClient.ts` (new) — Omni API wrapper (request build, long-running/interactions poll, video+audio persist). Pure request-builder exported for tests.
- `convex/game.ts` (edit, media agent) — call `detectCinematicTrigger` at completion/terminal/arc-beat sites; gate per-scene `queueSceneVideo` on strategy.
- `convex/schema.ts` (edit) — `assets.kind` gains `"cinematic"`; `mediaPrefs.cinematicMode`; link field on `endings_unlocked` (or reuse asset `sceneId`/new `endingId`).
- `apps/app/components/media/CinematicMoment.tsx` (new) — full-bleed cinematic surface (four-state, poster, skip, replay, reduced-motion).
- `apps/app/app/endings/*` + `TrophyCrypt` (edit) — inline cinematic playback per unlocked ending.
- `apps/app/app/settings/*` (edit) — `cinematicMode` control.
- `convex/analytics*` (edit) — `cinematic.*` metrics.

## Cost model

Per-scene baseline (legacy): ~20 turns × Veo Lite 4s @ $0.05/s ≈ **$4.00 / run**, all silent, disconnected.
Endpoint cinematics (Omni): 1 opening + ~2 stingers + 1 ending, ~8s each @ ~$0.10/s ≈ **~$3.20 / run**, native audio, coherent, shareable — and typically fewer produced for shorter runs. Net: **lower spend, higher value**, and the switch lets us tune the cadence cap to any budget. Cinematics stay Pro-gated; quotas per Req 17.

## Safety & provenance

Beat timeline + reference selection + any conversational edit pass the narrative-safety classifier before the Omni call (Req 9/11.1). Persisted cinematics carry provenance + SynthID + safety outcome (Req 24.5) and obey mature gating on every surface. Omni failure is strictly additive-loss: fall back to Veo clip or key still; endings/trophy always render.

## Phased plan

- **Phase 0 — Model ids (DONE).** Nano Banana 2 GA (`gemini-3.1-flash-image`); anchor path aligned to the resolver; test updated. Update Req 35 doc reference.
- **Phase 1 — Switch + Omni client + ending cinematic (behind flag).** `mediaStrategy` resolver + `cinematicMode` setting; `omniClient.ts`; `cinematics.ts` with the **ending** trigger only (highest value, lowest volume); `assets.kind:"cinematic"`; `CinematicMoment` on the death/ending screen + trophy crypt; Veo fallback; analytics. Ships dark (flag off) → Pro opt-in.
- **Phase 2 — Reference set + native audio + more triggers.** Companion NPC portraits + key-beat stills in the reference set; native-audio soundscape + narrator mix; add **opening**, **arc-beat**, **chapter** triggers with cadence caps; retire per-scene Veo for `endpoint_cinematic` readers.
- **Phase 3 — Story stitching.** Beat-timeline montage; multi-shot sequencing via Omni extension/continuation as the API exposes it; trophy-crypt "watch your legend" playback.
- **Phase 4 — Director's cut + sharing.** Max-tier conversational editing (versioned assets, quota); published-tale lead cinematic; co-op shared cinematic; seasons features.

## Open decisions (for product)

1. **Default strategy per tier** — recommend: existing readers stay `per_scene_legacy`; new Pro readers default `endpoint_cinematic` once Omni is validated; Free → `stills_only`/`off`.
2. **Cadence cap** — recommend 1 opening + ≤2 stingers + 1 ending per run (tunable).
3. **Audio mix at endings** — native soundscape only, vs ducked narrator over it (recommend the latter for the finale).
4. **Interactive editing tier** — Max-only (Phase 4), or a metered credit pack.
