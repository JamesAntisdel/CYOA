import { useCallback, useEffect, useMemo, useState } from "react";

import { listStarterStories, type StorySummary } from "@cyoa/stories";

import type { GuestSession } from "./useGuestSession";

export type LibrarySave = {
  saveId: string;
  accountId: string;
  storyId: string;
  title: string;
  mode: "story" | "hardcore";
  status: "active" | "dead" | "ended" | "ended_safely";
  turnNumber: number;
  createdAt: number;
  updatedAt: number;
};

const LIBRARY_SAVES_KEY = "cyoa.librarySaves.v1";
const TUTORIAL_STORY_ID = "training-room";

export function useLibrary(session: GuestSession | null) {
  const [saves, setSaves] = useState<LibrarySave[]>([]);
  const starterStories: StorySummary[] = useMemo(() => listStarterStories(), []);

  useEffect(() => {
    setSaves(session ? readSaves(session.accountId) : []);
  }, [session]);

  const persistSaves = useCallback(
    (nextSaves: LibrarySave[]) => {
      if (!session) return;
      writeSaves(session.accountId, nextSaves);
      setSaves(nextSaves);
    },
    [session],
  );

  const createSave = useCallback(
    (storyId: string, mode: "story" | "hardcore" = "story") => {
      if (!session) {
        throw new Error("guest_session_required");
      }

      const story = starterStories.find((starter: StorySummary) => starter.id === storyId);
      if (!story) {
        throw new Error(`story_not_found:${storyId}`);
      }

      const now = Date.now();
      const existing = readSaves(session.accountId);
      const existingActiveSave = existing.find(
        (save) => save.storyId === storyId && save.status === "active",
      );
      if (existingActiveSave) {
        return existingActiveSave;
      }

      const save: LibrarySave = {
        saveId: createId("save"),
        accountId: session.accountId,
        storyId,
        title: story.title,
        mode,
        status: "active",
        turnNumber: 0,
        createdAt: now,
        updatedAt: now,
      };

      persistSaves([save, ...existing]);
      return save;
    },
    [persistSaves, session, starterStories],
  );

  const launchTutorialSave = useCallback(() => {
    return createSave(TUTORIAL_STORY_ID, "story");
  }, [createSave]);

  const continueSave = useMemo(() => {
    return saves
      .filter((save: LibrarySave) => save.status === "active")
      .sort((a: LibrarySave, b: LibrarySave) => b.updatedAt - a.updatedAt)[0] ?? null;
  }, [saves]);

  return {
    starterStories,
    saves,
    continueSave,
    createSave,
    launchTutorialSave,
  };
}

export function getTutorialStory(starterStories: StorySummary[]) {
  return starterStories.find((story) => story.id === TUTORIAL_STORY_ID) ?? starterStories[0] ?? null;
}

function readSaves(accountId: string): LibrarySave[] {
  const storage = getStorage();
  if (!storage) return [];

  try {
    const raw = storage.getItem(`${LIBRARY_SAVES_KEY}.${accountId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LibrarySave[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isLibrarySave);
  } catch {
    return [];
  }
}

function writeSaves(accountId: string, saves: LibrarySave[]): void {
  getStorage()?.setItem(`${LIBRARY_SAVES_KEY}.${accountId}`, JSON.stringify(saves));
}

function isLibrarySave(value: Partial<LibrarySave>): value is LibrarySave {
  return (
    typeof value.saveId === "string" &&
    typeof value.accountId === "string" &&
    typeof value.storyId === "string" &&
    typeof value.title === "string" &&
    (value.mode === "story" || value.mode === "hardcore") &&
    (value.status === "active" ||
      value.status === "dead" ||
      value.status === "ended" ||
      value.status === "ended_safely") &&
    typeof value.turnNumber === "number" &&
    typeof value.createdAt === "number" &&
    typeof value.updatedAt === "number"
  );
}

function getStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  if (typeof globalThis === "undefined") return null;
  const maybeStorage = (globalThis as { localStorage?: Storage }).localStorage;
  return maybeStorage ?? null;
}

function createId(prefix: string): string {
  const random =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}_${random}`;
}
