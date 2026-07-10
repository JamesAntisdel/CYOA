// Client-side access to the admin-gated operator dashboard query
// (Requirement 27). Kept separate from gameApi.ts on purpose: this is the only
// caller of `operatorDashboardFunctions:getOperatorDashboard`, and the server
// rejects non-admins, so it doesn't belong with the reader/game surface.
//
// Uses the shared `convexHttp` transport (`/api/query`) rather than the WS
// ConvexReactClient — anonymous local backends don't handshake the WS path
// cleanly.

import type { AdminDashboardData } from "../components/admin";
import { convexClient } from "./convex";
import { convexHttp as callConvexHttp } from "./convexHttp";

/**
 * Fetch the real operator dashboard for an admin account. Returns `null` when:
 *   - no Convex backend is configured,
 *   - the caller's account is not an admin (server throws `admin_required`),
 *   - the session proof is missing/invalid, or
 *   - the request fails / times out.
 *
 * A non-null result implies the server confirmed the caller is an admin — the
 * hook uses that to flip the AdminGate open. Callers MUST treat `null` as
 * "not authorized / unavailable" and keep the gated fallback UI.
 */
export async function getRemoteOperatorDashboard(input: {
  accountId: string;
  guestTokenHash?: string;
  windowMs?: number;
}): Promise<AdminDashboardData | null> {
  if (!convexClient) return null;
  return callConvexHttp<AdminDashboardData>(
    "query",
    "operatorDashboardFunctions:getOperatorDashboard",
    input as unknown as Record<string, unknown>,
  );
}
