import { useCallback, useEffect, useMemo, useState } from "react";

import { getLocalStorage as getStorage } from "../lib/storage";
import { createId } from "../lib/ids";

import { listStarterStories, type StorySummary } from "@cyoa/stories";

import { createRemoteSave, hasRemoteGameApi, listRemoteLibrary } from "../lib/gameApi";
import { guestAuthArgs, type GuestSession } from "./useGuestSession";

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
    let cancelled = false;
    setSaves(session ? readSaves(session.accountId) : []);
    if (session && hasRemoteGameApi()) {
      void listRemoteLibrary({
        accountId: session.accountId,
        ...guestAuthArgs(),
      }).then((remoteSaves) => {
        if (cancelled || !remoteSaves) return;
        const nextSaves = remoteSaves.map((save) => ({
          saveId: save.saveId,
          accountId: session.accountId,
          storyId: save.storyId,
          title: save.title,
          mode: save.mode,
          status: save.status,
          turnNumber: save.turnNumber,
          createdAt: save.updatedAt,
          updatedAt: save.updatedAt,
        }));
        writeSaves(session.accountId, nextSaves);
        setSaves(nextSaves);
      });
    }
    return () => {
      cancelled = true;
    };
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
    async (
      storyId: string,
      mode: "story" | "hardcore" = "story",
      titleOverride?: string,
      voiceId?: string,
      seed?: {
        premise?: string;
        title?: string;
        tone?: string;
        /**
         * Reader-authored cast (0–4 NPCs) captured during the Seed flow.
         * Forwarded to the backend as `seedNpcs`; the backend agent uses
         * this to seed `Story.initialNpcs` for the new save so the NPC
         * roster + portrait pipeline have data on turn 0.
         */
        npcs?: Array<{
          name: string;
          role: "companion" | "ally" | "rival" | "neutral" | "antagonist";
          description: string;
        }>;
        /**
         * Story-engagement Wave 3 (R12.2): the single owned keepsake the reader
         * chose to carry into this run. Threaded verbatim to `createSave` (BC3
         * — the server drops it until its args widen). One per save.
         */
        keepsakeId?: string;
        /**
         * Story-engagement Wave 3 (R13.2): the Daily Tale this run belongs to.
         * Normally set by the Daily start path; threaded here for completeness.
         */
        dailyId?: string;
      },
      options?: {
        /**
         * Skip the reuse-an-active-save shortcut and always mint a fresh save
         * (core-read-loop Req 8.3 — the ending panel's "Begin again"). The
         * shortcut reads the localStorage library snapshot, which can still
         * mark the just-ended save "active" mid-session and would bounce the
         * reader straight back onto their own corpse.
         */
        forceNew?: boolean;
        /**
         * Reading-modes R4 — start this save in Novel mode (linear "turn the
         * page" reading). The server re-gates it through `resolveReadingMode`
         * (posture A: Pro-only, dev-force-unlocked in dev), so passing "novel"
         * on a non-entitled account simply persists branching. Absent ⇒
         * branching, byte-identical to today.
         */
        readingMode?: "branching" | "novel";
      },
    ) => {
      if (!session) {
        throw new Error("guest_session_required");
      }

      const story = starterStories.find((starter: StorySummary) => starter.id === storyId);
      // The local fallback path now also honors the seed-flow title so the
      // library row shows the reader-authored title even when the remote
      // save call is unavailable.
      const title = titleOverride ?? seed?.title ?? story?.title;
      if (!title) {
        throw new Error(`story_not_found:${storyId}`);
      }

      const now = Date.now();
      const existing = readSaves(session.accountId);
      // Reuse an existing active save only for non-seeded, non-forced
      // launches. Every reader-authored seed must create a NEW save —
      // otherwise launching a second seeded adventure (which shares the
      // OPEN_STARTER_ID "open-canvas" storyId with prior seeded saves) would
      // hijack the first one and reopen its premise instead of starting
      // fresh. `forceNew` (Begin again) likewise always mints a new run.
      if (!seed?.premise && !options?.forceNew) {
        const existingActiveSave = existing.find(
          (save) => save.storyId === storyId && save.status === "active",
        );
        if (existingActiveSave) {
          return existingActiveSave;
        }
      }

      const save: LibrarySave = {
        saveId: createId("save"),
        accountId: session.accountId,
        storyId,
        title,
        mode,
        status: "active",
        turnNumber: 0,
        createdAt: now,
        updatedAt: now,
      };

      const remote = hasRemoteGameApi()
        ? await createRemoteSave({
            accountId: session.accountId,
            ...guestAuthArgs(),
            storyId,
            mode,
            // Pass the reader's pinned narrator voice when present so the
            // backend can persist it on the save and queue TTS for the right
            // voice. Omitted when undefined so the backend can apply its
            // own default (voice.ash).
            ...(voiceId ? { voiceId } : {}),
            // Seed-flow inputs — the backend runs the publishing-surface
            // safety classifier on seedPremise and throws
            // `seed_premise_blocked` if it's rejected. We forward each
            // field only when truthy because `exactOptionalPropertyTypes`
            // rejects passing `undefined` for missing optional keys.
            ...(seed?.premise ? { seedPremise: seed.premise } : {}),
            ...(seed?.title ? { seedTitle: seed.title } : {}),
            ...(seed?.tone ? { seedTone: seed.tone } : {}),
            // Pass the authored cast only when non-empty so we don't
            // bloat the request body with a [] for every save and so
            // the backend can use field-presence as a quick "did the
            // reader bring NPCs?" check.
            ...(seed?.npcs && seed.npcs.length > 0 ? { seedNpcs: seed.npcs } : {}),
            // Story-engagement Wave 3 (BC3): carry a keepsake / flag a Daily
            // run. Forwarded only when present so `exactOptionalPropertyTypes`
            // stays happy and the server can use field-presence as a signal.
            ...(seed?.keepsakeId ? { keepsakeId: seed.keepsakeId } : {}),
            ...(seed?.dailyId ? { dailyId: seed.dailyId } : {}),
            // Reading-modes R4 — Novel mode is chosen at create (posture A).
            // Forwarded only when set; the server re-gates on entitlement.
            ...(options?.readingMode ? { readingMode: options.readingMode } : {}),
          })
        : null;
      if (remote) {
        save.saveId = remote.saveId;
        save.turnNumber = remote.scene.turnNumber;
      }

      persistSaves([save, ...existing]);
      return save;
    },
    [persistSaves, session, starterStories],
  );

  const launchTutorialSave = useCallback(
    async (voiceId?: string) => createSave(TUTORIAL_STORY_ID, "story", undefined, voiceId),
    [createSave],
  );

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


