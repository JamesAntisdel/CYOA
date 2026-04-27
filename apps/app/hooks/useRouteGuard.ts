import { useMemo } from "react";

import { getProtectedRouteGuard, RouteGuardState } from "../lib/routeGuards";

export function useRouteGuard(state: RouteGuardState) {
  return useMemo(() => getProtectedRouteGuard(state), [state]);
}
