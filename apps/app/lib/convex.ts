import { ConvexReactClient } from "convex/react";

import { convexUrl } from "./authConfig";

export const convexClient = convexUrl ? new ConvexReactClient(convexUrl) : null;
export const convexSiteUrl = process.env.EXPO_PUBLIC_CONVEX_SITE_URL ?? null;

export function hasConvexClient() {
  return convexClient !== null;
}
