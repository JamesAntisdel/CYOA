import { convexClient } from "./convex";
import { convexHttp as callConvexHttp } from "./convexHttp";

/**
 * Client wrappers for the publish / read-along / fork lifecycle
 * (Requirement 21). Uses the shared `convexHttp` transport against Convex's
 * `/api/{mutation,query}` HTTP surface, which sidesteps the WS handshake the
 * anonymous local backend doesn't complete.
 *
 * Convex function paths resolve as `<module>:<export>` — these all live in
 * `convex/talesFunctions.ts`, so the module segment is `talesFunctions`.
 */

export type TalePrivacy = "public" | "unlisted" | "friends";
export type TaleForkPolicy = "any_decision" | "ending_only" | "disabled";

/**
 * The denormalized lead cinematic featured on a published tale (Req 10.1). The
 * server copies the save's READY ending-cinematic URL onto the tale at publish
 * time (subject to owner consent + the safety/mature gate), so this carries a
 * directly playable URL — no separate fetch is needed to render it.
 */
export type RemoteTaleLeadCinematic = {
  assetId: string;
  url: string;
  hasAudio: boolean;
  synthId?: boolean;
  endingId?: string;
};

export type RemoteTaleSummary = {
  taleId: string;
  ownerAccountId: string;
  storyId: string;
  title: string;
  synopsis: string;
  privacy: TalePrivacy;
  forkPolicy: TaleForkPolicy;
  isMature: boolean;
  revoked: boolean;
  turnCount: number;
  leadCinematic?: RemoteTaleLeadCinematic | null;
  createdAt: number;
  updatedAt: number;
};

export type RemoteTaleTurn = {
  sourceTurnId: string;
  turnNumber: number;
  fromNodeId: string;
  choiceId: string;
  prose: string;
  choices: Array<{ choiceId: string; label: string }>;
  engineDiffs: unknown[];
  engineEvents: unknown[];
  stateAfter: unknown;
  createdAt: number;
};

export type RemoteTaleReadAlong = {
  taleId?: string;
  title: string;
  synopsis: string;
  storyId: string;
  privacy: TalePrivacy;
  forkPolicy: TaleForkPolicy;
  turns: RemoteTaleTurn[];
  readOnly: true;
  revoked: boolean;
  // Req 10.1: the featured ending cinematic, when present + cleared by the
  // safety/mature gate. The tale screen plays this via CinematicMoment.
  leadCinematic?: RemoteTaleLeadCinematic | null;
};

export type RemoteForkResult = {
  saveId: string;
  sceneId: string;
  scene: Record<string, unknown>;
};

export function hasRemoteTalesApi() {
  return convexClient !== null;
}

export async function publishRemoteTale(input: {
  accountId: string;
  guestTokenHash?: string;
  saveId: string;
  title: string;
  synopsis: string;
  privacy: TalePrivacy;
  forkPolicy: TaleForkPolicy;
  // Owner consent to feature the save's ending cinematic (Req 10.1). Default on.
  featureCinematic?: boolean;
}): Promise<{
  taleId: string;
  isMature: boolean;
  privacy: TalePrivacy;
  forkPolicy: TaleForkPolicy;
  title: string;
  turnCount: number;
  hasLeadCinematic?: boolean;
} | null> {
  if (!convexClient) return null;
  return callConvexHttp("mutation", "talesFunctions:publishTale", input);
}

export async function listRemotePublicTales(input: {
  accountId?: string;
  guestTokenHash?: string;
}): Promise<RemoteTaleSummary[] | null> {
  if (!convexClient) return null;
  return callConvexHttp("query", "talesFunctions:listPublicTales", input);
}

export async function listRemoteMyTales(input: {
  accountId: string;
  guestTokenHash?: string;
}): Promise<RemoteTaleSummary[] | null> {
  if (!convexClient) return null;
  return callConvexHttp("query", "talesFunctions:listMyTales", input);
}

export async function readRemoteTale(input: {
  taleId: string;
  accountId?: string;
  guestTokenHash?: string;
}): Promise<RemoteTaleReadAlong | null> {
  if (!convexClient) return null;
  return callConvexHttp("mutation", "talesFunctions:readTale", input);
}

export async function forkRemoteTale(input: {
  taleId: string;
  sourceTurnId: string;
  accountId: string;
  guestTokenHash?: string;
}): Promise<RemoteForkResult | null> {
  if (!convexClient) return null;
  return callConvexHttp("mutation", "talesFunctions:forkTale", input);
}

export async function editRemoteTaleMetadata(input: {
  accountId: string;
  taleId: string;
  guestTokenHash?: string;
  title?: string;
  synopsis?: string;
  privacy?: TalePrivacy;
  forkPolicy?: TaleForkPolicy;
}): Promise<RemoteTaleSummary | null> {
  if (!convexClient) return null;
  return callConvexHttp("mutation", "talesFunctions:editTaleMetadata", input);
}

export async function unpublishRemoteTale(input: {
  accountId: string;
  taleId: string;
  guestTokenHash?: string;
}): Promise<{ taleId: string; revoked: boolean; accessRevokedAt?: number } | null> {
  if (!convexClient) return null;
  return callConvexHttp("mutation", "talesFunctions:unpublishTale", input);
}

