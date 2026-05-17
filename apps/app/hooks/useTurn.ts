import { useCallback, useEffect, useMemo, useState } from "react";

import {
  applyChoiceAndEnterNode,
  createInitialState,
  evaluateNodeChoices,
  resolveTerminal,
  type EngineDiff,
  type PlayerState,
  type Story,
} from "@cyoa/engine";
import { getStory } from "@cyoa/stories";

import { getStoryCoverSource } from "../lib/designAssets";
import { storyForCreatorSeedSave } from "../lib/localCreatorSeeds";
import {
  beginRemoteStreamingChoice,
  getRemoteCurrentScene,
  hasRemoteGameApi,
  streamRemoteScene,
  type RemoteScene,
} from "../lib/gameApi";
import { guestAuthArgs, useGuestSession } from "./useGuestSession";
import type { StreamingScene } from "./useStreamingScene";

type SceneMediaStatus = NonNullable<StreamingScene["media"]>["status"];

export type ChoiceProjection = {
  id: string;
  label: string;
  locked?: boolean;
  hint?: string;
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
  const [choiceHistory, setChoiceHistory] = useState<ChoiceHistoryEntry[]>([]);
  const [acknowledgedChapter, setAcknowledgedChapter] = useState(0);

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
    setChoiceHistory([]);
    setAcknowledgedChapter(0);
    if (guest.session && hasRemoteGameApi() && !isLocalDemoSave(saveId)) {
      void getRemoteCurrentScene({
        accountId: guest.session.accountId,
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
          if (!guest.session) return;
          let streamedProse = "";
          setProjection(projectRemoteScene(saveId, remoteScene, "The candle is being lit..."));
          const streamed = await streamRemoteScene({
            accountId: guest.session.accountId,
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
            accountId: guest.session.accountId,
            ...guestAuthArgs(),
            saveId,
          });
          if (cancelled || !refreshed) {
            if (!streamed) {
              setProjection(projectRemoteScene(saveId, remoteScene, "(the candle guttered out)"));
            }
            return;
          }
          setProjection(projectRemoteScene(saveId, refreshed));
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [guest.session, saveId, story]);

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
          requestId: createRequestId(),
        });
        if (remote) {
          if (!remote.stream) {
            const nextProjection = projectRemoteScene(saveId, remote.scene);
            setProjection(nextProjection);
            appendChoiceHistory(setChoiceHistory, {
              choiceLabel: choice.label,
              fromSceneTitle,
              toSceneTitle: nextProjection.scene.title,
              tone: "neutral",
              echo: deriveRemoteEcho(remote.scene),
            });
            return;
          }
          let streamedProse = "";
          setProjection(projectRemoteScene(saveId, remote.scene, "The candle is being lit..."));
          const streamed = await streamRemoteScene({
            accountId: guest.session.accountId,
            ...guestAuthArgs(),
            saveId,
            onToken: (text) => {
              streamedProse += text;
              setProjection(projectRemoteScene(saveId, remote.scene, streamedProse, true));
            },
          });
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
              tone: "neutral",
              echo: deriveRemoteEcho(remote.scene),
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
            tone: "neutral",
            echo: deriveRemoteEcho(canonicalScene),
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
  }, [engineState, guest.session, pendingChoiceId, projection.scene.title, saveId, story]);

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

  return useMemo(
    () => ({
      projection,
      pendingChoiceId,
      submitChoice,
      choiceHistory,
      chapterIndex: completedChapters,
      chapterBoundary,
      acknowledgeChapter,
    }),
    [
      acknowledgeChapter,
      chapterBoundary,
      choiceHistory,
      completedChapters,
      pendingChoiceId,
      projection,
      submitChoice,
    ],
  );
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
  const story = getStory(scene.storyId);
  const node = story.nodes[scene.nodeId];
  const terminal = scene.terminal;
  const ending = terminal ? story.endings[terminal.endingId] : null;
  const coverSource = getStoryCoverSource(scene.storyId);
  const inventoryCount = Math.max(0, scene.inventoryCount);

  const tone = storyToneForStoryId(scene.storyId);
  return {
    saveId,
    storyId: scene.storyId,
    storyTitle: story.title,
    ...(tone ? { storyTone: tone } : {}),
    mode: "story",
    scene: {
      id: scene.nodeId,
      title: node?.title ?? story.title,
      prose: generatedProse || scene.prose || node?.seed || "",
      ...(liveStreaming ? { revealMode: "instant" as const } : {}),
      media: {
        status: scene.streamStatus === "blocked" || scene.streamStatus === "failed" ? "blocked" : "ready",
        kind: "image",
        source: coverSource,
        alt: `${node?.title ?? story.title} illustration.`,
      },
    },
    choices: scene.choices
      .filter((choice) => choice.visibility !== "hidden")
      .map((choice) => ({
        id: choice.choice.id,
        label: choice.choice.label,
        locked: choice.visibility === "locked",
        ...(choice.lockedHint ? { hint: choice.lockedHint } : {}),
      })),
    stats: {
      vitality: statValue(scene.visibleStats, ["vitality"], 5),
      nerve: statValue(scene.visibleStats, ["nerve", "resolve"], 0),
      insight: statValue(scene.visibleStats, ["insight"], 0),
    },
    inventory: Array.from({ length: inventoryCount }, (_, index) => ({
      id: `item-${index + 1}`,
      label: inventoryCount === 1 ? "1 item" : `Item ${index + 1}`,
    })),
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

function statValue(
  stats: RemoteScene["visibleStats"],
  ids: string[],
  fallback: number,
): number {
  const match = stats.find((stat) => ids.includes(stat.statId) || ids.includes(stat.label.toLowerCase()));
  return Math.min(5, match?.value ?? fallback);
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
    stats: {
      vitality: Math.min(5, state.vitality),
      nerve: Math.min(5, state.attributes.resolve?.value ?? 0),
      insight: Math.min(5, state.currency),
    },
    inventory: state.inventory.map((item) => ({ id: item.id, label: item.label })),
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

function createRequestId(): string {
  const random =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `turn_${random}`;
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

function deriveRemoteEcho(scene: RemoteScene): string {
  const visibleStats = scene.visibleStats?.slice(0, 2) ?? [];
  if (visibleStats.length === 0) return "the story remembered";
  return visibleStats.map((stat) => `${stat.label}: ${stat.value}`).join(" · ");
}
