import { useCallback, useMemo, useState } from "react";

import type { StreamingScene } from "./useStreamingScene";

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

export function useTurn(saveId: string) {
  const [projection, setProjection] = useState<ReaderProjection>(() => initialProjection(saveId));
  const [pendingChoiceId, setPendingChoiceId] = useState<string | null>(null);

  const submitChoice = useCallback((choice: ChoiceProjection) => {
    if (choice.locked || pendingChoiceId) return;

    setPendingChoiceId(choice.id);
    setTimeout(() => {
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
      setPendingChoiceId(null);
    }, 360);
  }, [pendingChoiceId]);

  return useMemo(
    () => ({
      projection,
      pendingChoiceId,
      submitChoice,
    }),
    [pendingChoiceId, projection, submitChoice],
  );
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
