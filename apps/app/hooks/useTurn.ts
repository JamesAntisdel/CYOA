import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";

import { api } from "../../../convex/_generated/api";

import {
  applyChoiceAndEnterNode,
  createInitialState,
  evaluateNodeChoices,
  resolveTerminal,
  type EngineDiff,
  type NpcState,
  type PlayerState,
  type Story,
} from "@cyoa/engine";
import { getStory, tryGetStory, OPEN_STARTER_ID } from "@cyoa/stories";
import { createId } from "../lib/ids";

import { getStoryCoverSource } from "../lib/designAssets";
import { storyForCreatorSeedSave } from "../lib/localCreatorSeeds";
import {
  beginRemoteFreeformChoice,
  beginRemoteStreamingChoice,
  getRemoteCurrentScene,
  hasRemoteGameApi,
  streamRemoteScene,
  type RemoteArc,
  type RemoteCheck,
  type RemoteCodexEntry,
  type RemoteRecentDiff,
  type RemoteScene,
} from "../lib/gameApi";
import {
  adaptArc,
  adaptCodex,
  adaptRecentDiffs,
  adaptRemoteChoice,
  checkResultFromDiffs,
  deriveSignedEcho,
  type CheckOutcome,
  type DerivedEcho,
} from "../lib/storyEngagement";
import { useToast } from "./useToast";
import { getGuestTokenHash, guestAuthArgs, useGuestSession } from "./useGuestSession";
import { StreamLock } from "./streamLock";
import type { StreamingScene } from "./useStreamingScene";

type SceneMediaStatus = NonNullable<StreamingScene["media"]>["status"];

export type ChoiceProjection = {
  id: string;
  label: string;
  locked?: boolean;
  hint?: string;
  /**
   * Story-engagement Wave 2 skill-check descriptor (odds phrase only — BC10).
   * Present when picking this choice triggers a check; drives the CheckChip in
   * ChoiceList. Absent on plain choices and legacy saves.
   */
  check?: RemoteCheck;
};

export type ReaderStats = {
  vitality: number;
  nerve: number;
  insight: number;
};

export type ReaderInventoryItem = {
  id: string;
  label: string;
};

export type ReaderProjection = {
  saveId: string;
  storyId?: string;
  storyTitle: string;
  /**
   * Tonal hint forwarded to the death-variant dispatcher. Tonal manuscript
   * stories (Bone Cathedral, Iron Court) project as `"bookish"`; survival /
   * tutorial stories (Training Room, Ashfall) leave this undefined so the
   * Brutal default fires. Wired from the story metadata at projection time.
   */
  storyTone?: "bookish" | "brutal";
  mode: "story" | "hardcore";
  scene: StreamingScene;
  choices: ChoiceProjection[];
  stats: ReaderStats;
  inventory: ReaderInventoryItem[];
  /**
   * NPC roster surfaced on the Character Sheet (Requirement 31). Optional —
   * older projections that haven't yet plumbed `state.npcs` through the scene
   * payload leave this undefined and the FullSheet omits the roster section.
   *
   * NOTE (cross-agent coordination): the prompt-builder agent is extending
   * `convex/saves.ts:projectCurrentScene` / `projectLlmDrivenScene` to copy
   * `state.npcs` onto the projection. This client-side field mirrors that
   * server addition; if it lands first the FullSheet just renders nothing
   * until the server populates the field.
   */
  npcs?: Record<string, NpcState>;
  /**
   * Story-engagement Wave 1 reader-visible arc summary (design §7). Present
   * only on arc-bearing saves; legacy saves leave it undefined and the
   * QuestLine / ThreadsPill render nothing (R1.6 / BC9).
   */
  arc?: RemoteArc;
  /**
   * Story-engagement Wave 1 signed diffs for the turn that produced the
   * current scene (design §7). Drives the ThreadsPill fired-toast and the
   * ChapterEnd act stamp; the echo derivation consumes them per-choice.
   */
  recentDiffs?: RemoteRecentDiff[];
  /**
   * Story-engagement Wave 2 codex — recorded "truths" (design §7 / R11.2).
   * Surfaced in the FullSheet Codex tab. Absent on legacy / arc-less saves.
   */
  codex?: RemoteCodexEntry[];
  /**
   * Current turn number (from the remote scene). Threaded to the StatsHud so
   * the FullSheet Codex can fire its "✒️ New truth recorded" pip when the
   * newest codex entry was recorded on this turn (W2-C4). Absent on local /
   * legacy projections.
   */
  turnNumber?: number;
  ending?: {
    kind: "safe" | "death" | "escape";
    title: string;
    body: string;
  };
};

/**
 * Map a starter story id to the tonal hint the death-variant dispatcher
 * expects. Bone Cathedral and Iron Court are tonal-manuscript stories — they
 * render the Bookish variant. Training Room and Ashfall stay undefined so
 * the dispatcher falls back to Brutal.
 */
export function storyToneForStoryId(storyId: string | undefined): "bookish" | undefined {
  if (storyId === "bone-cathedral" || storyId === "iron-court") return "bookish";
  return undefined;
}

/**
 * One visible decision the reader made earlier this chapter, with the
 * publicly-safe echo it produced. Hidden flags and hidden stats are never
 * surfaced here — the consequence reel only narrates visible-tier effects.
 */
export type ChoiceHistoryEntry = {
  turnNumber: number;
  fromSceneTitle: string;
  toSceneTitle: string;
  choiceLabel: string;
  echo: string;
  tone: "positive" | "neutral" | "negative";
  /**
   * Story-engagement Wave 2 (W2-C1): when the turn that produced this scene
   * resolved a skill check, its outcome + margin ride here so the inline
   * EffectBadge can raise a CheckBanner. Absent when no check resolved.
   */
  check?: { outcome: CheckOutcome; statId: string; margin: number };
};

const tutorialProjection: ReaderProjection = {
  saveId: "training-room-demo",
  storyTitle: "Training Room",
  mode: "story",
  scene: {
    id: "threshold",
    title: "The First Door",
    prose:
      "The room waits in a patient hush. Candlelight gathers on three doors while the brass dial in your palm clicks once, asking for a choice.",
    media: {
      status: "queued",
      kind: "image",
      alt: "A candlelit training room with three marked doors.",
    },
  },
  choices: [
    { id: "listen", label: "Listen at the blue door" },
    { id: "dial", label: "Set the brass dial to dawn" },
    { id: "locked", label: "Open the iron door", locked: true, hint: "Needs iron key" },
  ],
  stats: { vitality: 4, nerve: 3, insight: 2 },
  inventory: [{ id: "brass-dial", label: "Brass dial" }],
};

const TRAINING_ROOM_SAVE_IDS = new Set(["training-room-demo", "training-room"]);
const engineContext = { now: 1, rngSeed: "training-room-demo" };

/**
 * Chapter window. A chapter boundary fires after every CHAPTER_TURNS visible
 * turns, which gives the consequence reel a natural rhythm regardless of whether
 * the underlying story uses explicit `sceneLength: "chapter"` nodes. When a
 * story does mark a node as a chapter terminus, that signal takes precedence.
 */
const CHAPTER_TURNS = 4;

export function useTurn(saveId: string) {
  const guest = useGuestSession();
  // Toast channel for defensive, out-of-band notices (R4.3): when the server
  // rejects a submitted choice as `choice_not_available` (a locked choice that
  // raced a state change since render), we surface a quiet toast rather than
  // stranding the reader. ReaderScreen always mounts under <ToastProvider>.
  const toast = useToast();
  const story = useMemo(() => storyForSave(saveId), [saveId]);
  const [engineState, setEngineState] = useState<PlayerState | null>(() =>
    story ? createInitialState(story, "story", engineContext.now, engineContext.rngSeed) : null,
  );
  const [projection, setProjection] = useState<ReaderProjection>(() =>
    story && engineState
      ? projectEngineState(saveId, story, engineState, "queued")
      : initialProjection(saveId),
  );
  const [pendingChoiceId, setPendingChoiceId] = useState<string | null>(null);
  const [freeformPending, setFreeformPending] = useState(false);
  const [freeformError, setFreeformError] = useState<string | null>(null);
  const [choiceHistory, setChoiceHistory] = useState<ChoiceHistoryEntry[]>([]);
  const [acknowledgedChapter, setAcknowledgedChapter] = useState(0);

  // Free-form ("Option D") is only meaningful for remote LLM-driven saves.
  // Scripted/local-engine saves need a known edge id to apply effects, so we
  // hide the affordance entirely there rather than show it and reject on tap.
  // See `isLocalDemoSave` — same gate `submitChoice` uses to pick its path.
  const supportsFreeform =
    Boolean(guest.session) && hasRemoteGameApi() && !isLocalDemoSave(saveId);

  // Ref-based in-flight guard. The React-state guards (`pendingChoiceId`,
  // `freeformPending`) have a one-frame window after `setState` is called
  // but before the next render — within that window a second tap reads the
  // stale `false` values from the previous closure and slips through. A
  // ref reflects the new value synchronously, so a second tap inside the
  // same frame is correctly suppressed.
  const freeformInFlightRef = useRef(false);

  // Per-saveId in-flight SSE guard. Two callers can race to open a stream
  // for the same save: (a) the mount-effect when a `pending`/`streaming`
  // scene loads, and (b) `submitChoice` after `beginRemoteStreamingChoice`
  // resolves. When both fire, the browser cancels the earlier connection,
  // Vertex aborts mid-flight (`AbortError`), and the LLM router falls back
  // to the deterministic provider — which echoes the reader's premise as
  // the scene's prose. Every entry-point into `streamRemoteScene` calls
  // `streamLock.acquire(saveId)` first and bails when the lock is held.
  // Stored as a ref (not state) so the value is synchronously visible
  // across closures in the same render cycle. See `streamLock.ts` for
  // the unit-tested invariants.
  const streamLockRef = useRef<StreamLock>(new StreamLock());

  // The session reference can change across renders even when its contents
  // are identical (useGuestSession re-runs setState after the server-issued
  // account resolves). Effects below depend on the primitive `accountId`
  // so that a content-equal session swap doesn't re-trigger the mount-
  // effect and open a second SSE stream — see the streamInFlightRef
  // comment above for the failure mode this avoids.
  const accountId = guest.session?.accountId ?? null;

  // Reactive subscription to the scene record. Convex pushes updates over
  // WebSocket when `completeSceneStream` (or any other writer) patches the
  // scene's prose / streamStatus, so the reader sees content land without
  // any client-side polling.
  //
  // The HTTP-only path that the rest of `gameApi.ts` uses exists because
  // the anonymous local backend's WS handshake was historically flaky on
  // mutations. Reads (`getCurrentScene`) appear to handshake cleanly, so
  // we opt into the WS subscription here while leaving the mount-effect
  // HTTP fetch + polling in place as a defense-in-depth fallback. If WS
  // never delivers (offline, handshake fails), the polling carries.
  const guestTokenHash = guest.session ? getGuestTokenHash() : null;
  const liveScene = useQuery(
    api.game.getCurrentScene,
    accountId && !isLocalDemoSave(saveId)
      ? ({
          // Cast through unknown — the runtime contract is string ids, but
          // Convex's generated types brand them as `Id<"accounts">` /
          // `Id<"saves">`. The HTTP path (`getRemoteCurrentScene`) already
          // does the same string→string conversion under the hood; the
          // server-side argValidator (`v.id(...)`) is what actually
          // enforces shape on the wire.
          accountId: accountId as unknown as never,
          saveId: saveId as unknown as never,
          ...(guestTokenHash ? { guestTokenHash } : {}),
        } as Parameters<typeof useQuery<typeof api.game.getCurrentScene>>[1])
      : "skip",
  );

  useEffect(() => {
    if (!liveScene) return;
    // Don't override active streaming with a stale empty scene. When
    // `beginStreamingChoice` just patched the scene to "pending" with
    // prose: "", the WS subscription delivers that empty stub before
    // the SSE has emitted its first token — we'd flicker the reader's
    // already-displayed "candle is being lit…" placeholder to nothing.
    // Only adopt the live scene when it's terminal or carries non-empty
    // prose (the canonical scene-is-ready signal).
    const hasProse =
      typeof liveScene.prose === "string" && liveScene.prose.length > 0;
    const terminal =
      liveScene.streamStatus === "complete" ||
      liveScene.streamStatus === "blocked" ||
      liveScene.streamStatus === "failed";
    if (hasProse || terminal) {
      setProjection(projectRemoteScene(saveId, liveScene));
    }
  }, [liveScene, saveId]);

  useEffect(() => {
    let cancelled = false;
    const nextState = story
      ? createInitialState(story, "story", engineContext.now, engineContext.rngSeed)
      : null;
    setEngineState(nextState);
    setProjection(
      story && nextState
        ? projectEngineState(saveId, story, nextState, "queued")
        : initialProjection(saveId),
    );
    setPendingChoiceId(null);
    setFreeformPending(false);
    setFreeformError(null);
    freeformInFlightRef.current = false;
    setChoiceHistory([]);
    setAcknowledgedChapter(0);
    if (accountId && hasRemoteGameApi() && !isLocalDemoSave(saveId)) {
      void getRemoteCurrentScene({
        accountId,
        ...guestAuthArgs(),
        saveId,
      }).then(async (remoteScene) => {
        if (cancelled || !remoteScene) return;
        setProjection(projectRemoteScene(saveId, remoteScene));

        // LLM-driven stories materialize prose + choices via SSE on the
        // very first scene (createSave intentionally leaves prose empty
        // and choices unresolved). If the scene we just loaded is in
        // "pending"/"streaming" state, open the stream now so the page
        // doesn't sit on an empty placeholder waiting for the user to
        // click something that doesn't exist.
        if (remoteScene.streamStatus === "pending" || remoteScene.streamStatus === "streaming") {
          // Dedup against a sibling stream that may already be running for
          // this save — typically `submitChoice` after the user picked a
          // choice. If we proceed, we cancel the in-flight Vertex call and
          // get the deterministic-fallback premise echo instead of real
          // prose. The other caller is also re-fetching the scene on
          // completion, so skipping here doesn't strand the reader.
          if (!streamLockRef.current.acquire(saveId)) return;
          try {
            let streamedProse = "";
            setProjection(projectRemoteScene(saveId, remoteScene, "The candle is being lit..."));
            const streamed = await streamRemoteScene({
              accountId,
              ...guestAuthArgs(),
              saveId,
              onToken: (text) => {
                if (cancelled) return;
                streamedProse += text;
                setProjection(projectRemoteScene(saveId, remoteScene, streamedProse, true));
              },
            });
            if (cancelled) return;
            // Re-fetch the now-complete scene to pick up choices + final prose.
            const refreshed = await getRemoteCurrentScene({
              accountId,
              ...guestAuthArgs(),
              saveId,
            });
            if (cancelled) return;
            if (
              refreshed &&
              typeof refreshed.prose === "string" &&
              refreshed.prose.length > 0
            ) {
              setProjection(projectRemoteScene(saveId, refreshed));
              return;
            }
            // SSE returned without delivering prose to the projection — a
            // known failure mode on first cross-origin mobile load where
            // the SSE response is silently swallowed by CORS preflight
            // latency, cloudflared buffering, or the browser's first-
            // request cookie handshake. The user reported needing TWO
            // page loads to see content; this poll closes that gap by
            // re-checking the scene every few seconds until the server-
            // side LLM call lands. The check is cheap (HTTP query) and
            // bounded by a 60-second timeout so a real long-tail stall
            // doesn't pin the loop forever.
            const startedAt = Date.now();
            const POLL_INTERVAL_MS = 3500;
            const POLL_TIMEOUT_MS = 60_000;
            while (!cancelled && Date.now() - startedAt < POLL_TIMEOUT_MS) {
              await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
              if (cancelled) return;
              const polled = await getRemoteCurrentScene({
                accountId,
                ...guestAuthArgs(),
                saveId,
              });
              if (cancelled) return;
              if (!polled) continue;
              const hasProse =
                typeof polled.prose === "string" && polled.prose.length > 0;
              const terminal =
                polled.streamStatus === "blocked" ||
                polled.streamStatus === "failed" ||
                polled.streamStatus === "complete";
              if (hasProse || terminal) {
                setProjection(projectRemoteScene(saveId, polled));
                return;
              }
            }
            // Timeout — surface whatever the latest known state is so
            // the reader can at least see the choice/refresh option.
            if (!streamed && !refreshed) {
              setProjection(
                projectRemoteScene(saveId, remoteScene, "(the candle guttered out)"),
              );
              return;
            }
            setProjection(projectRemoteScene(saveId, refreshed ?? remoteScene));
          } finally {
            streamLockRef.current.release(saveId);
          }
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [accountId, saveId, story]);

  const submitChoice = useCallback(async (choice: ChoiceProjection) => {
    if (choice.locked || pendingChoiceId) return;

    const fromSceneTitle = projection.scene.title;
    setPendingChoiceId(choice.id);
    if (guest.session && hasRemoteGameApi() && !isLocalDemoSave(saveId)) {
      try {
        const remote = await beginRemoteStreamingChoice({
          accountId: guest.session.accountId,
          ...guestAuthArgs(),
          saveId,
          choiceId: choice.id,
          requestId: createId("turn"),
        });
        // For remote LLM-driven saves the local engine has no record of the
        // LLM-proposed choice ids, so we must NOT fall through to
        // applyChoiceAndEnterNode on failure (it would throw
        // `choice_not_found:<id>`). Distinguish the cause so the reader sees an
        // accurate note rather than always being told to check their allowance.
        if (remote === null) {
          // Transport failure: offline, timeout, or a non-2xx with no code.
          setFreeformError("The story couldn't be reached just now. Check your connection and try again.");
          return;
        }
        if (remote.ok === false) {
          // Genuine server rejection — map the code to reader-safe copy
          // (daily_turns_exhausted, turn_in_progress, safety, …).
          // A locked-choice race (`choice_not_available`, R4.3) also gets a
          // quiet toast so the reader understands the door isn't open yet.
          if (remote.errorCode === "choice_not_available") {
            toast.push({ message: "That path isn't open to you yet.", tone: "info" });
          }
          setFreeformError(freeformBookCopyForError(remote.errorCode));
          return;
        }
        {
          if (!remote.stream) {
            const nextProjection = projectRemoteScene(saveId, remote.scene);
            setProjection(nextProjection);
            appendChoiceHistory(setChoiceHistory, {
              choiceLabel: choice.label,
              fromSceneTitle,
              toSceneTitle: nextProjection.scene.title,
              ...remoteEchoFields(remote.scene),
            });
            return;
          }
          // Claim the per-save SSE lock so the mount-effect (or any
          // sibling caller that observes the new pending scene) doesn't
          // race us with a second `/llm/scene-stream` POST. Both streams
          // hitting the same scene would cancel each other browser-side,
          // Vertex would abort, and we'd fall back to the deterministic
          // provider — which echoes the reader's premise as the prose.
          let streamedProse = "";
          let streamed = false;
          if (!streamLockRef.current.acquire(saveId)) {
            // Another caller (mount-effect) already owns the stream for
            // this save. Wait for it: re-fetch the canonical scene so
            // the reader still lands on the persisted prose + choices.
            const refreshed = await getRemoteCurrentScene({
              accountId: guest.session.accountId,
              ...guestAuthArgs(),
              saveId,
            });
            const canonicalScene = refreshed ?? remote.scene;
            const finalProjection = projectRemoteScene(saveId, canonicalScene);
            setProjection(finalProjection);
            appendChoiceHistory(setChoiceHistory, {
              choiceLabel: choice.label,
              fromSceneTitle,
              toSceneTitle: finalProjection.scene.title,
              ...remoteEchoFields(canonicalScene),
            });
            return;
          }
          try {
            setProjection(projectRemoteScene(saveId, remote.scene, "The candle is being lit..."));
            streamed = await streamRemoteScene({
              accountId: guest.session.accountId,
              ...guestAuthArgs(),
              saveId,
              onToken: (text) => {
                streamedProse += text;
                setProjection(projectRemoteScene(saveId, remote.scene, streamedProse, true));
              },
            });
          } finally {
            streamLockRef.current.release(saveId);
          }
          // After the stream completes, refetch the scene so the freshly
          // persisted choices and terminal flags from completeSceneStream
          // replace beginStreamingChoice's empty-choice stub. Without this,
          // the reader sits on a "page with no buttons" until refresh —
          // see the initial-load path above which already does the same.
          const refreshed = await getRemoteCurrentScene({
            accountId: guest.session.accountId,
            ...guestAuthArgs(),
            saveId,
          });
          if (!streamed && !refreshed) {
            // Stream silently dropped and the scene record wasn't readable.
            // Surface the most recent stub so the reader doesn't crash.
            const finalStub = projectRemoteScene(saveId, remote.scene, streamedProse || undefined);
            setProjection(finalStub);
            appendChoiceHistory(setChoiceHistory, {
              choiceLabel: choice.label,
              fromSceneTitle,
              toSceneTitle: finalStub.scene.title,
              ...remoteEchoFields(remote.scene),
            });
            return;
          }
          const canonicalScene = refreshed ?? remote.scene;
          const finalProjection = projectRemoteScene(saveId, canonicalScene);
          setProjection(finalProjection);
          appendChoiceHistory(setChoiceHistory, {
            choiceLabel: choice.label,
            fromSceneTitle,
            toSceneTitle: finalProjection.scene.title,
            ...remoteEchoFields(canonicalScene),
          });
          return;
        }
      } finally {
        setPendingChoiceId(null);
      }
    }

    setTimeout(() => {
      if (story && engineState) {
        const result = applyChoiceAndEnterNode(engineState, story, choice.id, engineContext);
        setEngineState(result.state);
        const nextProjection = projectEngineState(saveId, story, result.state, "ready");
        setProjection(nextProjection);
        const echo = deriveEngineEcho(result.diffs, story, engineState);
        appendChoiceHistory(setChoiceHistory, {
          choiceLabel: choice.label,
          fromSceneTitle,
          toSceneTitle: nextProjection.scene.title,
          tone: echo.tone,
          echo: echo.text,
        });
      } else {
        let nextTitle = "Beyond the Door";
        setProjection((current) => {
          nextTitle = choice.id === "dial" ? "Dawn Setting" : "Beyond the Door";
          return {
            ...current,
            scene: {
              id: `${choice.id}-result`,
              title: nextTitle,
              prose:
                choice.id === "dial"
                  ? "The dial warms under your thumb. The harshest shadows soften, and a safe path opens back toward the reading table."
                  : "A low chime answers from the other side. The door has not opened yet, but the room has revealed one more honest clue.",
              media: {
                status: "ready",
                kind: "image",
                alt: "Warm candlelight spreading across a training room floor.",
              },
            },
            stats: {
              vitality: current.stats.vitality,
              nerve: Math.min(5, current.stats.nerve + 1),
              insight: Math.min(5, current.stats.insight + 1),
            },
            choices: [
              { id: "return", label: "Return to the reading table" },
              { id: "continue", label: "Continue carefully" },
            ],
          };
        });
        appendChoiceHistory(setChoiceHistory, {
          choiceLabel: choice.label,
          fromSceneTitle,
          toSceneTitle: nextTitle,
          tone: "positive",
          echo: "the room remembered",
        });
      }
      setPendingChoiceId(null);
    }, 360);
  }, [engineState, guest.session, pendingChoiceId, projection.scene.title, saveId, story, toast]);

  const submitFreeformChoice = useCallback(async (rawText: string) => {
    if (!supportsFreeform) {
      setFreeformError("This tale only follows the offered paths.");
      return;
    }
    // Ref guard catches sub-frame double-taps that slip past the state
    // guards below; state guards still catch the more common case of a
    // tap after a render has flushed.
    if (freeformInFlightRef.current || pendingChoiceId || freeformPending) return;
    const trimmed = rawText.trim();
    if (trimmed.length === 0) {
      setFreeformError("Write a short action before submitting.");
      return;
    }
    if (trimmed.length > 200) {
      setFreeformError("Keep your action under 200 characters.");
      return;
    }
    if (!guest.session) {
      setFreeformError("Sign in or start a save before writing your own action.");
      return;
    }

    freeformInFlightRef.current = true;
    setFreeformError(null);
    setFreeformPending(true);
    const fromSceneTitle = projection.scene.title;
    const requestId = createId("turn");
    const choiceId = `freeform:${requestId}`;
    setPendingChoiceId(choiceId);

    try {
      const result = await beginRemoteFreeformChoice({
        accountId: guest.session.accountId,
        ...guestAuthArgs(),
        saveId,
        choiceId,
        requestId,
        userText: trimmed,
      });

      if (result === null) {
        setFreeformError("The story couldn't reach the candle just now. Try again in a moment.");
        return;
      }
      if (result.ok === false) {
        setFreeformError(freeformBookCopyForError(result.errorCode));
        return;
      }

      // Success — mirror submitChoice's streaming + refresh path so the
      // reader sees the same prose-streaming UX they get for A/B/C choices.
      // Claim the per-save SSE lock (see submitChoice) so the mount-effect
      // doesn't double-open the stream and trigger a deterministic-fallback
      // premise echo.
      let streamedProse = "";
      let streamed = false;
      if (!streamLockRef.current.acquire(saveId)) {
        const refreshedDedup = await getRemoteCurrentScene({
          accountId: guest.session.accountId,
          ...guestAuthArgs(),
          saveId,
        });
        const canonicalScene = refreshedDedup ?? result.scene;
        const finalProjection = projectRemoteScene(saveId, canonicalScene);
        setProjection(finalProjection);
        appendChoiceHistory(setChoiceHistory, {
          choiceLabel: trimmed,
          fromSceneTitle,
          toSceneTitle: finalProjection.scene.title,
          ...remoteEchoFields(canonicalScene),
        });
        return;
      }
      try {
        setProjection(projectRemoteScene(saveId, result.scene, "The candle is being lit..."));
        streamed = await streamRemoteScene({
          accountId: guest.session.accountId,
          ...guestAuthArgs(),
          saveId,
          onToken: (text) => {
            streamedProse += text;
            setProjection(projectRemoteScene(saveId, result.scene, streamedProse, true));
          },
        });
      } finally {
        streamLockRef.current.release(saveId);
      }
      const refreshed = await getRemoteCurrentScene({
        accountId: guest.session.accountId,
        ...guestAuthArgs(),
        saveId,
      });
      if (!streamed && !refreshed) {
        const finalStub = projectRemoteScene(saveId, result.scene, streamedProse || undefined);
        setProjection(finalStub);
        appendChoiceHistory(setChoiceHistory, {
          choiceLabel: trimmed,
          fromSceneTitle,
          toSceneTitle: finalStub.scene.title,
          ...remoteEchoFields(result.scene),
        });
        return;
      }
      const canonicalScene = refreshed ?? result.scene;
      const finalProjection = projectRemoteScene(saveId, canonicalScene);
      setProjection(finalProjection);
      appendChoiceHistory(setChoiceHistory, {
        choiceLabel: trimmed,
        fromSceneTitle,
        toSceneTitle: finalProjection.scene.title,
        ...remoteEchoFields(canonicalScene),
      });
    } finally {
      freeformInFlightRef.current = false;
      setFreeformPending(false);
      setPendingChoiceId(null);
    }
  }, [
    freeformPending,
    guest.session,
    pendingChoiceId,
    projection.scene.title,
    saveId,
    supportsFreeform,
  ]);

  // Retry path for the deterministic-fallback sentinel. When the server-side
  // LLM call aborts mid-stream and the router falls back to the deterministic
  // provider, the scene record lands with `isFallback: true` and a placeholder
  // prose. The reader-facing FallbackTurnPanel (owned by the sentinel agent)
  // surfaces a "Try again" button that calls back into this method.
  //
  // The retry just re-opens `/llm/scene-stream` for the same save. The
  // server-side dedup guard (`getAuthorizedSceneStreamRequest`) allows the
  // call when the previous stream is terminal (complete/failed/blocked), which
  // is exactly the state a deterministic fallback leaves the scene in. If the
  // sentinel agent later adds an explicit `game:retryCurrentScene` mutation to
  // reset the scene back to `pending`, this method can call that first — the
  // shape stays the same.
  const retryCurrentTurn = useCallback(async () => {
    if (!guest.session || !hasRemoteGameApi() || isLocalDemoSave(saveId)) return;
    // Per-save SSE lock — bail if another caller is already streaming for
    // this save (e.g. the mount-effect just picked up the new pending state).
    if (!streamLockRef.current.acquire(saveId)) return;
    try {
      // Reset the projection's prose to the lit-candle placeholder so the
      // reader sees an immediate visual cue that something is happening,
      // exactly the same UX the mount-effect uses on a fresh pending scene.
      setProjection((current) => ({
        ...current,
        scene: {
          ...current.scene,
          prose: "The candle is being lit...",
          revealMode: "instant" as const,
        },
      }));
      let streamedProse = "";
      const streamed = await streamRemoteScene({
        accountId: guest.session.accountId,
        ...guestAuthArgs(),
        saveId,
        onToken: (text) => {
          streamedProse += text;
          setProjection((current) => ({
            ...current,
            scene: {
              ...current.scene,
              prose: streamedProse,
              revealMode: "instant" as const,
            },
          }));
        },
      });
      // Refetch the canonical scene so we pick up the freshly-persisted
      // choices, terminal flags, and a cleared `isFallback` sentinel. The
      // WS subscription will also push the same value, but the HTTP fetch
      // here gives us a guaranteed result before we release the lock.
      const refreshed = await getRemoteCurrentScene({
        accountId: guest.session.accountId,
        ...guestAuthArgs(),
        saveId,
      });
      if (refreshed) {
        setProjection(projectRemoteScene(saveId, refreshed));
        return;
      }
      if (!streamed) {
        // SSE silently dropped and the scene record wasn't readable.
        // Surface the buffered prose so the reader isn't stuck on the
        // placeholder — at minimum they'll see what we received.
        setProjection((current) => ({
          ...current,
          scene: {
            ...current.scene,
            prose: streamedProse || "(the candle guttered out)",
          },
        }));
      }
    } finally {
      streamLockRef.current.release(saveId);
    }
  }, [guest.session, saveId]);

  const completedChapters = Math.floor(choiceHistory.length / CHAPTER_TURNS);
  const chapterBoundary =
    completedChapters > acknowledgedChapter && !projection.ending
      ? {
          index: completedChapters,
          entries: choiceHistory.slice(
            (completedChapters - 1) * CHAPTER_TURNS,
            completedChapters * CHAPTER_TURNS,
          ),
        }
      : null;

  const acknowledgeChapter = useCallback(() => {
    setAcknowledgedChapter((current) => Math.max(current, completedChapters));
  }, [completedChapters]);

  // Most-recent visible choice the reader made — i.e. what brought them to
  // the current scene. Surfaced on the layouts as an inline EffectBadge so
  // the reader can connect the dot between their pick and the stat / item /
  // currency change that just happened. Null on the first turn (no prior
  // choice yet) and whenever the history is empty.
  const recentChoiceEcho = choiceHistory.length > 0
    ? choiceHistory[choiceHistory.length - 1] ?? null
    : null;

  return useMemo(
    () => ({
      projection,
      pendingChoiceId,
      submitChoice,
      submitFreeformChoice,
      supportsFreeform,
      freeformPending,
      freeformError,
      choiceHistory,
      recentChoiceEcho,
      chapterIndex: completedChapters,
      chapterBoundary,
      acknowledgeChapter,
      retryCurrentTurn,
    }),
    [
      acknowledgeChapter,
      chapterBoundary,
      choiceHistory,
      completedChapters,
      freeformError,
      freeformPending,
      pendingChoiceId,
      projection,
      recentChoiceEcho,
      retryCurrentTurn,
      submitChoice,
      submitFreeformChoice,
      supportsFreeform,
    ],
  );
}

/**
 * Map a server-side AppError code from the streaming-turn mutation
 * (`game:beginStreamingChoice`, shared by the tapped-choice and free-form
 * paths) to copy in the in-book voice. We intentionally avoid surfacing the
 * raw code or any stack trace — the reader sees a short narrator-style note
 * that explains what to try next.
 */
function freeformBookCopyForError(code: string): string {
  switch (code) {
    case "freeform_text_blocked":
      return "The story refuses that action. Try a different approach.";
    case "freeform_text_too_long":
      return "Keep your action under 200 characters.";
    case "freeform_text_empty":
      return "Write a short action before submitting.";
    case "freeform_not_supported_for_story":
      return "This tale only follows the offered paths.";
    case "choice_not_available":
      return "That path isn't open to you yet.";
    case "turn_in_progress":
      return "Another action is still resolving. Try again in a moment.";
    case "daily_turns_exhausted":
      return "You've used today's turns. They refresh tomorrow — or upgrade for unlimited.";
    default:
      return "The story couldn't take that action. Try again in a moment.";
  }
}

function storyForSave(saveId: string): Story | null {
  if (saveId === "safe-ending" || saveId === "pro-media") return null;

  const creatorStory = storyForCreatorSeedSave(saveId);
  if (creatorStory) return creatorStory;

  // Look up the actual story this save was launched from by scanning the
  // localStorage library entries (keyed by accountId). Without this the
  // local-engine fallback always runs the training-room story regardless
  // of which starter the reader picked.
  const storyId = lookupStoryIdForSave(saveId);
  if (storyId) {
    try {
      return getStory(storyId);
    } catch {
      // Fall through to training-room if the storyId isn't a known
      // starter (e.g. a future authored seed).
    }
  }
  return getStory("training-room");
}

function lookupStoryIdForSave(saveId: string): string | null {
  if (typeof globalThis === "undefined") return null;
  const storage = (globalThis as { localStorage?: Storage }).localStorage;
  if (!storage) return null;
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key || !key.startsWith("cyoa.librarySaves.v1.")) continue;
      const raw = storage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as Array<{ saveId: string; storyId: string }>;
      const match = parsed.find((s) => s.saveId === saveId);
      if (match?.storyId) return match.storyId;
    }
  } catch {
    return null;
  }
  return null;
}

function isLocalDemoSave(saveId: string): boolean {
  return (
    saveId === "safe-ending" ||
    saveId === "pro-media" ||
    saveId.startsWith("creator_seed_") ||
    TRAINING_ROOM_SAVE_IDS.has(saveId)
  );
}

function projectRemoteScene(
  saveId: string,
  scene: RemoteScene,
  generatedProse?: string,
  liveStreaming = false,
): ReaderProjection {
  // Creator-seed saves carry a server-only `authored_seed:<id>` storyId that
  // `getStory` can't resolve and would throw on — crashing this render (it runs
  // inside a useEffect/`.then`). Fall back to the open-canvas shell: the remote
  // scene already supplies prose, choices, title, and terminal, so the shell is
  // only a structural placeholder for node/ending lookups.
  const story = tryGetStory(scene.storyId) ?? getStory(OPEN_STARTER_ID);
  const node = story.nodes[scene.nodeId];
  const terminal = scene.terminal;
  const ending = terminal ? story.endings[terminal.endingId] : null;
  const coverSource = getStoryCoverSource(scene.storyId);

  const tone = storyToneForStoryId(scene.storyId);
  return {
    saveId,
    storyId: scene.storyId,
    // Seed-an-Adventure saves (open-canvas + reader-authored title) carry
    // the title on the projection; prefer it over the engine story's title
    // so the reader sees their own title, not "Open Canvas".
    storyTitle: scene.seedTitle ?? story.title,
    ...(tone ? { storyTone: tone } : {}),
    mode: "story",
    scene: {
      id: scene.nodeId,
      // Synthetic LLM-driven node ids (open-canvas:llm:N) have no node.title,
      // so the fallback used to land on story.title = "Open Canvas". Prefer
      // the reader-authored seedTitle (when present) before the engine title.
      title: node?.title ?? scene.seedTitle ?? story.title,
      prose: generatedProse || scene.prose || node?.seed || "",
      ...(liveStreaming ? { revealMode: "instant" as const } : {}),
      // Forward the deterministic-fallback sentinel verbatim. Layouts read
      // `projection.scene.isFallback` to swap the prose surface + choices
      // for the FallbackTurnPanel; mid-stream re-renders (liveStreaming)
      // never set this because the deterministic provider's "stream" is a
      // single batch — the WS subscription delivers it only after the
      // canonical write lands.
      ...(scene.isFallback === true ? { isFallback: true } : {}),
      media: {
        status: scene.streamStatus === "blocked" || scene.streamStatus === "failed" ? "blocked" : "ready",
        kind: "image",
        source: coverSource,
        alt: `${node?.title ?? scene.seedTitle ?? story.title} illustration.`,
      },
    },
    choices: scene.choices
      .filter((choice) => (choice.state ?? choice.visibility) !== "hidden")
      .map((choice) => {
        const model = adaptRemoteChoice(choice);
        return {
          id: model.id,
          label: model.label,
          locked: model.locked,
          ...(model.hint ? { hint: model.hint } : {}),
          ...(model.check ? { check: model.check } : {}),
        };
      }),
    stats: {
      // Vitality has bounds 0–10 in the engine; clamp here to the same window
      // so a value of 10 doesn't get truncated to 5. Falls back to the legacy
      // visibleStats lookup for older server projections that haven't shipped
      // the dedicated `vitality` field yet.
      vitality: clampStat(
        scene.vitality ?? findVisibleStat(scene.visibleStats, ["vitality"]) ?? 10,
        0,
        10,
      ),
      // nerve/insight are LLM-introduced visible attributes — the engine now
      // registers them as visible the first time the LLM mentions them, so
      // they appear in `visibleStats`. We deliberately do NOT alias `resolve`
      // here: aliasing made the initial local-engine projection show
      // `nerve = resolve.value = 1` and then the remote projection showed
      // `nerve = 0` (resolve is hidden), giving the "drops by 1" startup
      // glitch. Sourcing from the actual `nerve` / `insight` stat keeps both
      // projections aligned on a fresh save (both 0).
      nerve: clampStat(findVisibleStat(scene.visibleStats, ["nerve"]) ?? 0, 0, 5),
      insight: clampStat(findVisibleStat(scene.visibleStats, ["insight"]) ?? 0, 0, 5),
    },
    inventory: remoteInventoryItems(scene),
    ...(scene.npcs ? { npcs: scene.npcs } : {}),
    // Story-engagement Wave 1 — adapt the wire arc/diffs (null→optional, BC2)
    // onto the projection so ReaderScreen can render QuestLine / ThreadsPill
    // and the ChapterEnd act stamp without re-reading the raw scene.
    ...(adaptArc(scene.arc) ? { arc: adaptArc(scene.arc)! } : {}),
    ...(adaptRecentDiffs(scene.recentDiffs)
      ? { recentDiffs: adaptRecentDiffs(scene.recentDiffs)! }
      : {}),
    ...(adaptCodex(scene.codex) ? { codex: adaptCodex(scene.codex)! } : {}),
    ...(typeof scene.turnNumber === "number" ? { turnNumber: scene.turnNumber } : {}),
    ...(terminal && ending
      ? {
          ending: {
            kind: terminal.kind === "death" ? "death" : terminal.kind === "success" ? "escape" : "safe",
            title: ending.label,
            body:
              terminal.kind === "death"
                ? "This path has ended. Return to the library or try a different route."
                : "This path is complete.",
          },
        }
      : {}),
  };
}

function findVisibleStat(
  stats: RemoteScene["visibleStats"],
  ids: string[],
): number | undefined {
  const match = stats.find((stat) => ids.includes(stat.statId) || ids.includes(stat.label.toLowerCase()));
  return match?.value;
}

function clampStat(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function remoteInventoryItems(scene: RemoteScene): ReaderInventoryItem[] {
  // Prefer the new `inventory` field — it carries the LLM-proposed labels
  // ("Black ledger", etc.) verbatim. Fall back to the legacy `inventoryCount`
  // dummy list for old projections so the HUD doesn't go blank during a
  // mixed-version rollout.
  if (Array.isArray(scene.inventory) && scene.inventory.length > 0) {
    return scene.inventory.map((item) => ({ id: item.id, label: item.label }));
  }
  const count = Math.max(0, scene.inventoryCount);
  return Array.from({ length: count }, (_, index) => ({
    id: `item-${index + 1}`,
    label: count === 1 ? "1 item" : `Item ${index + 1}`,
  }));
}

function projectEngineState(
  saveId: string,
  story: Story,
  state: PlayerState,
  mediaStatus: SceneMediaStatus,
): ReaderProjection {
  const node = story.nodes[state.currentNodeId];
  if (!node) throw new Error(`node_not_found:${state.currentNodeId}`);

  const coverSource = getStoryCoverSource(story.id);
  const terminal = resolveTerminal(state, story);
  const ending = terminal ? story.endings[terminal.endingId] : null;
  const choices = terminal
    ? []
    : evaluateNodeChoices(state, node.choices)
        .filter((evaluation) => evaluation.visibility !== "hidden")
        .map((evaluation) => {
          const projected: ChoiceProjection = {
            id: evaluation.choice.id,
            label: evaluation.choice.label,
            locked: evaluation.visibility === "locked",
          };
          if (evaluation.lockedHint) projected.hint = evaluation.lockedHint;
          return projected;
        });

  const tone = storyToneForStoryId(story.id);
  return {
    saveId,
    storyId: story.id,
    storyTitle: story.title,
    ...(tone ? { storyTone: tone } : {}),
    mode: state.mode,
    scene: {
      id: node.id,
      title: node.title ?? story.title,
      prose: node.seed ?? "",
      media: {
        status: "ready",
        kind: "image",
        source: coverSource,
        alt: `${node.title ?? story.title} illustration.`,
      },
    },
    choices,
    // Source stats the same way `projectRemoteScene` does so the very first
    // paint (driven by createInitialState) and the first remote refresh
    // agree. Previously vitality was clamped to 5 (now uses the engine's
    // 0–10 window) and nerve aliased the hidden `resolve` attribute, which
    // started life at 1 in the llm-driven stubs — the next render dropped it
    // to 0 once the empty remote `visibleStats` came in. Reading
    // `state.attributes.nerve` / `.insight` instead keeps both renders at 0
    // until the LLM actually proposes a delta.
    stats: {
      vitality: clampStat(state.vitality, 0, 10),
      nerve: clampStat(state.attributes.nerve?.value ?? 0, 0, 5),
      insight: clampStat(state.attributes.insight?.value ?? 0, 0, 5),
    },
    inventory: state.inventory.map((item) => ({ id: item.id, label: item.label })),
    // Forward the engine's `state.npcs` straight to the projection — every
    // PlayerState has a (possibly empty) record post-migration, so empty
    // saves project as `npcs: {}` and the FullSheet roster section omits
    // itself via its own empty-state guard.
    npcs: state.npcs,
    ...(terminal && ending
      ? {
          ending: {
            kind: terminal.kind === "death" ? "death" : terminal.kind === "success" ? "escape" : "safe",
            title: ending.label,
            body:
              terminal.kind === "death"
                ? "The training room resets the lesson for another attempt."
                : "You have completed this training path.",
          },
        }
      : {}),
  };
}

function initialProjection(saveId: string): ReaderProjection {
  if (saveId === "safe-ending") {
    return {
      ...tutorialProjection,
      saveId,
      scene: {
        id: "safe-ending",
        title: "Safe Closing Page",
        prose:
          "The story closes this path gently and returns the reader to a calmer room with a clear way back.",
        media: {
          status: "blocked",
          kind: "image",
          alt: "A closed book resting on a quiet reading table.",
        },
      },
      choices: [],
      ending: {
        kind: "safe",
        title: "The Story Ends Here",
        body: "This thread has ended safely. Choose a different tale or return to the library.",
      },
    };
  }

  if (saveId === "pro-media") {
    return {
      ...tutorialProjection,
      saveId,
      scene: {
        id: "pro-media",
        title: "The Painted Door",
        prose:
          "A finished illustration settles into the page while the text remains ready for the next choice.",
        media: {
          status: "ready",
          kind: "image",
          uri:
            "data:image/gif;base64,R0lGODlhAQABAIABAMxUHv///yH5BAEAAAEALAAAAAABAAEAAAICTAEAOw==",
          alt: "Ready Pro illustration attached to the scene.",
        },
      },
      choices: [{ id: "continue", label: "Continue with media ready" }],
    };
  }

  return {
    ...tutorialProjection,
    saveId,
  };
}

type ChoiceHistoryDraft = Omit<ChoiceHistoryEntry, "turnNumber">;
type ChoiceHistorySetter = (updater: (current: ChoiceHistoryEntry[]) => ChoiceHistoryEntry[]) => void;

function appendChoiceHistory(
  setHistory: ChoiceHistorySetter,
  draft: ChoiceHistoryDraft,
): void {
  setHistory((current) => [
    ...current,
    { ...draft, turnNumber: current.length + 1 },
  ]);
}

/**
 * Translate engine diffs into a single short echo line for the consequence
 * reel. Only visible-tier effects are surfaced — diffs that touch hidden
 * attributes or flags marked hidden in the underlying story are intentionally
 * dropped so the reel never reveals secret state to the reader.
 */
function deriveEngineEcho(
  diffs: EngineDiff[],
  story: Story,
  priorState: PlayerState,
): { text: string; tone: ChoiceHistoryEntry["tone"] } {
  let tone: ChoiceHistoryEntry["tone"] = "neutral";
  const fragments: string[] = [];

  for (const diff of diffs) {
    if (diff.kind === "stat") {
      const attribute = priorState.attributes[diff.target];
      if (!attribute || attribute.visibility !== "visible") continue;
      const sign = diff.delta > 0 ? "+" : "";
      fragments.push(`${attribute.label} ${sign}${diff.delta}`);
      if (diff.delta < 0) tone = "negative";
      else if (tone !== "negative" && diff.delta > 0) tone = "positive";
    } else if (diff.kind === "currency") {
      const sign = diff.delta > 0 ? "+" : "";
      fragments.push(`Currency ${sign}${diff.delta}`);
      if (diff.delta < 0) tone = "negative";
      else if (tone !== "negative") tone = "positive";
    } else if (diff.kind === "inventory_add") {
      fragments.push(`Gained ${diff.target}`);
      if (tone === "neutral") tone = "positive";
    } else if (diff.kind === "inventory_remove") {
      fragments.push(`Lost ${diff.target}`);
      tone = "negative";
    } else if (diff.kind === "ending") {
      const ending = story.endings[diff.target];
      if (ending && ending.kind !== "death") {
        fragments.push(ending.label);
      }
    }
    // flag_set / flag_unset / delayed_scheduled / node deliberately omitted —
    // flags are story-internal and may be hidden; node and delayed are not
    // reader-facing echoes.
  }

  if (fragments.length === 0) return { text: "the story remembered", tone };
  return { text: fragments.slice(0, 3).join(" · "), tone };
}

/**
 * Signed echo for a completed remote turn (R5.2). Consumes the projection's
 * `recentDiffs` → signed chips ("+2 Nerve · −1 ♥ · + Bone Key"); hidden-only
 * turns collapse to "something shifted…"; old turns without diffs fall back to
 * a visible-stat snapshot. Returns both the text and the aggregate tone so the
 * EffectBadge / ConsequenceReel color the echo correctly.
 */
function deriveRemoteEcho(scene: RemoteScene): DerivedEcho {
  return deriveSignedEcho(adaptRecentDiffs(scene.recentDiffs), scene.visibleStats);
}

/**
 * Spread-ready echo fields for `appendChoiceHistory` so a remote turn's signed
 * echo, its aggregate tone, and any resolved skill-check (W2-C1) land on the
 * ChoiceHistoryEntry in one shot. The `check` field is conditionally spread so
 * `exactOptionalPropertyTypes` stays happy (BC4) and non-check turns omit it.
 */
function remoteEchoFields(scene: RemoteScene): {
  echo: string;
  tone: ChoiceHistoryEntry["tone"];
  check?: { outcome: CheckOutcome; statId: string; margin: number };
} {
  const derived = deriveRemoteEcho(scene);
  const check = checkResultFromDiffs(adaptRecentDiffs(scene.recentDiffs));
  return {
    echo: derived.text,
    tone: derived.tone,
    ...(check ? { check } : {}),
  };
}
