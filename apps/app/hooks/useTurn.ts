import { useCallback, useEffect, useMemo, useState } from "react";

import {
  applyChoiceAndEnterNode,
  createInitialState,
  evaluateNodeChoices,
  resolveTerminal,
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
  storyTitle: string;
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
    if (guest.session && hasRemoteGameApi() && !isLocalDemoSave(saveId)) {
      void getRemoteCurrentScene({
        accountId: guest.session.accountId,
        ...guestAuthArgs(),
        saveId,
      }).then((remoteScene) => {
        if (cancelled || !remoteScene) return;
        setProjection(projectRemoteScene(saveId, remoteScene));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [guest.session, saveId, story]);

  const submitChoice = useCallback(async (choice: ChoiceProjection) => {
    if (choice.locked || pendingChoiceId) return;

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
            setProjection(projectRemoteScene(saveId, remote.scene));
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
          if (!streamed) {
            const fallback = await getRemoteCurrentScene({
              accountId: guest.session.accountId,
              ...guestAuthArgs(),
              saveId,
            });
            if (fallback) setProjection(projectRemoteScene(saveId, fallback));
          }
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
        setProjection(projectEngineState(saveId, story, result.state, "ready"));
      } else {
        setProjection((current) => ({
          ...current,
          scene: {
            id: `${choice.id}-result`,
            title: choice.id === "dial" ? "Dawn Setting" : "Beyond the Door",
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
        }));
      }
      setPendingChoiceId(null);
    }, 360);
  }, [engineState, guest.session, pendingChoiceId, saveId, story]);

  return useMemo(
    () => ({
      projection,
      pendingChoiceId,
      submitChoice,
    }),
    [pendingChoiceId, projection, submitChoice],
  );
}

function storyForSave(saveId: string): Story | null {
  if (saveId === "safe-ending" || saveId === "pro-media") return null;

  const creatorStory = storyForCreatorSeedSave(saveId);
  if (creatorStory) return creatorStory;

  return getStory("training-room");
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

  return {
    saveId,
    storyTitle: story.title,
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

  return {
    saveId,
    storyTitle: story.title,
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
