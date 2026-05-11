import { useCallback, useEffect, useMemo, useState } from "react";

import { useGuestSession } from "./useGuestSession";

export type ArchetypeTag = {
  id: string;
  label: string;
  muted: boolean;
};

export type AccountProfile = {
  accountId: string;
  kind: "guest" | "claimed";
  ageBand: "13-17" | "18+";
  canEnableMature: boolean;
  exportReady: boolean;
  archetypes: ArchetypeTag[];
};

const ARCHETYPES_KEY = "cyoa.accountProfile.archetypes.v1";

// Narrator-inferred archetype seeds. These read like tags, never raw prose.
const DEFAULT_ARCHETYPES: ArchetypeTag[] = [
  { id: "cautious-scribe", label: "Cautious scribe", muted: false },
  { id: "lantern-keeper", label: "Lantern keeper", muted: false },
  { id: "iron-witness", label: "Iron witness", muted: false },
];

export function useAccountProfile() {
  const guest = useGuestSession();
  const [archetypes, setArchetypes] = useState<ArchetypeTag[]>(DEFAULT_ARCHETYPES);

  useEffect(() => {
    const restored = readArchetypes();
    if (restored) {
      setArchetypes(restored);
    }
  }, []);

  const toggleArchetypeMute = useCallback((id: string) => {
    setArchetypes((current) => {
      const next = current.map((tag) =>
        tag.id === id ? { ...tag, muted: !tag.muted } : tag,
      );
      writeArchetypes(next);
      return next;
    });
  }, []);

  const renameArchetype = useCallback((id: string, label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    setArchetypes((current) => {
      const next = current.map((tag) =>
        tag.id === id ? { ...tag, label: trimmed } : tag,
      );
      writeArchetypes(next);
      return next;
    });
  }, []);

  const removeArchetype = useCallback((id: string) => {
    setArchetypes((current) => {
      const next = current.filter((tag) => tag.id !== id);
      writeArchetypes(next);
      return next;
    });
  }, []);

  const resetArchetypes = useCallback(() => {
    writeArchetypes(DEFAULT_ARCHETYPES);
    setArchetypes(DEFAULT_ARCHETYPES);
  }, []);

  return useMemo(() => {
    const profile: AccountProfile | null = guest.session
      ? {
          accountId: guest.session.accountId,
          kind: "guest",
          ageBand: guest.session.ageBand,
          canEnableMature: false,
          exportReady: true,
          archetypes,
        }
      : null;

    return {
      profile,
      archetypes,
      clearGuestSession: guest.clearGuestSession,
      toggleArchetypeMute,
      renameArchetype,
      removeArchetype,
      resetArchetypes,
    };
  }, [
    archetypes,
    guest.clearGuestSession,
    guest.session,
    removeArchetype,
    renameArchetype,
    resetArchetypes,
    toggleArchetypeMute,
  ]);
}

function readArchetypes(): ArchetypeTag[] | null {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(ARCHETYPES_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const tags: ArchetypeTag[] = [];
    for (const entry of parsed) {
      if (
        entry &&
        typeof entry === "object" &&
        typeof (entry as ArchetypeTag).id === "string" &&
        typeof (entry as ArchetypeTag).label === "string" &&
        typeof (entry as ArchetypeTag).muted === "boolean"
      ) {
        tags.push({
          id: (entry as ArchetypeTag).id,
          label: (entry as ArchetypeTag).label,
          muted: (entry as ArchetypeTag).muted,
        });
      }
    }
    return tags;
  } catch {
    return null;
  }
}

function writeArchetypes(tags: ArchetypeTag[]): void {
  getStorage()?.setItem(ARCHETYPES_KEY, JSON.stringify(tags));
}

function getStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  if (typeof globalThis === "undefined") return null;
  return (globalThis as { localStorage?: Storage }).localStorage ?? null;
}
