import { useCallback, useEffect, useMemo, useState } from "react";

import { getLocalStorage as getStorage } from "../lib/storage";

import { signOut as clearAuthSession } from "../lib/localAuth";
import {
  claimRemoteGuest,
  deleteRemoteAccount,
  exportRemoteAccount,
  getRemoteProfile,
  setRemoteMatureContent,
  setRemoteMediaPrefs,
} from "../lib/gameApi";
import { READER_SETTINGS_CHANGED_EVENT, READER_SETTINGS_KEY, type ReaderSettings } from "./useReaderSettings";
import { useAuthSession } from "./useAuthSession";
import { guestAuthArgs, useGuestSession } from "./useGuestSession";

export type ArchetypeTag = {
  id: string;
  label: string;
  muted: boolean;
};

export type AccountProfile = {
  accountId: string;
  kind: "guest" | "claimed" | "user";
  name?: string;
  email?: string;
  ageBand: "13-17" | "18+";
  canEnableMature: boolean;
  matureContentEnabled: boolean;
  entitlementTier: "free" | "unlimited" | "pro";
  entitlementStatus: "active" | "grace" | "expired" | "revoked";
  dailyAllowance: number | "unlimited";
  exportReady: boolean;
  archetypes: ArchetypeTag[];
};

const CLAIMED_PROFILE_KEY = "cyoa.claimedProfile.v1";
const DISPLAY_NAMES_KEY = "cyoa.displayNames.v1";
const ARCHETYPES_KEY = "cyoa.accountProfile.archetypes.v1";

// Narrator-inferred archetype seeds. Tags, never raw prose. Surfaced on the
// profile screen so a reader can mute/rename/remove what the narrator has
// "learned" without exposing the underlying turn history.
const DEFAULT_ARCHETYPES: ArchetypeTag[] = [
  { id: "cautious-scribe", label: "Cautious scribe", muted: false },
  { id: "lantern-keeper", label: "Lantern keeper", muted: false },
  { id: "iron-witness", label: "Iron witness", muted: false },
];

export function useAccountProfile() {
  const auth = useAuthSession();
  const guest = useGuestSession();
  const [claimed, setClaimed] = useState<ClaimedProfile | null>(null);
  const [displayNames, setDisplayNames] = useState<Record<string, string>>({});
  const [remoteProfile, setRemoteProfile] = useState<RemoteProfileState | null>(null);
  const [archetypes, setArchetypes] = useState<ArchetypeTag[]>(DEFAULT_ARCHETYPES);

  useEffect(() => {
    setClaimed(readClaimedProfile());
    setDisplayNames(readDisplayNames());
    const restored = readArchetypes();
    if (restored) setArchetypes(restored);
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

  useEffect(() => {
    let cancelled = false;
    const accountId = guest.session?.accountId;
    if (!accountId) {
      setRemoteProfile(null);
      return () => {
        cancelled = true;
      };
    }
    void getRemoteProfile({
      accountId,
      ...guestAuthArgs(),
    }).then((profile) => {
      if (cancelled) return;
      setRemoteProfile(profile);
      // Reconcile per-modality media gates with localStorage on hydrate.
      // Server is the source of truth across devices — if it has a value
      // and the local cache differs (or is missing), adopt the server
      // value and rebroadcast the settings-changed event so the reader UI
      // re-reads. Skipped silently when running in a non-browser
      // environment (SSR / native shells without window.localStorage).
      if (profile?.mediaPrefs) {
        reconcileMediaPrefsToLocal(profile.mediaPrefs);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [guest.session?.accountId]);

  const claimWithEmail = useCallback(async (email: string) => {
    if (!guest.session) throw new Error("guest_session_required");
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new Error("valid_email_required");
    }
    await claimRemoteGuest({
      accountId: guest.session.accountId,
      ...guestAuthArgs(),
      userId: normalizedEmail,
    });
    const remote = await getRemoteProfile({
      accountId: guest.session.accountId,
      ...guestAuthArgs(),
    });
    if (remote) setRemoteProfile(remote);

    const nextClaimed: ClaimedProfile = {
      accountId: guest.session.accountId,
      email: normalizedEmail,
      claimedAt: Date.now(),
    };
    writeClaimedProfile(nextClaimed);
    setClaimed(nextClaimed);
    return nextClaimed;
  }, [guest.session]);

  const setMatureContentEnabled = useCallback(async (enabled: boolean) => {
    if (!guest.session) throw new Error("guest_session_required");
    const remote = await setRemoteMatureContent({
      accountId: guest.session.accountId,
      ...guestAuthArgs(),
      enabled,
    });
    if (!remote) throw new Error("mature_content_remote_unavailable");
    const nextProfile = await getRemoteProfile({
      accountId: guest.session.accountId,
      ...guestAuthArgs(),
    });
    if (nextProfile) setRemoteProfile(nextProfile);
    return remote;
  }, [guest.session]);

  // Push per-modality media gates to the server. Mirrors
  // setMatureContentEnabled. Best-effort by contract — localStorage is the
  // authoritative client cache (the settings screen has already written
  // the change before calling us). On success the server returns the
  // refreshed profile so we swap it into local state without a follow-up
  // getProfile round-trip. Errors are surfaced to the caller; settings/index
  // swallows them silently so a transient backend hiccup doesn't break the
  // UI feedback the reader just got from updateSettings.
  const setMediaPrefs = useCallback(async (prefs: {
    imagesEnabled: boolean;
    audioEnabled: boolean;
    videoEnabled: boolean;
    // Media-strategy selector (omni-cinematics Req 1). Optional so existing
    // callers keep working. Forwarded to the server as
    // `mediaPrefs.cinematicMode`; carried via spread so it composes cleanly
    // even before the transport/mutation type is widened to name it.
    cinematicMode?: string;
  }) => {
    if (!guest.session) throw new Error("guest_session_required");
    const remote = await setRemoteMediaPrefs({
      accountId: guest.session.accountId,
      ...guestAuthArgs(),
      imagesEnabled: prefs.imagesEnabled,
      audioEnabled: prefs.audioEnabled,
      videoEnabled: prefs.videoEnabled,
      // Spread so the extra key bypasses the excess-property check on
      // setRemoteMediaPrefs' fixed param type (gameApi.ts is not edited by
      // this feature) while still reaching the Convex mutation.
      ...(prefs.cinematicMode ? { cinematicMode: prefs.cinematicMode } : {}),
    });
    if (remote) setRemoteProfile(remote);
    return remote;
  }, [guest.session]);

  const updateDisplayName = useCallback((name: string) => {
    const accountId = auth.session?.userId ?? guest.session?.accountId;
    if (!accountId) throw new Error("profile_required");
    const normalizedName = name.trim();
    if (normalizedName.length < 2) throw new Error("display_name_too_short");

    setDisplayNames((current) => {
      const next = { ...current, [accountId]: normalizedName };
      writeDisplayNames(next);
      return next;
    });
    return normalizedName;
  }, [auth.session?.userId, guest.session?.accountId]);

  const clearProfile = useCallback(() => {
    clearClaimedProfile();
    clearAuthSession();
    setClaimed(null);
    guest.clearGuestSession();
  }, [guest]);

  const exportAccountData = useCallback(async () => {
    if (!profileCandidate(auth.session, guest.session)) throw new Error("profile_required");
    const accountId = auth.session?.userId ?? guest.session?.accountId;
    if (!accountId) throw new Error("profile_required");

    const remote = guest.session?.accountId
      ? await exportRemoteAccount({
          accountId: guest.session.accountId,
          ...guestAuthArgs(),
        })
      : null;
    return remote ?? buildLocalExport({
      accountId,
      authSession: auth.session,
      guestSession: guest.session,
      claimed,
      ...(displayNames[accountId] ? { displayName: displayNames[accountId] } : {}),
      remoteProfile,
    });
  }, [auth.session, claimed, displayNames, guest.session, remoteProfile]);

  const deleteAccountData = useCallback(async () => {
    const accountId = guest.session?.accountId;
    const remote = accountId
      ? await deleteRemoteAccount({
          accountId,
          ...guestAuthArgs(),
          confirm: "DELETE",
        })
      : null;
    clearClaimedProfile();
    clearAuthSession();
    setClaimed(null);
    guest.clearGuestSession();
    await auth.signOut();
    return remote;
  }, [auth, guest]);

  const signOut = useCallback(() => {
    clearAuthSession();
    auth.signOut();
  }, [auth]);

  return useMemo(() => {
    const profile: AccountProfile | null = auth.session
      ? {
          accountId: auth.session.userId,
          kind: "user",
          name: displayNames[auth.session.userId] ?? auth.session.name,
          email: auth.session.email,
          ageBand: auth.session.ageBand,
          canEnableMature: false,
          matureContentEnabled: false,
          entitlementTier: "free",
          entitlementStatus: "active",
          dailyAllowance: 10,
          exportReady: true,
          archetypes,
        }
      : guest.session
        ? {
            accountId: guest.session.accountId,
            kind: claimed?.accountId === guest.session.accountId ? "claimed" : "guest",
            ...(displayNames[guest.session.accountId] ? { name: displayNames[guest.session.accountId] } : {}),
            ...(claimed?.accountId === guest.session.accountId ? { email: claimed.email } : {}),
            ageBand: remoteProfile?.ageBand ?? guest.session.ageBand,
            canEnableMature: canEnableMature(remoteProfile),
            matureContentEnabled: remoteProfile?.matureContentEnabled ?? false,
            entitlementTier: remoteProfile?.entitlementTier ?? "free",
            entitlementStatus: remoteProfile?.entitlementStatus ?? "active",
            dailyAllowance: remoteProfile?.dailyAllowance ?? 10,
            exportReady: true,
            archetypes,
          }
        : null;

    return {
      profile,
      archetypes,
      authStatus: auth.status,
      claimWithEmail,
      clearGuestSession: clearProfile,
      deleteAccountData,
      exportAccountData,
      removeArchetype,
      renameArchetype,
      resetArchetypes,
      setMatureContentEnabled,
      setMediaPrefs,
      signOut,
      toggleArchetypeMute,
      updateDisplayName,
      remoteMediaPrefs: remoteProfile?.mediaPrefs ?? null,
    };
  }, [
    archetypes,
    auth.session,
    auth.status,
    claimWithEmail,
    claimed,
    clearProfile,
    deleteAccountData,
    displayNames,
    exportAccountData,
    guest.session,
    remoteProfile,
    removeArchetype,
    renameArchetype,
    resetArchetypes,
    setMatureContentEnabled,
    setMediaPrefs,
    signOut,
    toggleArchetypeMute,
    updateDisplayName,
  ]);
}

// Adopt the server's mediaPrefs into localStorage when they differ from
// what's stored. Fires the settings-changed event afterwards so any
// mounted useReaderSettings consumer re-reads. Defensive throughout —
// localStorage parse failures, missing browser APIs, and write errors
// all degrade silently because this is a best-effort cross-device sync.
function reconcileMediaPrefsToLocal(serverPrefs: {
  imagesEnabled: boolean;
  audioEnabled: boolean;
  videoEnabled: boolean;
}): void {
  const storage = (() => {
    if (typeof globalThis === "undefined") return null;
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  })();
  if (!storage) return;
  try {
    const raw = storage.getItem(READER_SETTINGS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<ReaderSettings>) : {};
    const localImages = parsed.imagesEnabled !== false;
    const localAudio = parsed.audioEnabled !== false;
    const localVideo = parsed.videoEnabled !== false;
    if (
      localImages === serverPrefs.imagesEnabled &&
      localAudio === serverPrefs.audioEnabled &&
      localVideo === serverPrefs.videoEnabled
    ) {
      return;
    }
    const next = {
      ...parsed,
      imagesEnabled: serverPrefs.imagesEnabled,
      audioEnabled: serverPrefs.audioEnabled,
      videoEnabled: serverPrefs.videoEnabled,
    };
    storage.setItem(READER_SETTINGS_KEY, JSON.stringify(next));
    if (typeof globalThis.dispatchEvent === "function" && typeof globalThis.CustomEvent === "function") {
      globalThis.dispatchEvent(new CustomEvent(READER_SETTINGS_CHANGED_EVENT, { detail: next }));
    }
  } catch {
    // localStorage tampering / quota / private mode — leave as-is.
  }
}

type RemoteProfileState = Awaited<ReturnType<typeof getRemoteProfile>>;

function profileCandidate(authSession: unknown, guestSession: unknown): boolean {
  return Boolean(authSession || guestSession);
}

function buildLocalExport(input: {
  accountId: string;
  authSession: ReturnType<typeof useAuthSession>["session"];
  guestSession: ReturnType<typeof useGuestSession>["session"];
  claimed: ClaimedProfile | null;
  displayName?: string;
  remoteProfile: RemoteProfileState;
}): Record<string, unknown> {
  return {
    exportedAt: Date.now(),
    source: "local",
    account: {
      accountId: input.accountId,
      kind: input.authSession ? "user" : input.claimed ? "claimed" : "guest",
      name: input.displayName ?? input.authSession?.name,
      email: input.authSession?.email ?? input.claimed?.email,
      ageBand: input.remoteProfile?.ageBand ?? input.authSession?.ageBand ?? input.guestSession?.ageBand,
      matureContentEnabled: input.remoteProfile?.matureContentEnabled ?? false,
      entitlementTier: input.remoteProfile?.entitlementTier ?? "free",
      entitlementStatus: input.remoteProfile?.entitlementStatus ?? "active",
    },
  };
}

function canEnableMature(profile: RemoteProfileState): boolean {
  return Boolean(
    profile &&
      profile.kind === "user" &&
      profile.ageBand === "18+" &&
      profile.entitlementStatus === "active" &&
      (profile.entitlementTier === "unlimited" || profile.entitlementTier === "pro"),
  );
}

type ClaimedProfile = {
  accountId: string;
  email: string;
  claimedAt: number;
};

function readClaimedProfile(): ClaimedProfile | null {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(CLAIMED_PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ClaimedProfile>;
    if (
      typeof parsed.accountId !== "string" ||
      typeof parsed.email !== "string" ||
      typeof parsed.claimedAt !== "number"
    ) {
      return null;
    }
    return {
      accountId: parsed.accountId,
      email: parsed.email,
      claimedAt: parsed.claimedAt,
    };
  } catch {
    return null;
  }
}

function writeClaimedProfile(profile: ClaimedProfile): void {
  getStorage()?.setItem(CLAIMED_PROFILE_KEY, JSON.stringify(profile));
}

function clearClaimedProfile(): void {
  getStorage()?.removeItem(CLAIMED_PROFILE_KEY);
}

function readDisplayNames(): Record<string, string> {
  const storage = getStorage();
  if (!storage) return {};

  try {
    const raw = storage.getItem(DISPLAY_NAMES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([accountId, name]) => typeof accountId === "string" && typeof name === "string" && name.trim().length > 0,
      ),
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeDisplayNames(displayNames: Record<string, string>): void {
  getStorage()?.setItem(DISPLAY_NAMES_KEY, JSON.stringify(displayNames));
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
