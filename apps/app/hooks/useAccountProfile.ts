import { useCallback, useEffect, useMemo, useState } from "react";

import { signOut as clearAuthSession } from "../lib/localAuth";
import {
  claimRemoteGuest,
  deleteRemoteAccount,
  exportRemoteAccount,
  getRemoteProfile,
  setRemoteMatureContent,
} from "../lib/gameApi";
import { useAuthSession } from "./useAuthSession";
import { guestAuthArgs, useGuestSession } from "./useGuestSession";

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
};

const CLAIMED_PROFILE_KEY = "cyoa.claimedProfile.v1";
const DISPLAY_NAMES_KEY = "cyoa.displayNames.v1";

export function useAccountProfile() {
  const auth = useAuthSession();
  const guest = useGuestSession();
  const [claimed, setClaimed] = useState<ClaimedProfile | null>(null);
  const [displayNames, setDisplayNames] = useState<Record<string, string>>({});
  const [remoteProfile, setRemoteProfile] = useState<RemoteProfileState | null>(null);

  useEffect(() => {
    setClaimed(readClaimedProfile());
    setDisplayNames(readDisplayNames());
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
      if (!cancelled) setRemoteProfile(profile);
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
          }
        : null;

    return {
      profile,
      authStatus: auth.status,
      claimWithEmail,
      clearGuestSession: clearProfile,
      deleteAccountData,
      exportAccountData,
      setMatureContentEnabled,
      signOut,
      updateDisplayName,
    };
  }, [auth.session, auth.status, claimWithEmail, claimed, clearProfile, deleteAccountData, displayNames, exportAccountData, guest.session, remoteProfile, setMatureContentEnabled, signOut, updateDisplayName]);
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

function getStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  if (typeof globalThis === "undefined") return null;
  const maybeStorage = (globalThis as { localStorage?: Storage }).localStorage;
  return maybeStorage ?? null;
}
