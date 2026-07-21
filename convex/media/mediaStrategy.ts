// Media-strategy switch for the omni-cinematics feature (Requirement 1 + C4).
//
// A save's *effective* media behavior is one of four strategies:
//
//   off               — no image or video jobs; text + narrator TTS only.
//   stills_only        — scene stills via the anchor-consistency pipeline; no video.
//   endpoint_cinematic — endpoint cinematics via Gemini Omni (opening + ending);
//                        no per-turn Veo clip. Requires Pro + Omni configured.
//   per_scene_legacy   — the current Imagen -> Veo i2v per-scene chain (default).
//
// The strategy is resolved server-side and *composes* with the existing
// per-modality `mediaPrefs` booleans (build-correction C4):
//   - `imagesEnabled: false` caps the effective strategy at "off" (the still
//     pipeline is the base layer of all media).
//   - `videoEnabled: false` caps it at "stills_only" (no cinematics, no video).
//   - `cinematicMode` (when present) selects the *desired* strategy; when
//     absent the default is "per_scene_legacy" to preserve current behavior.
//   - "endpoint_cinematic" additionally requires an active paid (Pro/Unlimited)
//     entitlement AND a configured, un-killed Omni provider, else it degrades to
//     "per_scene_legacy" (or "stills_only" when video is disabled).
//
// `computeMediaStrategy` is PURE and unit-tested. `resolveMediaStrategy` is the
// thin Convex-side adapter that loads the account + entitlement and delegates.

import { accountFromDoc } from "../lib/docs";
import { loadEntitlementLite } from "../lib/entitlement";
import { hasPaidEntitlement } from "../billing/entitlements";
import { resolveMediaPrefs, type CinematicMode } from "../account";
import { devForceProMedia } from "./proMediaGate";

export type MediaStrategy =
  | "off"
  | "stills_only"
  | "endpoint_cinematic"
  | "per_scene_legacy"
  // Reading-modes R3 (OQ7 = DISTINCT STRATEGY): the Illustrated Book mode. An
  // image-first read with a GUARANTEED still per scene and NO per-turn video —
  // like `stills_only` for generation, but a distinct value so the RESOLVER (not
  // the layout) owns the still guarantee, and so `queueSceneImage`'s
  // credit-exhaustion fallback is MODE-SCOPED to it (keep an unmetered
  // placeholder + emit `outOfCredits` instead of the silent delete every other
  // reader gets). Composes with every existing consumer: the cinematics/video
  // gates all key off `=== "endpoint_cinematic"` / `=== "per_scene_legacy"`, so
  // this value produces neither cinematics nor a per-scene clip.
  | "illustrated_book";

/**
 * Pure strategy resolver. Given the account's `cinematicMode`, its per-modality
 * media toggles, whether it holds a paid entitlement, and whether the Omni
 * provider is enabled, compute the effective `MediaStrategy`.
 *
 * Precedence (build-correction C4):
 *   1. `imagesEnabled: false`            -> "off"          (no media at all)
 *   2. desired = cinematicMode ?? "per_scene_legacy"
 *   3. desired "off"                     -> "off"
 *   4. desired "stills_only"             -> "stills_only"
 *   5. desired "endpoint_cinematic"      -> "endpoint_cinematic" iff (isPro && omniEnabled),
 *                                           else "per_scene_legacy"; then video cap below.
 *   6. desired "per_scene_legacy"        -> "per_scene_legacy"; then video cap below.
 *   video cap: `videoEnabled: false`     -> "stills_only" for any video-bearing strategy.
 */
export function computeMediaStrategy(input: {
  cinematicMode?: CinematicMode;
  imagesEnabled: boolean;
  videoEnabled: boolean;
  isPro: boolean;
  omniEnabled: boolean;
}): MediaStrategy {
  const { cinematicMode, imagesEnabled, videoEnabled, isPro, omniEnabled } = input;

  // Images are the base layer: with them off, nothing renders.
  if (!imagesEnabled) return "off";

  // Absent cinematicMode preserves the current per-scene behavior.
  const desired: MediaStrategy = cinematicMode ?? "per_scene_legacy";

  if (desired === "off") return "off";
  if (desired === "stills_only") return "stills_only";

  // Illustrated Book (R3): image-first with a guaranteed still per scene and no
  // per-turn video. Ignores the video toggle (there is no clip) and needs no
  // Omni provider; the Pro requirement lives at selection + `queueSceneImage`,
  // matching `stills_only`. Its own value lets the still guarantee live in the
  // resolver and scopes the credit-exhaustion placeholder to this mode alone.
  if (desired === "illustrated_book") return "illustrated_book";

  if (desired === "endpoint_cinematic") {
    // Endpoint cinematics require a paid tier AND a configured, un-killed Omni
    // provider; otherwise fall back to the legacy per-scene chain.
    const effective: MediaStrategy = isPro && omniEnabled ? "endpoint_cinematic" : "per_scene_legacy";
    // Video disabled caps any video-bearing strategy at stills.
    return videoEnabled ? effective : "stills_only";
  }

  // desired === "per_scene_legacy"
  return videoEnabled ? "per_scene_legacy" : "stills_only";
}

/**
 * Whether the Omni cinematic provider is enabled from the environment: the
 * `OMNI_ENABLED` kill-switch is NOT set to "0"/"false" AND an API key is
 * configured. Unset `OMNI_ENABLED` defaults to enabled (opt-out kill-switch).
 * The `GEMINI_API_KEY` presence is required because an enabled-but-keyless
 * deploy cannot actually call Omni.
 */
export function omniEnabledFromEnv(): boolean {
  // EXPLICIT opt-in only. Omni Flash is an unvalidated preview model (the client
  // carries TODO(verify-on-live-key) markers) and a Gemini key already exists in
  // every environment for images/Veo — so a default-on gate would silently route
  // Pro readers (whose client default is `endpoint_cinematic`) to the live Omni
  // API. `OMNI_ENABLED` is the master dark-launch switch: it must be set to
  // "1"/"true" AND a key must be present. Unset ⇒ disabled ⇒ endpoint_cinematic
  // degrades to per_scene_legacy (current behavior).
  const flag = process.env.OMNI_ENABLED?.trim().toLowerCase();
  const enabled = flag === "1" || flag === "true";
  const key = process.env.GEMINI_API_KEY;
  const keyed = typeof key === "string" && key.trim().length > 0;
  return enabled && keyed;
}

/**
 * Convex-side adapter: load the account + entitlement, resolve the media prefs,
 * and compute the effective strategy. Tolerates a missing account (returns
 * "off" — a caller with no account should schedule no media). `ctx.db` is typed
 * loosely so this helper works from both query and mutation/action contexts
 * without pulling in Convex's generated types.
 */
export async function resolveMediaStrategy(
  ctx: { db: any },
  accountId: string,
): Promise<MediaStrategy> {
  const doc = await ctx.db.get(accountId);
  if (!doc) return "off";

  const account = accountFromDoc(doc as Record<string, unknown>);
  const prefs = resolveMediaPrefs(account);
  const entitlement = await loadEntitlementLite(ctx, accountId);
  // Dev/demo override: `CYOA_DEV_FORCE_PRO_MEDIA=1` already unlocks per-scene
  // media for every account (see proMediaGate + sceneMedia.ts). Extend the same
  // switch to the cinematic strategy so the dev/tunnel env shows the FULL
  // intended experience — endpoint Omni cinematics, per-scene video retired —
  // without needing a real paid entitlement. In prod the flag is unset, so this
  // collapses to the real `hasPaidEntitlement` gate. UNSET in prod.
  const devUnlocked = devForceProMedia();
  const isPro = (entitlement ? hasPaidEntitlement(entitlement) : false) || devUnlocked;
  // Pro media default flip (provider-and-credit-model design §2.4): when a Pro
  // (or dev-force-unlocked) reader hasn't explicitly picked a mode, default to
  // the endpoint-cinematic experience — cinematics at the endpoints (opening +
  // ending + ≤2 chapter stingers, already capped), NOT a Veo clip on every scene
  // (which is where Pro video COGS blew past price). `computeMediaStrategy`
  // degrades this to `per_scene_legacy` when Omni isn't configured, and non-Pro
  // readers keep the `per_scene_legacy` default (they can't reach cinematics).
  const cinematicMode: CinematicMode | undefined =
    prefs.cinematicMode ?? (isPro ? "endpoint_cinematic" : undefined);

  return computeMediaStrategy({
    ...(cinematicMode ? { cinematicMode } : {}),
    imagesEnabled: prefs.imagesEnabled,
    videoEnabled: prefs.videoEnabled,
    isPro,
    omniEnabled: omniEnabledFromEnv(),
  });
}
