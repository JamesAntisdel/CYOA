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
  /**
   * Top-level vitality value from save.state.vitality (0–10). The HUD now
   * reads this directly so vitality doesn't get clamped to the 5-pip attribute
   * ceiling and works even when `visibleStats` is empty (the LLM hasn't
   * introduced any visible attribute stats yet).
   *
   * Optional for backwards compatibility with older server projections that
   * don't yet include the field.
   */
  vitality?: number;
  inventoryCount: number;
  /**
   * Full inventory items pulled from save.state.inventory. Replaces the
   * fabricated dummy-label list the client used to build off `inventoryCount`.
   * Optional for the same backwards-compat reason as `vitality`.
   */
  inventory?: Array<{ id: string; label: string }>;
  terminal?: { endingId: string; kind: "success" | "death" | "safe" | "other" } | null;
};

const gameApi = {
  createGuestAccount: makeFunctionReference<"mutation">("game:createGuestAccount"),
  listLibrary: makeFunctionReference<"query">("game:listLibrary"),
  createSave: makeFunctionReference<"mutation">("game:createSave"),
  getCurrentScene: makeFunctionReference<"query">("game:getCurrentScene"),
  getSceneMedia: makeFunctionReference<"query">("media/sceneMedia:getSceneMedia"),
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
  return callConvexHttp<any>("mutation", "game:createGuestAccount", input as unknown as Record<string, unknown>) as any;
}

export async function listRemoteLibrary(input: {
  accountId: string;
  guestTokenHash?: string;
}): Promise<RemoteLibraryItem[] | null> {
  if (!convexClient) return null;
  return callConvexHttp<any>("query", "game:listLibrary", input as unknown as Record<string, unknown>) as any;
}

export async function createRemoteSave(input: {
  accountId: string;
  guestTokenHash?: string;
  storyId: string;
  mode: Mode;
  /**
   * Narrator voice id chosen by the reader on the cover screen. Sent at save
   * creation only — the backend persists it on the save record so subsequent
   * `completeSceneStream` calls can read it server-side without resending per
   * turn. Format: `"voice.ash" | "voice.lark" | ...` (see useNarratorVoice).
   */
  voiceId?: string;
}): Promise<{ saveId: string; sceneId: string; scene: RemoteScene } | null> {
  if (!convexClient) return null;
  return callConvexHttp<any>("mutation", "game:createSave", input as unknown as Record<string, unknown>) as any;
}

export async function getRemoteCurrentScene(input: {
  accountId: string;
  guestTokenHash?: string;
  saveId: string;
}): Promise<RemoteScene | null> {
  if (!convexClient) return null;
  return callConvexHttp<any>("query", "game:getCurrentScene", input as unknown as Record<string, unknown>) as any;
}

export type RemoteSceneMedia = {
  status: "idle" | "queued" | "generating" | "ready" | "blocked" | "failed";
  kind: "image" | "video" | "audio";
  uri?: string;
  alt: string;
  durationMs?: number;
  /**
   * Library ambient loop attached to this scene (priority-4 audio layer).
   * Surfaced by the Convex projection when the save's chapter/room has a
   * ride-along ambient track.
   */
  ambient?: {
    id: string;
    uri: string;
    label: string;
    tags: string[];
    volume: number;
  };
  /**
   * Narrator TTS clip for this scene's prose (priority-1 audio layer).
   * Populated server-side once Google Cloud TTS finishes for the save's
   * pinned voiceId; absent until the asset is ready or when TTS is disabled.
   */
  narrator?: {
    id: string;
    uri: string;
    voiceId: string;
  };
  /**
   * True when a Veo job is queued/generating in parallel with the image
   * plate. The image is already showing; the UI uses this to display a
   * "video on the way" pip during Veo's 30-90s tail.
   */
  videoPending?: boolean;
  /**
   * Ready image URI for the scene. Surfaced independently of the legacy
   * `uri` so the split UI can anchor the top plate even when video is
   * the ranked primary asset.
   */
  imageUri?: string;
  /** Ready video URI for the scene. */
  videoUri?: string;
};

export async function getRemoteSceneMedia(input: {
  accountId: string;
  saveId: string;
  guestTokenHash?: string;
  sceneId?: string;
}): Promise<RemoteSceneMedia | null> {
  if (!convexClient) return null;
  return callConvexHttp<any>("query", "media/sceneMedia:getSceneMedia", input as unknown as Record<string, unknown>) as any;
}

export async function submitRemoteChoice(input: {
  accountId: string;
  guestTokenHash?: string;
  saveId: string;
  choiceId: string;
  requestId: string;
}): Promise<{ saveId: string; sceneId: string; scene: RemoteScene; prose: string } | null> {
  if (!convexClient) return null;
  return callConvexHttp<any>("mutation", "game:submitChoice", input as unknown as Record<string, unknown>) as any;
}

export async function beginRemoteStreamingChoice(input: {
  accountId: string;
  guestTokenHash?: string;
  saveId: string;
  choiceId: string;
  requestId: string;
}): Promise<{ saveId: string; sceneId: string; scene: RemoteScene; stream: boolean } | null> {
  if (!convexClient) return null;
  return callConvexHttp<any>("mutation", "game:beginStreamingChoice", input as unknown as Record<string, unknown>) as any;
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
      // Send Cloudflare Access session cookie on cross-origin requests
      // when the tunnel is gated by Access. No-op when running locally.
      credentials: "include",
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
  return callConvexHttp<any>("query", "accountFunctions:getProfile", input as unknown as Record<string, unknown>) as any;
}

export async function claimRemoteGuest(input: {
  accountId: string;
  guestTokenHash?: string;
  userId: string;
}): Promise<{ accountId: string; userId: string } | null> {
  if (!convexClient) return null;
  return callConvexHttp<any>("mutation", "accountFunctions:claimGuest", input as unknown as Record<string, unknown>) as any;
}

export async function setRemoteMatureContent(input: {
  accountId: string;
  guestTokenHash?: string;
  enabled: boolean;
}): Promise<{ accountId: string; matureContentEnabled: boolean } | null> {
  if (!convexClient) return null;
  return callConvexHttp<any>("mutation", "accountFunctions:setMatureContent", input as unknown as Record<string, unknown>) as any;
}

export async function exportRemoteAccount(input: {
  accountId: string;
  guestTokenHash?: string;
}): Promise<Record<string, unknown> | null> {
  if (!convexClient) return null;
  return remoteOrNull(callConvexHttp<any>("query", "accountFunctions:exportAccount", input as unknown as Record<string, unknown>), 5000);
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
  return remoteOrNull(callConvexHttp<any>("mutation", "accountFunctions:deleteAccount", input as unknown as Record<string, unknown>), 5000);
}

export async function previewRemotePlan(input: {
  currentTier: "free" | "unlimited" | "pro";
  targetTier: "free" | "unlimited" | "pro";
  unusedCreditCents?: number;
}): Promise<{ immediateChargeCents: number; creditAppliedCents: number } | null> {
  if (!convexClient) return null;
  return callConvexHttp<any>("query", "billingFunctions:previewPlan", input as unknown as Record<string, unknown>) as any;
}

export async function createRemoteCheckoutSession(input: {
  accountId: string;
  targetTier: "unlimited" | "pro";
  interval: "monthly" | "annual";
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string; clientReferenceId: string } | null> {
  if (!convexClient) return null;
  return remoteOrNull(callConvexHttp<any>("action", "billingFunctions:createCheckoutSession", input as unknown as Record<string, unknown>), 5000);
}

export async function createRemoteCreatorDraft(input: {
  accountId: string;
  guestTokenHash?: string;
  title: string;
  story: Story;
}): Promise<{ seedId: string; seed: { status: "draft" | "published" | "archived" } } | null> {
  if (!convexClient) return null;
  return callConvexHttp<any>("mutation", "creatorFunctions:createDraft", input as unknown as Record<string, unknown>) as any;
}

export async function publishRemoteCreatorSeed(input: {
  accountId: string;
  guestTokenHash?: string;
  seedId: string;
}): Promise<{ seedId: string; seed: { status: "draft" | "published" | "archived" } } | null> {
  if (!convexClient) return null;
  return callConvexHttp<any>("mutation", "creatorFunctions:publish", input as unknown as Record<string, unknown>) as any;
}

export async function listRemotePublishedCreatorSeeds(input: {
  accountId: string;
  guestTokenHash?: string;
}): Promise<RemoteCreatorSeedItem[] | null> {
  if (!convexClient) return null;
  return callConvexHttp<any>("query", "creatorFunctions:listPublishedMine", input as unknown as Record<string, unknown>) as any;
}

async function remoteOrNull<T>(operation: Promise<T>, timeoutMs = 8000): Promise<T | null> {
  try {
    const result = await Promise.race([
      operation,
      new Promise<null>((resolve) => {
        setTimeout(() => {
          console.warn(`[gameApi] remote call timed out after ${timeoutMs}ms`);
          resolve(null);
        }, timeoutMs);
      }),
    ]);
    return result;
  } catch (err) {
    // Surface the rejection so devs can see WHY Convex bailed instead of
    // silently rendering the local engine fallback. Prod can swap this
    // back to a silent return when telemetry is wired.
    console.error("[gameApi] remote call rejected:", err);
    return null;
  }
}

// Convex anonymous local backends don't handshake the WS-based
// ConvexReactClient cleanly (the client expects a cloud-style deployment
// selector that the anonymous backend doesn't provide), so mutations
// hang until timeout. The HTTP API at `/api/mutation` / `/api/query` /
// `/api/action` works for the same call surface. Use this helper for
// every remote call so the WS path is bypassed entirely.
async function callConvexHttp<T = unknown>(
  kind: "mutation" | "query" | "action",
  path: string,
  args: Record<string, unknown>,
  timeoutMs = 5000,
): Promise<T | null> {
  const baseUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
  if (!baseUrl) {
    console.warn("[gameApi] baseUrl is empty — process.env.EXPO_PUBLIC_CONVEX_URL not inlined");
    return null;
  }
  // Tight abort so a single slow request doesn't pin a browser HTTP slot
  // forever. The browser only gives us ~6 keep-alive sockets per origin
  // and the WS subscription already takes one — pile-up of pending GETs
  // would lock the pool.
  const controller = new AbortController();
  const timer = setTimeout(() => {
    console.warn(`[gameApi] aborting ${kind} ${path} after ${timeoutMs}ms`);
    controller.abort();
  }, timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/${kind}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, args: args ?? {}, format: "json" }),
      signal: controller.signal,
      // Always open a fresh connection so a stalled prior request can't
      // hold up the next poll behind keep-alive.
      cache: "no-store",
      keepalive: false,
      // Send Cloudflare Access session cookie on cross-origin requests
      // when the tunnel is gated by Access. No-op when running locally.
      credentials: "include",
    });
    console.log(`[gameApi] ${kind} ${path} -> ${res.status} in ${Date.now() - t0}ms`);
    if (!res.ok) {
      console.warn(`[gameApi] ${kind} ${path} HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { status?: string; value?: T; errorMessage?: string; errorData?: unknown };
    if (data.status === "success") return (data.value ?? null) as T | null;
    console.warn(`[gameApi] ${kind} ${path} server error:`, data.errorMessage ?? data);
    return null;
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") {
      // Aborted by our own timer — already logged above. Nothing else to do.
    } else {
      console.error(`[gameApi] ${kind} ${path} threw:`, err);
    }
    return null;
  } finally {
    clearTimeout(timer);
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
