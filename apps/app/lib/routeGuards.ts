export type RouteGuardState = {
  hasEligibleSession: boolean;
  isLoading?: boolean;
};

export type RouteGuardResult = {
  canEnter: boolean;
  isLoading: boolean;
  redirectTo: "/" | null;
};

export function getProtectedRouteGuard(state: RouteGuardState): RouteGuardResult {
  if (state.isLoading) {
    return {
      canEnter: false,
      isLoading: true,
      redirectTo: null,
    };
  }

  return {
    canEnter: state.hasEligibleSession,
    isLoading: false,
    redirectTo: state.hasEligibleSession ? null : "/",
  };
}
