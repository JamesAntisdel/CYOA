import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Platform, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ReportButton } from "../moderation";
import { Text } from "../primitives";
import { useAccountProfile } from "../../hooks/useAccountProfile";
import { useLibrary } from "../../hooks/useLibrary";
import { useReaderSettings } from "../../hooks/useReaderSettings";
import { useCandlelightFocus } from "../../hooks/useCandlelightFocus";
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
import { CandleGutterInterstitial } from "./CandleGutter";
import { SoftSignupRibbon } from "./SoftSignupRibbon";
import { PAGE_COLUMN_MAX, ReaderTopBar } from "./chrome/ReaderTopBar";
import { StoryRibbon } from "./chrome/StoryRibbon";
import { TomeSheet } from "./chrome/TomeSheet";
import { buildTomeRows } from "./chrome/tomeRows";
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

  // Reader-chrome-declutter Wave 1 (R1/R2/R3) — the consolidated chrome.
  //   - the Tome menu (bottom sheet <768 / anchored popover ≥768) holds every
  //     auxiliary action; opened from the top-bar `book` trigger.
  //   - the in-reader ReaderSettingsDrawer is now opened from the Tome's
  //     "Reading settings" row (its open state lifted here from the old
  //     ReaderSaveActions row).
  //   - the per-scene report picker (moderation/ReportButton) is driven from
  //     the Tome's "Flag this scene" row — the disclosure text stays a footer
  //     caption (U3/R2.5), only the flag ACTION moved into the sheet.
  const [tomeOpen, setTomeOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [flagOpen, setFlagOpen] = useState(false);
  // Reader-chrome-declutter 3.4 (RB-COUNTS) — synchronous sources for the
  // COLLAPSED StoryRibbon's doors + daily-pulse segments. DoorsJournal /
  // DailyPulseChip self-fetch (RC2 forbids re-deriving their predicates or
  // adding a query), so headless reporter mounts below surface their result
  // upward into this state; the ribbon then shows "· 3 doors · 62%" (§3 mock).
  const [ribbonDoorsCount, setRibbonDoorsCount] = useState<number | undefined>(undefined);
  const [ribbonPulseLine, setRibbonPulseLine] = useState<string | undefined>(undefined);

  // Read-as-book is wired unconditionally onto the ending panel below
  // (`onReadAsBook`), so its availability predicate is "always" — the Tome row
  // mirrors that same gate (buildTomeRows omits the row only when false).
  const readAsBookAvailable = true;
  // The Flag row + Leave-the-tale row render below a divider in muted type
  // (design §3 mock). buildTomeRows emits them without `quiet`; we mark them
  // here at the wiring seam so the sheet renders the divider treatment.
  const tomeRows = buildTomeRows({
    autoOn,
    hasEnding: Boolean(projection.ending),
    readAsBookAvailable,
    onToggleAuto: toggleAuto,
    onPathMap: () => router.push(`/map/${saveId}`),
    onRunHistory: () => router.push(`/read/${saveId}/history`),
    onReadAsBook: () => router.push(`/read/${saveId}/book`),
    // Modal-over-modal handoff (code-review fix): a Tome row press closes the
    // sheet's Modal in the same commit that these open the follow-on Modal
    // (drawer / report picker). On iOS, presenting while another modal is
    // mid-dismiss silently drops the incoming one — so on native we let the
    // sheet's dismiss animation finish first. Web mounts both fine.
    onReadingSettings: () =>
      Platform.OS === "web" ? setDrawerOpen(true) : setTimeout(() => setDrawerOpen(true), 380),
    onFlagScene: () =>
      Platform.OS === "web" ? setFlagOpen(true) : setTimeout(() => setFlagOpen(true), 380),
    onLeave: () => router.push("/"),
  }).map((row) =>
    row.key === "flag" || row.key === "leave" ? { ...row, quiet: true } : row,
  );

  // Persistent AI-disclosure footer (U3 / R2.5). Scenes are LLM-authored on
  // remote saves (`supportsFreeform` is exactly the "remote LLM-driven" gate);
  // scripted/tutorial saves are not AI-generated, so the caption self-hides
  // there. Rendered as a quiet page-footer caption beneath the scene block on
  // every live generated scene — the flag ACTION lives in the Tome (above).
  const showDisclosureFooter = supportsFreeform && !isTerminalView;

  // "Candlelight Focus" immersion (phase-2 quick-win). After ~4s of no input
  // while actively reading, the CHROME (top bar + story ribbon) fades to 0; any
  // input restores it instantly. The prose + choices NEVER fade. Every guard
  // below keeps the chrome lit — an open sheet/drawer, a chapter/ending panel,
  // the candle gutter, the soft-signup ribbon, or a streaming turn. Reduced-
  // motion snaps instead of animating (honored inside the hook). The hook is
  // inert on native (no global input target to restore from). Chrome-only, so
  // it never touches the Novel/daily-pulse/act-boundary/TomeSheet wiring above.
  const { chromeOpacity, faded: chromeFaded } = useCandlelightFocus({
    enabled: settings.focusMode,
    reducedMotion: reduceMotion || settings.reduceMotion,
    guards: {
      anySheetOpen: tomeOpen || drawerOpen || flagOpen,
      atChapterBoundary: Boolean(chapterBoundary),
      atEnding: Boolean(projection.ending),
      candleGutterShown: showCandleGutter,
      softSignupShown: showSoftSignupRibbon,
      isStreaming,
    },
  });

  return (
    <SafeAreaView style={{ backgroundColor: tokens.colors.background, flex: 1 }}>
      <ScrollView
        contentContainerStyle={{
          alignItems: "center",
          padding: isPhone ? tokens.spacing.md : tokens.spacing.lg,
          width: "100%",
        }}
      >
        {/* Reader-chrome-declutter R7.1/RC9 — ALL ReaderScreen-owned chrome
            renders inside ONE centered page column (PAGE_COLUMN_MAX = 760),
            never stretched against the raw viewport. On phone we trim the row
            gap so prose reaches the top faster; padding gutters stay on the
            ScrollView. Layouts self-cap smaller within this column. */}
        <View
          style={{
            gap: isPhone ? tokens.spacing.md : tokens.spacing.lg,
            maxWidth: PAGE_COLUMN_MAX,
            width: "100%",
          }}
        >
          {/* Candlelight Focus (phase-2 quick-win) — ONLY the top bar + story
              ribbon live inside this fading wrapper (chrome only; prose/choices
              below are untouched). `chromeOpacity` dims to 0 after idle and
              snaps back on any input. When fully faded we drop pointerEvents so
              an invisible control never eats a tap — the tap passes through to
              the prose and the same gesture restores the chrome. The inner gap
              re-creates the column gap the two rows had as direct children. */}
          <Animated.View
            pointerEvents={chromeFaded ? "none" : "auto"}
            style={{ gap: isPhone ? tokens.spacing.md : tokens.spacing.lg, opacity: chromeOpacity }}
          >
          {/* R1 — the slim top bar replaces the global AppNav mount: exit/brand
              candle → home, ellipsized mono title, the inline candle wick (only
              under today's showCandleMeter rule — RC2), a compact Auto indicator
              (only when auto is ON — R1.2), and the `book` + "Tome" trigger. */}
          <ReaderTopBar
            storyTitle={projection.storyTitle}
            onExit={() => router.push("/")}
            onOpenTome={() => setTomeOpen(true)}
            {...(showCandleMeter && dailyTurnState
              ? {
                  wick: {
                    turnsUsed: dailyTurnState.turnsUsed,
                    turnsAllowed: dailyTurnState.turnsAllowed,
                  },
                }
              : {})}
            {...(autoOn ? { auto: { on: true as const, onPause: toggleAuto } } : {})}
          />

          {/* R3 — the StoryRibbon replaces the four stacked strips
              (QuestLine / ThreadsPill / DailyPulseChip / DoorsJournal): it
              self-composes them in its detail sheet (their toasts still fire
              while collapsed — R3.3) and renders a single quiet line that LEADS
              with the pursuit phrase (U1), then counts. The candle rides in
              under today's showCandleMeter rule (≥50%); the ribbon itself adds
              the leading book-voice segment only at ≥80% (two-stage — U4). All
              signals absent ⇒ it renders nothing (RC2). */}
          <StoryRibbon
            sceneId={projection.scene.id}
            saveId={saveId}
            completedTurn={turnNumber}
            reducedMotion={reduceMotion || settings.reduceMotion}
            onOpenPatronage={() => router.push("/paywall?reason=daily_limit")}
            {...(projection.arc ? { arc: projection.arc } : {})}
            {...(remoteAuth ? { auth: remoteAuth } : {})}
            {...(projection.recentDiffs ? { recentDiffs: projection.recentDiffs } : {})}
            {...(dailyPulseId ? { dailyId: dailyPulseId } : {})}
            {...(ribbonDoorsCount !== undefined ? { doorsCount: ribbonDoorsCount } : {})}
            {...(ribbonPulseLine !== undefined ? { pulseLine: ribbonPulseLine } : {})}
            // RB-COUNTS (code-review fix): the ribbon's OWN detail mounts report
            // their count/pulse upward — one fetch per surface serves both the
            // detail and the collapsed segments (no headless twins, RC2).
            onDoorsCount={setRibbonDoorsCount}
            onPulseLine={setRibbonPulseLine}
            {...(showCandleMeter && dailyTurnState
              ? {
                  candle: {
                    turnsUsed: dailyTurnState.turnsUsed,
                    turnsAllowed: dailyTurnState.turnsAllowed,
                  },
                }
              : {})}
          />
          </Animated.View>

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

          {/* Persistent AI-disclosure footer (U3 / R2.5). A quiet plain-text
              caption (NO glyph — RC5) beneath the scene block on every live
              generated scene. The flag ACTION lives in the Tome; this is the
              always-visible disclosure the GenAI policy requires. */}
          {showDisclosureFooter ? (
            <Text
              accessibilityLabel="This tale is AI-generated"
              muted
              style={{ alignSelf: "center", paddingVertical: tokens.spacing.xs }}
              variant="caption"
            >
              AI-generated tale
            </Text>
          ) : null}
        </View>
      </ScrollView>

      {/* R2 — the Tome menu (bottom sheet <768 / anchored popover ≥768). Rows
          come from the pure buildTomeRows; nav rows auto-close the sheet, the
          Auto-read toggle keeps it open. */}
      <TomeSheet
        open={tomeOpen}
        onClose={() => setTomeOpen(false)}
        rows={tomeRows}
        reducedMotion={reduceMotion || settings.reduceMotion}
      />

      {/* The in-reader settings drawer, opened from the Tome's "Reading
          settings" row (state lifted here from the removed ReaderSaveActions). */}
      <ReaderSettingsDrawer onClose={() => setDrawerOpen(false)} visible={drawerOpen} />

      {/* The per-scene report picker, driven from the Tome's "Flag this scene"
          row — the same moderation ReportButton action, trigger hidden (U3:
          only the flag ACTION moved into the menu). */}
      <ReportButton
        hideTrigger
        onOpenChange={setFlagOpen}
        open={flagOpen}
        targetId={saveId}
        targetLabel="this AI-generated scene"
        targetType="scene"
      />
    </SafeAreaView>
  );
}
