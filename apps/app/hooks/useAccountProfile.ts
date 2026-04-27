import { useMemo } from "react";

import { useGuestSession } from "./useGuestSession";

export type AccountProfile = {
  accountId: string;
  kind: "guest" | "claimed";
  ageBand: "13-17" | "18+";
  canEnableMature: boolean;
  exportReady: boolean;
};

export function useAccountProfile() {
  const guest = useGuestSession();

  return useMemo(() => {
    const profile: AccountProfile | null = guest.session
      ? {
          accountId: guest.session.accountId,
          kind: "guest",
          ageBand: guest.session.ageBand,
          canEnableMature: false,
          exportReady: true,
        }
      : null;

    return {
      profile,
      clearGuestSession: guest.clearGuestSession,
    };
  }, [guest.clearGuestSession, guest.session]);
}
