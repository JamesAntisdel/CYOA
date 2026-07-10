# Tasks — Omni Cinematics & Endpoint Media

Governed by requirements.md (esp. the AUTHORITATIVE "Build Corrections" C1–C7) and design.md.

## Phase 0 — Model ids (DONE)
- [x] Image default → GA `gemini-3.1-flash-image` (Nano Banana 2); anchor path routed through `resolveGeminiImageModel()`; test + Req 35 doc updated.

## Phase 1 — Switch + Omni client + ending cinematic (IN PROGRESS — 3-agent build behind the flag)

Shared foundation applied by the integrator (done): `schema.ts` (assets `kind:"cinematic"`, provider `gemini-omni`, `cinematicTrigger`/`endingId`/`hasAudio`, `by_save_kind` index; `mediaPrefs.cinematicMode`); `account.ts` `MediaPrefs.cinematicMode` + resolvers.

- [x] **Foundation (agent 1):** `convex/media/mediaStrategy.ts` (`computeMediaStrategy` pure + `resolveMediaStrategy`, C4 caps + Pro/omni gates) and `convex/media/omniClient.ts` (`gemini-omni-flash-preview`, pure `buildOmniRequestBody`, submit/poll bridged to the **Interactions API** + Files poll, key-scrubbed errors) + unit tests. Confirmed Omni is the synchronous Interactions API (not Veo predictLongRunning); `TODO(verify-on-live-key)` on duration/resolution/audio wire shape.
- [x] **Orchestration (agent 2):** `cinematicTriggers.ts` (ending + opening-after-anchors C3; NO chapter/arc-beat), `cinematics.ts` (`queueEndpointCinematic`/`runOmniCinematicJob`/`pollOmniCinematicJob`, `buildCinematicReferences`, safety-classified `buildBeatTimeline`, dedupe C5, still fallback, `cinematic.*` analytics), `cinematicFunctions.ts` (`getSaveCinematics` per-save query); `game.ts` wiring (ending at terminal, opening after turn-1 anchors); `sceneMedia.ts` gate (skip per-scene Veo unless `per_scene_legacy`) + tests.
- [x] **Client (agent 3):** `cinematicApi.ts`, full-bleed `CinematicMoment.tsx` (four-state, reduced-motion poster, native-audio+mute), ending-surface wiring through all five layouts + upgrade-in-place polling, trophy-crypt per-save aggregation (C5), `/settings` `cinematicMode` control + vitest.
- [x] **Integration (integrator):** reconciled the client↔server view shape (`{cinematics}` unwrap + `trigger`→`cinematicTrigger`); `setMediaPrefs` mutation accepts + persists `cinematicMode` (Convex rejects unknown args, and the resolver must see the choice); **flipped `omniEnabledFromEnv` to explicit opt-in** (`OMNI_ENABLED=1` required — was default-on wherever a Gemini key exists, which would have routed Pro readers to the unvalidated preview API); full typecheck + 582-test sweep green. No `index.ts` barrel needed (pure helpers + auto-discovered `*Functions`).

**SHIPPED DARK.** `OMNI_ENABLED` unset ⇒ `omniEnabledFromEnv()=false` ⇒ every reader resolves to `per_scene_legacy` (current behavior), regardless of the client's aspirational `endpoint_cinematic` default. To activate for Pro: set `OMNI_ENABLED=1` (+ `GEMINI_OMNI_MODEL` if overriding) AND validate the Omni request/response + native-audio track on a live key (clear the `TODO(verify-on-live-key)` markers).

## Phase 2 + sharing — DONE (3-agent build; integrated; 604 tests green)

- [x] **Enrichment (agent 1):** `buildCinematicReferences` adds companion NPC portraits + salience-ranked key-beat stills (Req 4.1–4.4, cap 6); richer safety-classified `buildBeatTimeline`; **server turn-cadence chapter trigger** (`CHAPTER_CINEMATIC_TURNS=6`, cap 2/run, C1-compliant); per-scene video retired *before scheduling* under non-legacy strategies.
- [x] **Client polish (agent 2):** native-audio + ducked-narrator mix in `CinematicMoment` (`NATIVE_AUDIO_DUCK=0.25`, Req 6.2/6.3); "❖ cinematic ready" badge; "watch your legend" trophy playback (single strong shot).
- [x] **Sharing (agent 3, Req 10):** published-tale lead cinematic denormalized onto `published_tales.leadCinematic` (owner-consented, safety-gated, survives source purge); co-op `getRoomCinematic` shared ending cinematic; tale + coop screens play it.
- [x] **Integration:** `published_tales.leadCinematic` schema field; widened server `CinematicView.trigger` for `"chapter"`; full typecheck + test sweep.

Deferred with reason: **P3 montage** — blocked on Omni scene-extension API (C7); **Req 9 director's cut** — speculative/Max-tier, unvalidated; **Req 32 arc-beat trigger** — needs the arc-beats engine feature first (C2); **SSO** — needs real provider credentials.

Small follow-up (optional): thread the ending-prose narrator URI from `ReaderScreen` into the reader-ending `CinematicMoment` so the narrator ducks over the finale (props are ready; Omni native audio already plays without it).

## DEPLOYED (2026-07-07) — enable-now path chosen
- Stack is dockerized (`cyoa-local` compose): `cyoa-local-convex-1` (backend), `cyoa-local-app-1` (web serve :8081), `cyoa-local-cloudflared-1` (tunnel).
- Convex functions + schema: live (convex dev in-container auto-pushes the mounted repo).
- `OMNI_ENABLED=1` set on the container backend (verified).
- Web: `docker compose restart app` re-exported the current code; the live `:8081` bundle now carries the cinematics UI (`CinematicMoment`/`getSaveCinematics`/`getRoomCinematic`), served through cloudflared.

## REMAINING VALIDATION (Omni request shape)
The Omni Interactions request/response + native-audio shape still has `omniClient.ts` `TODO(verify-on-live-key)` markers. Now that it's live + enabled, a **Pro** account reaching an ending exercises the real API: watch `cyoa-local-convex-1` logs for `cinematic.requested → completed` (confirmed) vs `→ fallback` (request shape wrong → fix `omniClient.ts` to the real response, safe meanwhile — reader gets the still).

## Phase 2 details — References + native audio + more triggers
- [ ] Reference set gains companion NPC portraits + key-beat stills (salience-ranked, Req 4.3).
- [ ] Native-audio soundscape at cinematics + optional ducked-narrator mix (Req 6; C6 keeps per-scene ambient separate).
- [ ] Opening/ending refinements; retire per-scene Veo for endpoint readers; "your cinematic is ready" trophy-crypt badge.
- [ ] Server turn-cadence "chapter" trigger IF wanted (C1). Arc-beat stinger trigger is BLOCKED on Req 32 shipping (C2).

## Phase 3 — Story stitching (DEFERRED — contingent on Omni API)
- [ ] Multi-shot montage from the beat timeline via Omni scene-extension/continuation once the Gemini API exposes it (C7). Until then, single strong 8–10s shot.
- [ ] Trophy-crypt "watch your legend" playback.

## Phase 4 — Director's cut + sharing (DEFERRED)
- [ ] Max-tier conversational editing (versioned assets, quota) — Req 9.
- [ ] Published-tale lead cinematic + co-op shared cinematic — Req 10.

## Cross-cutting
- [ ] Verify `~$0.10/sec` Omni pricing on a live key before committing tier quotas (C7).
- [ ] Consider consolidating the untanged `convex/media/imagen.ts` (imagen-3.0, not in the live path but referenced by `media.test.ts`) — Req 12.3, low priority.
