import { makeFunctionReference } from "convex/server";
import type { Story } from "@cyoa/engine";

import { convexClient, convexSiteUrl } from "./convex";

type AgeSelection = "13-17" | "18+" | "under_13";
type Mode = "story" | "hardcore";

export type RemoteAccount = {
  accountId: string;
  kind: "guest" | "user";
  ageBand: "13-17" | "18+";
  matureContentEnabled: boolean;
};

export type RemoteLibraryItem = {
  saveId: string;
  storyId: string;
  title: string;
  mode: Mode;
  status: "active" | "dead" | "ended" | "ended_safely";
  currentNodeId: string;
  turnNumber: number;
  updatedAt: number;
};

export type RemoteCreatorSeedItem = {
  seedId: string;
  storyId: string;
  title: string;
  status: "published";
  opening: string;
  updatedAt: number;
};

export type RemoteChoice = {
  choice: { id: string; label: string };
  visibility: "visible" | "locked" | "hidden";
  lockedHint?: string;
};

export type RemoteScene = {
  saveId?: string;
  storyId: string;
  nodeId: string;
  turnNumber: number;
  prose: string;
  streamStatus: "pending" | "streaming" | "complete" | "failed" | "blocked";
  choices: RemoteChoice[];
  visibleStats: Array<{ statId: string; label: string; value: number }>;
  inventoryCount: number;
  terminal?: { endingId: string; kind: "success" | "death" | "safe" | "other" } | null;
};

const gameApi = {
  createGuestAccount: makeFunctionReference<"mutation">("game:createGuestAccount"),
  listLibrary: makeFunctionReference<"query">("game:listLibrary"),
  createSave: makeFunctionReference<"mutation">("game:createSave"),
  getCurrentScene: makeFunctionReference<"query">("game:getCurrentScene"),
  submitChoice: makeFunctionReference<"mutation">("game:submitChoice"),
  beginStreamingChoice: makeFunctionReference<"mutation">("game:beginStreamingChoice"),
  getProfile: makeFunctionReference<"query">("accountFunctions:getProfile"),
  exportAccount: makeFunctionReference<"query">("accountFunctions:exportAccount"),
  deleteAccount: makeFunctionReference<"mutation">("accountFunctions:deleteAccount"),
  previewPlan: makeFunctionReference<"query">("billingFunctions:previewPlan"),
  createCheckoutSession: makeFunctionReference<"action">("billingFunctions:createCheckoutSession"),
  createCreatorDraft: makeFunctionReference<"mutation">("creatorFunctions:createDraft"),
  publishCreatorSeed: makeFunctionReference<"mutation">("creatorFunctions:publish"),
  listPublishedCreatorSeeds: makeFunctionReference<"query">("creatorFunctions:listPublishedMine"),
  claimGuest: makeFunctionReference<"mutation">("accountFunctions:claimGuest"),
  setMatureContent: makeFunctionReference<"mutation">("accountFunctions:setMatureContent"),
};

export function hasRemoteGameApi() {
  return convexClient !== null;
}

export async function createRemoteGuestAccount(input: {
  ageSelection: AgeSelection;
  guestTokenHash: string;
}): Promise<{ account: RemoteAccount; created: boolean } | null> {
  if (!convexClient) return null;
  return remoteOrNull(convexClient.mutation(gameApi.createGuestAccount, input));
}

export async function listRemoteLibrary(input: {
  accountId: string;
  guestTokenHash?: string;
}): Promise<RemoteLibraryItem[] | null> {
  if (!convexClient) return null;
  return remoteOrNull(convexClient.query(gameApi.listLibrary, input));
}

export async function createRemoteSave(input: {
  accountId: string;
  guestTokenHash?: string;
  storyId: string;
  mode: Mode;
}): Promise<{ saveId: string; sceneId: string; scene: RemoteScene } | null> {
  if (!convexClient) return null;
  return remoteOrNull(convexClient.mutation(gameApi.createSave, input));
}

export async function getRemoteCurrentScene(input: {
  accountId: string;
  guestTokenHash?: string;
  saveId: string;
}): Promise<RemoteScene | null> {
  if (!convexClient) return null;
  return remoteOrNull(convexClient.query(gameApi.getCurrentScene, input));
}

export async function submitRemoteChoice(input: {
  accountId: string;
  guestTokenHash?: string;
  saveId: string;
  choiceId: string;
  requestId: string;
}): Promise<{ saveId: string; sceneId: string; scene: RemoteScene; prose: string } | null> {
  if (!convexClient) return null;
  return remoteOrNull(convexClient.mutation(gameApi.submitChoice, input));
}

export async function beginRemoteStreamingChoice(input: {
  accountId: string;
  guestTokenHash?: string;
  saveId: string;
  choiceId: string;
  requestId: string;
}): Promise<{ saveId: string; sceneId: string; scene: RemoteScene; stream: boolean } | null> {
  if (!convexClient) return null;
  return remoteOrNull(convexClient.mutation(gameApi.beginStreamingChoice, input));
}

export async function streamRemoteScene(input: {
  accountId: string;
  guestTokenHash?: string;
  saveId: string;
  onToken: (text: string) => void;
}): Promise<boolean> {
  if (!convexSiteUrl) return false;
  try {
    const response = await fetch(`${convexSiteUrl.replace(/\/$/u, "")}/llm/scene-stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok || !response.body) return false;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const event of events) {
        const parsed = parseSseEvent(event);
        if (parsed.event === "token" && typeof parsed.data.text === "string") {
          input.onToken(parsed.data.text);
        }
        if (parsed.event === "error") return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export async function getRemoteProfile(input: {
  accountId: string;
  guestTokenHash?: string;
}): Promise<{
  accountId?: string;
  kind: "guest" | "user";
  ageBand: "13-17" | "18+";
  matureContentEnabled: boolean;
  dailyAllowance: number | "unlimited";
  entitlementTier: "free" | "unlimited" | "pro";
  entitlementStatus: "active" | "grace" | "expired" | "revoked";
} | null> {
  if (!convexClient) return null;
  return remoteOrNull(convexClient.query(gameApi.getProfile, input));
}

export async function claimRemoteGuest(input: {
  accountId: string;
  guestTokenHash?: string;
  userId: string;
}): Promise<{ accountId: string; userId: string } | null> {
  if (!convexClient) return null;
  return remoteOrNull(convexClient.mutation(gameApi.claimGuest, input));
}

export async function setRemoteMatureContent(input: {
  accountId: string;
  guestTokenHash?: string;
  enabled: boolean;
}): Promise<{ accountId: string; matureContentEnabled: boolean } | null> {
  if (!convexClient) return null;
  return remoteOrNull(convexClient.mutation(gameApi.setMatureContent, input));
}

export async function exportRemoteAccount(input: {
  accountId: string;
  guestTokenHash?: string;
}): Promise<Record<string, unknown> | null> {
  if (!convexClient) return null;
  return remoteOrNull(convexClient.query(gameApi.exportAccount, input), 5000);
}

export async function deleteRemoteAccount(input: {
  accountId: string;
  guestTokenHash?: string;
  confirm: "DELETE";
}): Promise<{
  accountId: string;
  savesDeleted: number;
  scenesDeleted: number;
  turnHistoryDeleted: number;
  endingsDeleted: number;
  entitlementsDeleted: number;
  usageMetersDeleted: number;
  dailyCountersDeleted: number;
  analyticsDeleted: number;
  assetsDeleted: number;
  taleReadsDeleted: number;
  taleForksDeleted: number;
  authoredSeedsArchived: number;
  publishedTalesRevoked: number;
} | null> {
  if (!convexClient) return null;
  return remoteOrNull(convexClient.mutation(gameApi.deleteAccount, input), 5000);
}

export async function previewRemotePlan(input: {
  currentTier: "free" | "unlimited" | "pro";
  targetTier: "free" | "unlimited" | "pro";
  unusedCreditCents?: number;
}): Promise<{ immediateChargeCents: number; creditAppliedCents: number } | null> {
  if (!convexClient) return null;
  return remoteOrNull(convexClient.query(gameApi.previewPlan, input));
}

export async function createRemoteCheckoutSession(input: {
  accountId: string;
  targetTier: "unlimited" | "pro";
  interval: "monthly" | "annual";
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string; clientReferenceId: string } | null> {
  if (!convexClient) return null;
  return remoteOrNull(convexClient.action(gameApi.createCheckoutSession, input), 5000);
}

export async function createRemoteCreatorDraft(input: {
  accountId: string;
  guestTokenHash?: string;
  title: string;
  story: Story;
}): Promise<{ seedId: string; seed: { status: "draft" | "published" | "archived" } } | null> {
  if (!convexClient) return null;
  return remoteOrNull(convexClient.mutation(gameApi.createCreatorDraft, input));
}

export async function publishRemoteCreatorSeed(input: {
  accountId: string;
  guestTokenHash?: string;
  seedId: string;
}): Promise<{ seedId: string; seed: { status: "draft" | "published" | "archived" } } | null> {
  if (!convexClient) return null;
  return remoteOrNull(convexClient.mutation(gameApi.publishCreatorSeed, input));
}

export async function listRemotePublishedCreatorSeeds(input: {
  accountId: string;
  guestTokenHash?: string;
}): Promise<RemoteCreatorSeedItem[] | null> {
  if (!convexClient) return null;
  return remoteOrNull(convexClient.query(gameApi.listPublishedCreatorSeeds, input));
}

async function remoteOrNull<T>(operation: Promise<T>, timeoutMs = 1500): Promise<T | null> {
  try {
    return await Promise.race([
      operation,
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } catch {
    return null;
  }
}

function parseSseEvent(raw: string): { event: string; data: Record<string, unknown> } {
  const lines = raw.split("\n");
  const event = lines.find((line) => line.startsWith("event:"))?.slice("event:".length).trim() ?? "message";
  const dataLine = lines.find((line) => line.startsWith("data:"))?.slice("data:".length).trim() ?? "{}";
  try {
    const data = JSON.parse(dataLine) as Record<string, unknown>;
    return { event, data };
  } catch {
    return { event, data: {} };
  }
}
