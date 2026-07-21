import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppNav } from "../navigation";
import { AiSceneFlag } from "../moderation";
import { DailyPulseChip } from "../daily";
import { Text } from "../primitives";
import { useAccountProfile } from "../../hooks/useAccountProfile";
import { useLibrary } from "../../hooks/useLibrary";
import { useReaderSettings } from "../../hooks/useReaderSettings";
import { guestAuthArgs, useGuestSession } from "../../hooks/useGuestSession";
import { hasRemoteGameApi, restartRemoteRun } from "../../lib/gameApi";
import {
  listRemoteSaveCinematics,
  pickChapterCinematic,
  pickEndingCinematic,
  type RemoteCinematicView,
} from "../../lib/cinematicApi";
import { CinematicMoment } from "../media/CinematicMoment";
import { useSceneMedia } from "../../hooks/useSceneMedia";
import { useStreamingScene } from "../../hooks/useStreamingScene";
import { useTurn, type ChoiceProjection } from "../../hooks/useTurn";
import { useAutoNarrator } from "../../hooks/useAutoNarrator";
import { PATRON_TIERS_BY_ID, resolvePatronTier } from "../../lib/billingConfig";
import { useBreakpoint } from "../../lib/responsive";
import { useAppTheme } from "../../theme";
import { ChapterEnd } from "./ChapterEnd";
import { DoorsJournal } from "./DoorsJournal";
import { QuestLine } from "./QuestLine";
import { ThreadsPill } from "./ThreadsPill";
import { CandleBurnMeter, CandleGutterInterstitial } from "./CandleGutter";
import { SoftSignupRibbon } from "./SoftSignupRibbon";
import {
  hasDismissedSoftSignup,
  markSoftSignupDismissed,
  SOFT_SIGNUP_TURN,
} from "./softSignup";
import { READER_LAYOUTS } from "./layouts";
import { NovelLayout } from "./layouts/Novel";
import { liveMediaMatchesScene, mergeLiveMediaIntoProjection } from "./mergeLiveMedia";
import { ReaderSettingsDrawer } from "./ReaderSettingsDrawer";
import { actStampFromDiffs } from "../../lib/storyEngagement";
import {
  mementoStampLine,
  rankTickerLine,
  type RemoteRankProgress,
} from "../../lib/storyEngagementW3";
import {
  candleBurnModel,
  getRemoteDailyTurnState,
  type RemoteDailyTurnState,
} from "../../lib/dailyTurnApi";

/**
 * Storage key the user explicitly chose a non-default layout. Set as a side
 * effect when /settings flips the layout — see the comment on
 * `resolveActiveLayout` below for why the override is necessary.
 */
const READER_LAYOUT_OVERRIDE_KEY = "cyoa.readerLayoutChosen.v1";

/**
 * Pick the layout to actually render this turn.
 *
 * The stored `settings.layout` defaults to "book" for first-time readers.
 * On a 375 px phone the Book layout still works (its prose surface scales
 * to viewport width), but the Mobile layout is the canvas's pick for thumb
 * reach + tight gutter — so on phone viewports we override to "mobile"
 * UNLESS the user has explicitly picked another layout from /settings.
 *
 * Override detection: we keep the stored `layout` value untouched (so it
 * still round-trips through useReaderSettings) and gate on a separate
 * `cyoa.readerLayoutChosen.v1` flag that /settings writes when the user
 * picks a layout from the variant picker. When the flag is absent and the
 * viewport is phone-sized, we render Mobile. Desktop and tablet always
 * honor the stored value.
 */
function resolveActiveLayout(
  storedLayout: keyof typeof READER_LAYOUTS,
  isPhone: boolean,
): keyof typeof READER_LAYOUTS {
  if (!isPhone) return storedLayout;
  // The user has explicitly picked a layout in /settings — honor it.
  if (hasExplicitLayoutOverride()) return storedLayout;
  // Phone, no explicit pick → mobile.
  return "mobile";
}

function hasExplicitLayoutOverride(): boolean {
  if (typeof globalThis === "undefined") return false;
  const storage = (globalThis as { localStorage?: Storage }).localStorage;
  if (!storage) return false;
  try {
    return storage.getItem(READER_LAYOUT_OVERRIDE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Mark that the user has explicitly chosen a layout. Called from /settings'
 * layout picker. Exported so the settings screen can drop the flag without
 * reaching into the storage key directly.
 */
export function markLayoutAsExplicitlyChosen(): void {
  if (typeof globalThis === "undefined") return;
  const storage = (globalThis as { localStorage?: Storage }).localStorage;
  if (!storage) return;
  try {
    storage.setItem(READER_LAYOUT_OVERRIDE_KEY, "1");
  } catch {
    /* ignore */
  }
}

type ReaderScreenProps = {
  saveId: string;
};

/**
 * Conditional-spread the ChapterEnd act stamp (BC4 — exactOptionalPropertyTypes).
 * Returns `{}` when the boundary turn didn't advance an act so the optional
 * `actNumber`/`actLabel` props are omitted rather than passed as `undefined`.
 */
function actStampProps(
  stamp: ReturnType<typeof actStampFromDiffs>,
): { actNumber?: number; actLabel?: string } {
  if (!stamp) return {};
  return { actNumber: stamp.actNumber, ...(stamp.actLabel ? { actLabel: stamp.actLabel } : {}) };
}

/**
 * Conditional-spread the ChapterEnd act-boundary lines (act-mementos R3.4, AM5).
 * ONLY when the boundary turn advanced an act (a stamp) do we surface the
 * memento acknowledgement and the rank ticker; otherwise `{}` so both optional
 * props are omitted, never passed as `undefined` (BC4). The ticker is sourced
 * from the already-fetched profile `rankProgress` — no new polling — and is
 * dropped at the top tier (absent progress). A non-act boundary returns `{}`,
 * keeping ChapterEnd byte-identical to today (BC9).
 */
function actBoundaryLineProps(
  stamp: ReturnType<typeof actStampFromDiffs>,
  rankProgress: RemoteRankProgress | undefined,
): { mementoLine?: string; rankTickerLine?: string } {
  if (!stamp) return {};
  return {
    mementoLine: mementoStampLine(),
    ...(rankProgress ? { rankTickerLine: rankTickerLine(rankProgress) } : {}),
  };
}

/**
 * Poll the save's endpoint cinematics for the ending trigger
 * (omni-cinematics Req 7.2). Kept inline in ReaderScreen rather than a
 * standalone hook file to stay within the feature's client surface. Only
 * runs once the reader has actually reached an ending (`active`), so a
 * normal read loop never fires the query. Keeps polling while the ending
 * cinematic is queued/generating so the surface upgrades in place, then
 * settles once it lands (or the save has no cinematic).
 *
 * Returns `undefined` until the first response and when no remote backend
 * is wired — the caller falls back to the ending panel's existing still.
 */
type SaveCinematics = {
  /** All cinematics for the save, newest-first. */
  views?: RemoteCinematicView[] | undefined;
  /** The ending cinematic to surface on the ending screen. */
  ending?: RemoteCinematicView | undefined;
};

/** Stable key so the poll only re-renders when a cinematic's identity/status changes. */
function cinematicsKey(views: RemoteCinematicView[] | undefined): string {
  return (views ?? [])
    .map((v) => `${v.assetId}:${v.status}`)
    .sort()
    .join(",");
}

/**
 * Poll the save's endpoint cinematics and surface the opening title, the latest
 * chapter stinger, and the ending clip (omni-cinematics Req 7). Runs for the
 * whole read (not just the ending) so the opening/chapter surfaces light up as
 * their jobs land. Polls fast (4s) while any cinematic is generating, else a
 * slow heartbeat (12s) so a later chapter/ending is still picked up. Inert
 * without a remote backend — the panels fall back to their existing stills.
 */
function useSaveCinematics(
  saveId: string,
  auth: { accountId: string; guestTokenHash?: string } | undefined,
  active: boolean,
): SaveCinematics {
  const [views, setViews] = useState<RemoteCinematicView[] | undefined>(undefined);

  useEffect(() => {
    if (!active || !auth?.accountId || !hasRemoteGameApi()) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      const next = await listRemoteSaveCinematics({
        accountId: auth.accountId,
        saveId,
        ...(auth.guestTokenHash ? { guestTokenHash: auth.guestTokenHash } : {}),
      });
      if (cancelled) return;
      const resolved = next ?? undefined;
      setViews((prev) => (cinematicsKey(prev) === cinematicsKey(resolved) ? prev : resolved));
      const anyInFlight = (resolved ?? []).some(
        (v) => v.status === "queued" || v.status === "generating",
      );
      timer = setTimeout(tick, anyInFlight ? 4000 : 12000);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, auth?.accountId, auth?.guestTokenHash, saveId]);

  return {
    views,
    ending: pickEndingCinematic(views) ?? undefined,
  };
}

/**
 * Panel-2 Wave 2 — the reader's daily turn-budget state (drives the in-reader
 * burn meter + the candle-gutter interstitial). Turn state is per-ACCOUNT (not
 * per-save), so we fetch by accountId and refetch whenever the reader advances a
 * turn (`turnNumber`) — that's exactly when the spent count changes. Inert
 * without a remote session (local/tutorial saves) OR when the server query
 * isn't deployed yet: both return null and the caller renders neither surface
 * (fail-open — our UI never phantom-gates a reader).
 */
function useDailyTurnState(
  auth: { accountId: string; guestTokenHash?: string } | undefined,
  turnNumber: number,
): RemoteDailyTurnState | null {
  const [state, setState] = useState<RemoteDailyTurnState | null>(null);
  const accountId = auth?.accountId;
  const guestTokenHash = auth?.guestTokenHash;
  useEffect(() => {
    if (!accountId) {
      setState(null);
      return;
    }
    let cancelled = false;
    void getRemoteDailyTurnState({
      accountId,
      ...(guestTokenHash ? { guestTokenHash } : {}),
    }).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, guestTokenHash, turnNumber]);
  return state;
}

/**
 * The single opening/chapter cinematic to surface inline right now: the NEWEST
 * one that is fully ready and hasn't been acknowledged yet. Views are newest-
 * first, so `find` returns the most recent unseen clip — this is what stops an
 * old chapter's video showing at a new boundary (the previous per-trigger pick
 * fell back to any older ready clip while the new one was still generating) and
 * stops the opening lingering/replaying across the whole read.
 */
function pickInlineMoment(
  views: RemoteCinematicView[] | undefined,
  seen: ReadonlySet<string>,
): RemoteCinematicView | null {
  if (!views) return null;
  // Opening title only — the chapter stinger shows at the chapter-end recap
  // (where the reader expects it), not inline.
  //
  // Surface the opening while it's STILL GENERATING (not just when ready) so
  // page 1 shows the flashing "rendering…" loader from the first moment and
  // then upgrades in place to the video when it lands. `useSaveCinematics`
  // polls every 4s while in-flight, so the same view flips generating → ready
  // under the mounted CinematicMoment (its four-state resolver handles both).
  // failed/blocked openings are excluded so the loader never hangs forever.
  return (
    views.find(
      (v) =>
        v.cinematicTrigger === "opening" &&
        !seen.has(v.assetId) &&
        (v.status === "queued" ||
          v.status === "generating" ||
          (v.status === "ready" && Boolean(v.url))),
    ) ?? null
  );
}

/**
 * ReaderScreen is now a thin shell: it owns the scene-state pipeline (useTurn
 * + useStreamingScene) and dispatches on the user's persisted layout setting.
 * All five layouts under `./layouts` receive the same projection, so a single
 * setting change re-renders the chrome without touching turn state.
 */
export function ReaderScreen({ saveId }: ReaderScreenProps) {
  const router = useRouter();
  const { reduceMotion, tokens } = useAppTheme();
  const { settings, updateSettings } = useReaderSettings();
  // Stable callback so SceneMedia / NarratorControl receive a referentially
  // equal handler across renders — keeps the pill picker's onPress identity
  // stable and avoids any equality-driven re-renders downstream.
  const setNarratorPlaybackRate = useCallback(
    (narratorPlaybackRate: number) => updateSettings({ narratorPlaybackRate }),
    [updateSettings],
  );
  const {
    pendingChoiceId,
    projection,
    submitChoice,
    submitFreeformChoice,
    supportsFreeform,
    freeformPending,
    freeformError,
    chapterBoundary,
    acknowledgeChapter,
    recentChoiceEcho,
    choiceHistory,
    retryCurrentTurn,
  } = useTurn(saveId);
  const { isStreaming, streamedProse } = useStreamingScene(projection.scene, {
    reducedMotion: reduceMotion || settings.reduceMotion,
  });

  // Live Pro-media projection. Polls the Convex assets table for an Imagen
  // job tied to the active scene. When ready, replaces the projection's
  // media field so MediaPlate can advance from Skeleton → Image. Falls
  // through to whatever the projection already carries when no remote
  // backend is wired (in-memory tutorial).
  const guest = useGuestSession();
  const liveMedia = useSceneMedia(
    saveId,
    guest.session
      ? { accountId: guest.session.accountId, ...guestAuthArgs() }
      : undefined,
    // Pass scene id so polling resets when the user advances to a new
    // scene — otherwise we'd sit on the previous scene's settled backoff
    // (up to 60s) and the new scene's queued media wouldn't surface.
    projection.scene.id,
  );
  // Scene-identity-gated merge. See `mergeLiveMedia.ts` for the full
  // rationale — short version: `useSceneMedia` polls by saveId and follows
  // the server's `save.currentSceneId`, which flips on `beginStreamingChoice`
  // before `useTurn` has finished resolving the canonical projection. The
  // gate prevents narrator audio for scene N+1 from playing over scene N's
  // still-visible prose.
  const sceneIdsMatch = liveMediaMatchesScene(liveMedia, projection.scene.id);
  const projectionWithLiveMedia = mergeLiveMediaIntoProjection(projection, liveMedia);

  // Resolve the death-variant props the layouts forward to <EndingPanel>.
  //  - tier: derived from useAccountProfile so the Cinematic gate matches
  //    the live entitlement.
  //  - cinematicUri: only set when useSceneMedia has a ready video asset —
  //    Cinematic falls back to Brutal when the URI is absent.
  //  - isFirstFind: TODO(Wave E) — real lookup against `endings_unlocked`.
  //    Until then pass `true` so eligible tier+asset reads can still fire
  //    Cinematic in QA without re-playing on the wrong account.
  const { profile, claimWithEmail, rankProgress } = useAccountProfile();
  const endingTier = profile
    ? resolvePatronTier({
        entitlement: profile.entitlementTier,
        isClaimed: profile.kind !== "guest",
      })
    : PATRON_TIERS_BY_ID.wanderer;
  // Same identity gate as the narrator merge above — a cinematic that
  // resolved for the just-advanced scene N+1 shouldn't play over scene N's
  // still-visible ending panel.
  const cinematicUri =
    liveMedia &&
    sceneIdsMatch &&
    liveMedia.kind === "video" &&
    liveMedia.status === "ready" &&
    liveMedia.uri
      ? liveMedia.uri
      : undefined;
  const endingIsFirstFind = true;

  // Endpoint (Omni) ending cinematic. Polled only once the reader reaches
  // an ending; upgrades in place when a queued/generating cinematic lands.
  // When present the active layout renders a full-bleed <CinematicMoment>
  // above the ending panel; absent, the panel's existing still carries it.
  // Endpoint (Omni) cinematics for the whole read — opening title + chapter
  // stingers show once inline (below); the ending clip is routed to the ending
  // screen.
  const remoteAuth = guest.session
    ? { accountId: guest.session.accountId, ...guestAuthArgs() }
    : undefined;
  const { views: cinematicViews, ending: endingCinematic } = useSaveCinematics(
    saveId,
    remoteAuth,
    Boolean(remoteAuth),
  );
  // Show each opening/chapter cinematic exactly once, when it's ready, then
  // retire it by asset id. This prevents an old clip re-appearing at a new
  // boundary and the opening lingering/replaying across the read.
  const [seenCinematics, setSeenCinematics] = useState<ReadonlySet<string>>(() => new Set());
  const markCinematicSeen = useCallback((assetId: string) => {
    setSeenCinematics((prev) => {
      if (prev.has(assetId)) return prev;
      const next = new Set(prev);
      next.add(assetId);
      return next;
    });
  }, []);
  // Terminal-panel promises (core-read-loop Req 8.3 / story-engagement R14.2).
  // "Begin again" mints a FRESH save of the SAME story and opens its reader —
  // the tap must never be dead.
  //
  // PRIMARY path (panel-review-2 ranked idea 5): PANEL-SERVER's `restartRun`
  // mutation copies the ended save's storyId + seed identity (premise/tone/
  // NPCs/voice) server-side. This is the ONLY path that works for the runs
  // shipped by the creator arc — community `authored_seed:<id>` runs and
  // SeedStoryFlow premise runs — where the old client `createSave` restart
  // threw `story_not_found` (the seed storyId isn't in the starter catalog)
  // or silently reopened the blank open-canvas shell.
  //
  // FALLBACK: when `restartRun` isn't deployed yet (server error → null) or
  // there is no remote session (local/tutorial saves), fall back to the cover
  // screen's create-save flow (useLibrary.createSave + `forceNew` so it never
  // resumes the just-ended run) — still correct for the 4 bundled starters.
  // Guest/limit/network failures fall back to the story cover. The in-flight
  // ref suppresses double-taps synchronously.
  const library = useLibrary(guest.session);
  const beginAgainInFlightRef = useRef(false);
  const beginAgain = useCallback(async () => {
    if (beginAgainInFlightRef.current) return;
    beginAgainInFlightRef.current = true;
    try {
      // Preferred: server-side restart copies seed identity off the ended
      // save — the client never re-derives the title from the starter
      // catalog, so seeded / community runs restart correctly.
      if (remoteAuth) {
        const restarted = await restartRemoteRun({
          accountId: remoteAuth.accountId,
          ...(remoteAuth.guestTokenHash ? { guestTokenHash: remoteAuth.guestTokenHash } : {}),
          saveId,
        });
        if (restarted?.saveId) {
          router.push(`/read/${restarted.saveId}`);
          return;
        }
      }
      const storyId = projection.storyId;
      if (!storyId) {
        // No story identity on this projection (legacy/demo shell) — the
        // cover screen is the closest place to start over from.
        router.push("/");
        return;
      }
      // Fresh runs always restart in Story mode: Hardcore requires the
      // explicit consent gate in the seed flow, so we never auto-relaunch it.
      const save = await library.createSave(storyId, "story", undefined, undefined, undefined, {
        forceNew: true,
      });
      router.push(`/read/${save.saveId}`);
    } catch {
      // guest_session_required / save limits / network — land on the cover
      // so the reader can restart from there.
      router.push("/");
    } finally {
      beginAgainInFlightRef.current = false;
    }
  }, [library, projection.storyId, remoteAuth, router, saveId]);

  const inlineMoment = pickInlineMoment(cinematicViews, seenCinematics);
  const showInlineMoment = Boolean(inlineMoment) && !projection.ending && !chapterBoundary;
  // The chapter stinger shown at the chapter-end recap: the newest chapter
  // cinematic (ready or still generating — the four-state loader handles it).
  const chapterCinematic = pickChapterCinematic(cinematicViews) ?? undefined;
  // Auto-retire the opening moment the moment the reader advances a scene, so
  // it plays once at the top of a fresh save and never lingers across the read
  // (it otherwise only clears on skip / play-to-end).
  const prevSceneIdRef = useRef(projection.scene.id);
  useEffect(() => {
    if (prevSceneIdRef.current !== projection.scene.id) {
      prevSceneIdRef.current = projection.scene.id;
      if (inlineMoment) markCinematicSeen(inlineMoment.assetId);
    }
    // Read `inlineMoment` via closure; only re-run on scene advance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projection.scene.id]);

  // Phone-aware default. The stored layout is preserved as-is; on phone
  // viewports we render Mobile unless the user has explicitly opted into
  // a different layout via /settings. Desktop/tablet readers always see
  // the stored choice. See `resolveActiveLayout` above for the rationale.
  const { isPhone } = useBreakpoint();
  const activeLayout = resolveActiveLayout(settings.layout, isPhone);
  // Reading-modes Wave 3 (R4.6): novel mode is a CONTENT axis orthogonal to the
  // cosmetic `layout` skin. When the projection carries `readingMode === "novel"`
  // (a reader-known fact from create) the Novel layout takes over — chapter
  // prose ending in one "Turn the page" affordance instead of a choice row —
  // regardless of which of the five cosmetic skins is selected. Absent /
  // "branching" ⇒ the normal skin dispatch, byte-identical to today (R5.3).
  const Layout =
    projection.readingMode === "novel"
      ? NovelLayout
      : (READER_LAYOUTS[activeLayout] ?? READER_LAYOUTS.book);

  // Panel-2 Wave 2 — daily turn budget → in-reader candle surfaces. The turn
  // number rides on the scene projection; a new scene means the reader spent a
  // turn, so `useDailyTurnState` refetches. `nowTs` ticks only while the candle
  // has guttered so the re-light countdown stays live without a permanent timer.
  const turnNumber = projection.turnNumber ?? 0;
  // Daily Killcam (R3.1/R3.3) — the Daily this save belongs to, read off the
  // scene projection. Typed narrowly here because `ReaderProjection` gains its
  // own `dailyId?` field in the integrator's useTurn.ts widening; this read is
  // safe (undefined → chip stays dark) whether or not that has landed yet.
  const dailyPulseId = (projection as { dailyId?: string }).dailyId;
  const dailyTurnState = useDailyTurnState(remoteAuth, turnNumber);
  const [nowTs, setNowTs] = useState(() => Date.now());
  const burn = candleBurnModel(dailyTurnState, nowTs);
  useEffect(() => {
    if (!burn.guttered) return;
    const id = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [burn.guttered]);

  // Turn-3 soft-signup ribbon (guest → account). One-shot dismissible; the
  // dismissal persists in localStorage exactly like the first-lock coach. The
  // ribbon self-retires the moment the guest claims (profile.kind flips off
  // "guest") so it never lingers after a successful bind. `claimWithEmail` is
  // destructured from the single useAccountProfile() call above.
  const [softSignupDismissed, setSoftSignupDismissed] = useState(() => hasDismissedSoftSignup());
  const dismissSoftSignup = useCallback(() => {
    markSoftSignupDismissed();
    setSoftSignupDismissed(true);
  }, []);
  const isTerminalView = Boolean(projection.ending) || Boolean(chapterBoundary);
  const showSoftSignupRibbon =
    !isTerminalView &&
    !softSignupDismissed &&
    profile?.kind === "guest" &&
    turnNumber >= SOFT_SIGNUP_TURN;
  // Never gate already-generated prose: the interstitial frames the NEXT turn's
  // cap, so it hides on terminal panels (the reader has already reached an end).
  const showCandleGutter = !isTerminalView && burn.guttered;
  const showCandleMeter = !isTerminalView && burn.showMeter && Boolean(dailyTurnState);

  // Auto-narrator ("the tome reads itself" — R1). Session state ONLY (default
  // OFF, resets on reader close) — never routed through useReaderSettings
  // (R1.6). It re-fires the EXISTING `submitChoice` a manual tap uses (RM10),
  // so every auto-advance is one real metered turn and re-entrancy is safe with
  // zero change to useTurn. The halt guards (R1.2) are the ReaderScreen facts
  // already derived above; on a surfaced turn error (incl. the daily-budget
  // rejection) `freeformError` halts it (R1.7).
  // Narration playback state, reported up from SceneMedia (deep in the active
  // layout). While the narrator is speaking, the auto-narrator holds the
  // page-turn so it never skips over the narration (R1.8 — the "auto skips the
  // narrator" fix). False when audio is off / no clip / native.
  const [isNarrating, setIsNarrating] = useState(false);
  const { autoOn, toggleAuto, setAutoOn } = useAutoNarrator<ChoiceProjection>({
    sceneId: projection.scene.id,
    choices: projection.choices,
    submitChoice,
    reducedMotion: reduceMotion || settings.reduceMotion,
    guards: {
      isStreaming,
      pendingChoiceId,
      hasEnding: Boolean(projection.ending),
      atChapterBoundary: Boolean(chapterBoundary),
      candleGuttered: showCandleGutter,
      hasError: Boolean(freeformError),
      isNarrating,
    },
    // OQ8 default: stay hands-free — auto-acknowledge the chapter recap after a
    // readable beat (reduced-motion shortens it). Seam: drop this line to PAUSE
    // at chapter interstitials instead (the boundary is already a halt guard).
    onChapterAdvance: acknowledgeChapter,
  });
  // R1.5 / OQ8 default: a manual choice tap "grabs the wheel" — flip auto OFF,
  // then submit unchanged. Auto itself advances via the RAW `submitChoice`
  // handed to the hook above (not this wrapper), so lean-back mode keeps running
  // until the reader taps a choice or toggles auto off. Seam: to keep auto
  // running THROUGH a manual detour, remove the `setAutoOn(false)` line.
  const handleManualChoose = useCallback(
    (choice: ChoiceProjection) => {
      setAutoOn(false);
      return submitChoice(choice);
    },
    [setAutoOn, submitChoice],
  );

  return (
    <SafeAreaView style={{ backgroundColor: tokens.colors.background, flex: 1 }}>
      <ScrollView
        contentContainerStyle={{
          alignItems: "center",
          // On phone viewports we trim the outer ScrollView gap so the
          // prose surface gets more vertical real estate before the user
          // has to scroll. Padding stays at lg (16px) so the inner
          // content still has comfortable gutters against the rounded
          // page corners.
          gap: isPhone ? tokens.spacing.md : tokens.spacing.lg,
          padding: isPhone ? tokens.spacing.md : tokens.spacing.lg,
          width: "100%",
        }}
      >
        <View style={{ alignSelf: "stretch" }}>
          <AppNav />
        </View>

        {/* Story-engagement Wave 1 — the pursuit strip + threads pill live
            here in ReaderScreen (not per-layout) so all five layouts inherit
            them for free. Both self-hide on legacy / arc-less saves. */}
        <View style={{ alignSelf: "stretch", gap: tokens.spacing.xs }}>
          <QuestLine arc={projection.arc} reducedMotion={reduceMotion || settings.reduceMotion} />
          {projection.arc ? (
            <ThreadsPill
              threadsPending={projection.arc.threadsPending}
              sceneId={projection.scene.id}
              {...(projection.recentDiffs ? { recentDiffs: projection.recentDiffs } : {})}
            />
          ) : null}
          {/* Daily Killcam (daily-killcam R3.1) — the mid-run pulse chip, beside
              ThreadsPill. Gated on `projection.dailyId` (the reader tapped the
              Daily card — spoiler-neutral, BC10); self-hides with zero layout
              shift on non-daily saves, an empty pulse, or an uncommitted turn.
              NOTE: `projection.dailyId` is threaded onto ReaderProjection by the
              integrator's useTurn.ts widening (RemoteScene.dailyId → projection);
              the local read stays type-safe until then and simply reads
              undefined, keeping the chip dark. */}
          {dailyPulseId ? (
            <DailyPulseChip
              dailyId={dailyPulseId}
              completedTurn={turnNumber}
              {...(remoteAuth ? { auth: remoteAuth } : {})}
            />
          ) : null}
          {/* DOORS-JOURNAL — the teased-doors pill (story-bible fetch-quest
              loop, reader half). Self-fetching + zero-state invisible, so
              legacy / bible-less / local saves render nothing here. */}
          <DoorsJournal
            saveId={saveId}
            sceneId={projection.scene.id}
            {...(remoteAuth ? { auth: remoteAuth } : {})}
          />
          {/* Panel-2 Wave 2 — the day's candle meter. Appears only once the
              reader has burned >= 50% of today's turns (Principle 7: no
              surprise cap) and self-hides for unlimited tiers / local saves. */}
          {showCandleMeter && dailyTurnState ? (
            <CandleBurnMeter
              turnsUsed={dailyTurnState.turnsUsed}
              turnsAllowed={dailyTurnState.turnsAllowed}
            />
          ) : null}
        </View>

        <ReaderSaveActions saveId={saveId} autoOn={autoOn} onToggleAuto={toggleAuto} />

        {/* Panel-2 Wave 2 — the candle-gutter interstitial. The daily cap as a
            narrative event, not an error string (Principle 8). Rendered ABOVE
            the still-readable scene so it never gates already-generated prose;
            its primary door returns home until the candle re-lights, its
            secondary door leads to the daily-limit paywall. */}
        {showCandleGutter ? (
          <View style={{ alignSelf: "stretch" }}>
            <CandleGutterInterstitial
              turnsUsed={dailyTurnState?.turnsUsed ?? 0}
              resetsInLabel={burn.resetsInLabel}
              onReturn={() => router.push("/")}
              onSubscribe={() => router.push("/paywall?reason=daily_limit")}
            />
          </View>
        ) : null}

        {/* Panel-2 Wave 2 — turn-3 soft-signup ribbon (guest → account). */}
        {showSoftSignupRibbon ? (
          <View style={{ alignSelf: "stretch" }}>
            <SoftSignupRibbon onClaim={claimWithEmail} onDismiss={dismissSoftSignup} />
          </View>
        ) : null}

        {/* Opening title + chapter-stinger cinematic (Omni) — the newest ready
            one, shown ONCE inline then retired by asset id (see markCinematicSeen).
            Skipping or playing to the end dismisses it. Hidden at chapter/ending. */}
        {showInlineMoment && inlineMoment ? (
          <View style={{ alignSelf: "stretch" }}>
            <CinematicMoment
              cinematic={inlineMoment}
              reducedMotion={reduceMotion || settings.reduceMotion}
              muted={settings.muted}
              audioEnabled={settings.audioEnabled}
              onSkip={() => markCinematicSeen(inlineMoment.assetId)}
              onEnded={() => markCinematicSeen(inlineMoment.assetId)}
            />
          </View>
        ) : null}

        {chapterBoundary ? (
          <ChapterEnd
            chapterIndex={chapterBoundary.index}
            entries={chapterBoundary.entries}
            nextChapterHint={projection.scene.title}
            onContinue={acknowledgeChapter}
            onSaveAndClose={() => router.push("/library")}
            storyTitle={projection.storyTitle}
            reducedMotion={reduceMotion || settings.reduceMotion}
            muted={settings.muted}
            audioEnabled={settings.audioEnabled}
            {...(chapterCinematic ? { cinematic: chapterCinematic } : {})}
            // Story-engagement Wave 1 — when the boundary turn advanced an act
            // (an `act_advanced` diff), stamp the chapter recap with the new
            // act ("Act II — <label>"). Absent on non-arc boundaries (R1.5).
            {...actStampProps(actStampFromDiffs(projection.recentDiffs, projection.arc))}
            // Act-mementos (R3.4) — memento acknowledgement + rank ticker, only
            // alongside the act stamp; the ticker reuses the cached profile
            // rankProgress (no new polling). Non-act boundaries spread `{}`.
            {...actBoundaryLineProps(
              actStampFromDiffs(projection.recentDiffs, projection.arc),
              rankProgress,
            )}
          />
        ) : (
          <Layout
            hudMode={settings.hudMode}
            isStreaming={isStreaming}
            // Auto-narrator (R1.5): a manual choice tap grabs the wheel (flips
            // auto OFF) then submits unchanged. Auto advances bypass this and
            // ride the raw submitChoice, so lean-back mode keeps running.
            onChoose={handleManualChoose}
            // Read-as-books (R2.7): the terminal EndingPanel's "Read this tale
            // as a book" action → the read-only book route. Wired through the
            // layout's endingPanelHandlers onto <EndingPanel onReadAsBook>.
            onReadAsBook={() => router.push(`/read/${saveId}/book`)}
            onOpenEndings={() => router.push("/endings")}
            onOpenLibrary={() => router.push("/library")}
            onReturnHome={() => router.push("/")}
            // Terminal-panel promises. "Begin again" = fresh save of the SAME
            // story (Req 8.3); "See the map" = this save's path map; "Fork
            // from a decision" = the run-history fork surface (R14.2). The
            // legacy onReturnHome / onOpenEndings wires above stay for the
            // non-terminal chrome (and as builder fallbacks).
            onBeginAgain={() => void beginAgain()}
            onSeeMap={() => router.push(`/map/${saveId}`)}
            onFork={() => router.push(`/read/${saveId}/history`)}
            // Share this ending (panel-review-2 ranked idea 5 / Maya MEDIUM).
            // The peak-emotion moment — the reader just earned an ending —
            // routes to the publish flow for THIS save, prefilled downstream
            // with the run's title/synopsis, turning the trophy moment into a
            // "first-class marketing artifact" (product feature 12). Previously
            // an orphaned prop: the panel rendered a share slot with no source.
            onShareEnding={() => router.push(`/publish/${saveId}`)}
            // The run's visible-choice history — drives the terminal panel's
            // ConsequenceReel ("your choices echoed").
            choiceHistory={choiceHistory}
            pendingChoiceId={pendingChoiceId}
            projection={projectionWithLiveMedia}
            reducedMotion={reduceMotion || settings.reduceMotion}
            streamedProse={streamedProse}
            endingTier={endingTier}
            {...(cinematicUri ? { cinematicUri } : {})}
            endingIsFirstFind={endingIsFirstFind}
            // Endpoint (Omni) ending cinematic — full-bleed CinematicMoment
            // rendered above the ending panel when present. Conditional
            // spread keeps exactOptionalPropertyTypes happy.
            {...(endingCinematic ? { endingCinematic } : {})}
            muted={settings.muted}
            // Per-user media gates — see settings → "Reader preferences".
            // Backend asset queueing is unaffected; these only suppress
            // rendering on the client so toggling back on lights up the
            // already-queued assets immediately.
            imagesEnabled={settings.imagesEnabled}
            audioEnabled={settings.audioEnabled}
            videoEnabled={settings.videoEnabled}
            narratorPlaybackRate={settings.narratorPlaybackRate}
            onNarratorPlaybackRateChange={setNarratorPlaybackRate}
            onNarrationActiveChange={setIsNarrating}
            dialogBlocksEnabled={settings.dialogBlocksEnabled}
            // Free-form ("Option D") affordance. Only wired for remote
            // LLM-driven saves — supportsFreeform is false for scripted /
            // tutorial saves, where omitting the callback keeps ChoiceList
            // on its previous 3-choices-only render.
            {...(supportsFreeform ? { onFreeformSubmit: submitFreeformChoice } : {})}
            freeformPending={freeformPending}
            freeformError={freeformError}
            // Forwarded to the FullSheet's cast roster so per-NPC portraits
            // can resolve via `media/npcMedia:getNpcPortraitUrl`. Only the
            // guest-session path has a server-issued accountId; local saves
            // (training-room etc.) intentionally omit it.
            {...(guest.session ? { accountId: guest.session.accountId } : {})}
            // "Illuminate this page" candle (Iris proposal). saveId + reader
            // auth thread to the per-layout <IlluminateButton>, which self-hides
            // when the page can't be lit. remoteAuth is present only on the
            // guest-session (remote) path — local/demo saves omit it and render
            // no candle.
            saveId={saveId}
            {...(remoteAuth ? { illuminateAuth: remoteAuth } : {})}
            // Most-recent visible choice — feeds the inline EffectBadge each
            // layout renders so the reader can SEE what their last pick did
            // without scrolling to the chapter recap. Conditional-spread so
            // we don't pass `undefined` under exactOptionalPropertyTypes.
            {...(recentChoiceEcho ? { recentChoiceEcho } : {})}
            // Retry callback for the deterministic-fallback FallbackTurnPanel.
            // When `projection.scene.isFallback === true` the layout swaps
            // the prose surface + ChoiceList for the panel and surfaces this
            // as a "Try again" button. Always wired (the panel itself
            // no-ops when the projection is fine).
            onRetryCurrentTurn={retryCurrentTurn}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Save-scoped chrome row: gives the reader an obvious entry into the
 * Path map (/map/[saveId]) and the Run history (/read/[saveId]/history)
 * surfaces. The global AppNav above only exposes top-level routes; these
 * two pages live under a specific save, so they belong here in the
 * reader's per-save chrome — not in AppNav, not buried in a settings
 * menu.
 *
 * Rendered as small ghost pills so they read as auxiliary chrome and
 * don't compete with the primary turn affordances (choices, narrator).
 * Both pills share an identical style block (`saveActionPillStyle`)
 * and a shared min-width so they look like SIBLINGS — the previous
 * version had two near-but-not-identical inline blocks that drifted on
 * close inspection. The visible label and accessibilityLabel match
 * 1-to-1 ("Path map" / "Run history") so screen-reader output mirrors
 * what sighted users see. Each pill carries an accessibilityLabel that
 * the test in `__tests__/readerSaveActions.test.mjs` drift-guards so
 * we don't lose the entry point in a future refactor.
 */
function ReaderSaveActions({
  saveId,
  autoOn,
  onToggleAuto,
}: {
  saveId: string;
  /** Auto-narrator session flag (R1.5) — drives the toggle pill's label + a11y state. */
  autoOn: boolean;
  /** Flip auto-narrator ON/OFF — the one-tap "grab the wheel" affordance (R1.5). */
  onToggleAuto: () => void;
}) {
  const router = useRouter();
  const { tokens } = useAppTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);
  if (!saveId) return null;

  // Single style factory so both pills land identically. Padding,
  // border width, and border style are constants — only `pressed`
  // tweaks opacity. This is the same discipline AppNav follows: no
  // per-state reflow.
  //
  // We deliberately do NOT pin a `minWidth` here: the two labels
  // ("Path map" / "Run history") are short and naturally similar in
  // width, and dropping the floor lets the row fit beside its sibling
  // pills on a 375 px iPhone viewport without overflowing. `minHeight`
  // is held at 44 px so the touch target meets Apple HIG even when
  // the row wraps onto its own line on phones.
  const pillStyle = ({ pressed }: { pressed: boolean }) => ({
    alignItems: "center" as const,
    borderColor: tokens.colors.borderMuted,
    borderRadius: tokens.radii.pill,
    borderStyle: "dashed" as const,
    borderWidth: tokens.borderWidths.hairline,
    justifyContent: "center" as const,
    minHeight: 44,
    opacity: pressed ? 0.75 : 1,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
  });
  const labelStyle = {
    color: tokens.colors.textMuted,
    fontWeight: "800" as const,
    textAlign: "center" as const,
  };

  return (
    <View
      accessibilityLabel="Save actions"
      style={{
        alignItems: "center",
        alignSelf: "stretch",
        flexDirection: "row",
        flexWrap: "wrap",
        gap: tokens.spacing.xs,
        justifyContent: "flex-end",
      }}
    >
      {/* AI-generated disclosure + per-scene report flag (Play GenAI + UGC
          policy). Left-aligned via marginRight:auto so it leads the chrome row. */}
      <View style={{ marginRight: "auto" }}>
        <AiSceneFlag saveId={saveId} />
      </View>
      {/* Auto-narrator toggle (R1.5) — one tap to hand the book the wheel or take
          it back, reachable on ANY page-state because this row renders above the
          chapter / ending / streaming branches. Session state only (R1.6); the
          label + accessibilityState reflect the live flag so screen readers hear
          the toggle's state. Drift-guarded by autoNarratorReader.test.mjs. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Auto-narrator"
        accessibilityState={{ selected: autoOn }}
        onPress={onToggleAuto}
        style={pillStyle}
      >
        <Text style={labelStyle} variant="bodySmall">
          {autoOn ? "⏸ Auto" : "▶ Auto"}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Reader settings"
        accessibilityState={{ expanded: settingsOpen }}
        onPress={() => setSettingsOpen(true)}
        style={pillStyle}
      >
        <Text style={labelStyle} variant="bodySmall">
          ⚙ Reading
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Path map"
        onPress={() => router.push(`/map/${saveId}`)}
        style={pillStyle}
      >
        <Text style={labelStyle} variant="bodySmall">
          Path map
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Run history"
        onPress={() => router.push(`/read/${saveId}/history`)}
        style={pillStyle}
      >
        <Text style={labelStyle} variant="bodySmall">
          Run history
        </Text>
      </Pressable>
      <ReaderSettingsDrawer
        onClose={() => setSettingsOpen(false)}
        visible={settingsOpen}
      />
    </View>
  );
}
