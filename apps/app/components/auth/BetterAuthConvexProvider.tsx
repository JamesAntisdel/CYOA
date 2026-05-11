import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ConvexProviderWithAuth } from "convex/react";
import type { ConvexReactClient } from "convex/react";

import { authClient, subscribeBetterAuthSession } from "../../lib/authClient";

export function BetterAuthConvexProvider({
  children,
  client,
}: {
  children: ReactNode;
  client: ConvexReactClient;
}) {
  return (
    <ConvexProviderWithAuth client={client} useAuth={useBetterAuth}>
      {children}
    </ConvexProviderWithAuth>
  );
}

function useBetterAuth(): {
  isLoading: boolean;
  isAuthenticated: boolean;
  fetchAccessToken: (args: { forceRefreshToken: boolean }) => Promise<string | null>;
} {
  const [hasSession, setHasSession] = useState(false);
  const [isPending, setIsPending] = useState(true);
  const [cachedToken, setCachedToken] = useState<string | null>(null);
  const pendingTokenRef = useRef<Promise<string | null> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      setIsPending(true);
      void authClient.getSession().then((result) => {
        if (cancelled) return;
        const nextHasSession = Boolean(result.data?.session);
        setHasSession(nextHasSession);
        setIsPending(false);
        if (!nextHasSession) setCachedToken(null);
      });
    };
    refresh();
    const unsubscribe = subscribeBetterAuthSession(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      if (cachedToken && !forceRefreshToken) return cachedToken;
      if (!forceRefreshToken && pendingTokenRef.current) return pendingTokenRef.current;

      pendingTokenRef.current = authClient.convex
        .token()
        .then(({ data }) => {
          const token = typeof data?.token === "string" ? data.token : null;
          setCachedToken(token);
          return token;
        })
        .catch(() => {
          setCachedToken(null);
          return null;
        })
        .finally(() => {
          pendingTokenRef.current = null;
        });
      return pendingTokenRef.current;
    },
    [cachedToken],
  );

  return useMemo(
    () => ({
      fetchAccessToken,
      isAuthenticated: hasSession || cachedToken !== null,
      isLoading: isPending && cachedToken === null,
    }),
    [cachedToken, fetchAccessToken, hasSession, isPending],
  );
}
