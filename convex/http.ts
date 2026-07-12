import { httpActionGeneric, httpRouter, makeFunctionReference } from "convex/server";
import { z } from "zod";

import { authComponent, createAuth } from "./betterAuth/auth";
import { requireStripeWebhookSecret } from "./billing/config";
import { handleStripeWebhookForTest } from "./billingFunctions";
import { sceneGenerationRequestSchema, type SceneGenerationRequest, type TokenChunk } from "./llm/types";
import { ClientDisconnectedError, LlmRouter } from "./llm/router";

const legacySceneStreamHttpRequestSchema = sceneGenerationRequestSchema.extend({
  accountId: z.string().min(1),
  guestTokenHash: z.string().min(1).optional(),
});
const sceneStreamHttpRequestSchema = z.object({
  accountId: z.string().min(1),
  saveId: z.string().min(1),
  guestTokenHash: z.string().min(1).optional(),
});

export async function collectSceneStream(
  request: SceneGenerationRequest,
  router = new LlmRouter(),
): Promise<TokenChunk[]> {
  const chunks: TokenChunk[] = [];
  for await (const chunk of router.streamScene(request)) {
    chunks.push(chunk);
  }
  return chunks;
}

const http = httpRouter();

// Allowed browser origins. Local dev runs at 8081 by default; the tunnel
// override flows through PUBLIC_APP_URL / EXPO_PUBLIC_APP_URL.
function allowedBrowserOrigins(): string[] {
  return [
    process.env.PUBLIC_APP_URL,
    process.env.EXPO_PUBLIC_APP_URL,
    process.env.EXPO_PUBLIC_CONVEX_SITE_URL,
    "http://localhost:8081",
    "http://127.0.0.1:8081",
  ].filter((origin): origin is string => typeof origin === "string" && origin.length > 0);
}

// CORS headers shared by every non-BetterAuth route. BetterAuth handles
// its own CORS via authComponent.registerRoutes below.
function corsHeaders(request: Request): Record<string, string> {
  const allowed = allowedBrowserOrigins();
  const origin = request.headers.get("origin") ?? "";
  const matched = allowed.includes(origin) ? origin : (allowed[0] ?? "*");
  return {
    "access-control-allow-origin": matched,
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers":
      "authorization, content-type, stripe-signature, x-convex-token",
    "access-control-expose-headers": "x-llm-provider",
    "access-control-max-age": "600",
    vary: "origin",
  };
}

// Preflight handler. Convex's httpRouter doesn't auto-OPTIONS, so we
// register an OPTIONS route per path. 204 with the CORS headers above is
// the canonical answer.
function preflightHandler() {
  return httpActionGeneric(async (_ctx, request) => {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  });
}

authComponent.registerRoutes(http, createAuth, {
  cors: {
    allowedOrigins: allowedBrowserOrigins(),
  },
});

http.route({ path: "/llm/scene-stream", method: "OPTIONS", handler: preflightHandler() });
http.route({
  path: "/llm/scene-stream",
  method: "POST",
  handler: httpActionGeneric(async (ctx, request) => {
    const cors = corsHeaders(request);
    let streamRequest: { accountId: string; saveId: string; guestTokenHash?: string | undefined };
    try {
      const body = await request.json();
      const legacy = legacySceneStreamHttpRequestSchema.safeParse(body);
      if (legacy.success) {
        streamRequest = {
          accountId: legacy.data.accountId,
          saveId: legacy.data.saveId,
          ...(legacy.data.guestTokenHash ? { guestTokenHash: legacy.data.guestTokenHash } : {}),
        };
      } else {
        streamRequest = sceneStreamHttpRequestSchema.parse(body);
      }
    } catch {
      return Response.json({ error: "invalid_scene_generation_request" }, { status: 400, headers: cors });
    }

    let sceneRequest: SceneGenerationRequest;
    try {
      // `getAuthorizedSceneStreamRequest` is now a mutation (used to be a
      // query): it both validates the caller AND claims the scene's
      // "streaming" lock with a TTL so a duplicate concurrent open is
      // rejected here rather than racing the first stream and tripping
      // the deterministic-fallback premise-echo bug.
      sceneRequest = await ctx.runMutation(makeFunctionReference<"mutation">("game:getAuthorizedSceneStreamRequest"), {
        accountId: streamRequest.accountId,
        saveId: streamRequest.saveId,
        ...(streamRequest.guestTokenHash ? { guestTokenHash: streamRequest.guestTokenHash } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "llm_stream_forbidden";
      // Surface the dedup-lock rejection with a distinct status so the
      // client can recognise it and back off cleanly — the other in-flight
      // stream is what's going to deliver the prose. 403 is reserved for
      // ownership/auth failures.
      if (message.includes("scene_stream_in_progress")) {
        return Response.json(
          { error: "scene_stream_in_progress" },
          { status: 409, headers: cors },
        );
      }
      return Response.json({ error: "llm_stream_forbidden" }, { status: 403, headers: cors });
    }

    return sceneStreamResponse(
      sceneRequest,
      new LlmRouter(),
      async ({ prose, provider, proposal, terminal, isFallback, tokenUsage, modelId }) => {
        await ctx.runMutation(makeFunctionReference<"mutation">("game:completeSceneStream"), {
          accountId: streamRequest.accountId,
          saveId: streamRequest.saveId,
          prose,
          provider,
          ...(streamRequest.guestTokenHash ? { guestTokenHash: streamRequest.guestTokenHash } : {}),
          ...(proposal ? { proposal } : {}),
          ...(terminal ? { terminal } : {}),
          ...(isFallback ? { isFallback: true } : {}),
          ...(tokenUsage ? { tokenUsage } : {}),
          ...(modelId ? { modelId } : {}),
        });
      },
      async () => {
        await ctx.runMutation(makeFunctionReference<"mutation">("game:failSceneStream"), {
          accountId: streamRequest.accountId,
          saveId: streamRequest.saveId,
          ...(streamRequest.guestTokenHash ? { guestTokenHash: streamRequest.guestTokenHash } : {}),
        });
      },
      cors,
    );
  }),
});

http.route({ path: "/stripe/webhook", method: "OPTIONS", handler: preflightHandler() });
http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: httpActionGeneric(async (ctx, request) => {
    const cors = corsHeaders(request);
    const body = await request.text();
    const signature = request.headers.get("stripe-signature");
    try {
      const handled = await handleStripeWebhookForTest({
        body,
        signature,
        webhookSecret: requireStripeWebhookSecret(),
        applyEvent: (event) =>
          ctx.runMutation(makeFunctionReference<"mutation">("billingFunctions:applyNormalizedStripeEvent"), {
            event,
          }),
      });
      return Response.json({ ok: true, ignored: handled.ignored }, { headers: cors });
    } catch (error) {
      const message = error instanceof Error ? error.message : "stripe_webhook_error";
      // Bad signatures / malformed payloads → 400. Missing secret → 500
      // with a distinct error code so operators can tell config from data.
      const status = message.includes("missing_env") ? 500 : 400;
      return Response.json({ error: message }, { status, headers: cors });
    }
  }),
});

export default http;

export type SceneStreamCompleteResult = {
  prose: string;
  provider: string;
  proposal: unknown;
  terminal: unknown;
  /**
   * The provider's reported token usage for this generation. Forwarded to
   * `completeSceneStream` so turn_history records real input/output counts
   * instead of estimating input from an empty string (which reported 0 input
   * tokens and zeroed the operator cost dashboard's spend column).
   */
  tokenUsage?: { input: number; output: number };
  /**
   * The concrete model id the provider resolved for this generation. Forwarded
   * to `completeSceneStream` so the streaming turn's `estimatedCostCents`
   * telemetry can be priced via `costCentsForUsage` (design §1.3). Absent on
   * providers that predate cost telemetry.
   */
  modelId?: string;
  /**
   * True when the router served this scene from the deterministic fallback
   * provider (every real provider failed or was ineligible). Forwarded to
   * `completeSceneStream` as `isFallback: true` so the scene record carries
   * the sentinel and the reader UI renders the FallbackTurnPanel instead of
   * the placeholder prose / choices.
   */
  isFallback?: boolean;
};

export function sceneStreamResponse(
  request: SceneGenerationRequest,
  router = new LlmRouter(),
  onComplete?: (result: SceneStreamCompleteResult) => Promise<void>,
  onError?: () => Promise<void>,
  extraHeaders: Record<string, string> = {},
): Response {
  const encoder = new TextEncoder();
  // Bridges the ReadableStream's `cancel` callback (fires when the SSE
  // client disconnects) into an AbortSignal the router/providers can
  // observe mid-call. Without this we'd keep paying for the in-flight
  // provider call AND fall through to the deterministic provider on the
  // resulting AbortError, persisting a generic "press on into the story"
  // scene as if it were the real result.
  const abortController = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // SSE heartbeat: emit a comment line every 5s so intermediaries
      // (mobile Chrome, cloudflared, etc.) don't close the connection while
      // the LLM call is in flight. Lines starting with `:` are spec-defined
      // comments — clients silently ignore them, so this doesn't pollute
      // the token/choices/done event stream. Must start BEFORE the LLM
      // call begins; cleared in `finally` so error paths also clean up.
      let alive = true;
      const heartbeat: ReturnType<typeof setInterval> = setInterval(() => {
        if (!alive) return;
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          // Controller closed beneath us; stop the interval defensively.
          alive = false;
          clearInterval(heartbeat);
        }
      }, 5000);
      try {
        let prose = "";
        let provider = "deterministic";
        const result = await router.streamSceneWithResult(
          request,
          (chunk) => {
            prose += chunk.text;
            provider = chunk.provider;
            controller.enqueue(encoder.encode(`event: token\ndata: ${JSON.stringify(chunk)}\n\n`));
          },
          abortController.signal,
        );
        // Diagnostic: when llm-driven runs lose the proposal, we need to know
        // WHY (parser failed? provider returned non-JSON?). Logs the first 200
        // chars of the raw provider output so operators can spot the bug.
        if (request.mode === "llm-driven" && !result.parsed.proposal) {
          const rawSnippet = (result.generation?.text ?? "").slice(0, 200);
          console.warn(
            `[scene-stream] llm-driven proposal missing for save=${request.saveId} provider=${provider} prose_len=${prose.length} raw="${rawSnippet}"`,
          );
        }
        const proposal = result.parsed.proposal ?? null;
        const terminal = proposal?.terminal ?? null;
        // For llm-driven scenes, emit a structured choices event after the
        // prose tokens so a future client (and the JSON-buffering smoke
        // tests) can pick up choices without re-fetching. Authored scenes
        // skip this — their choices come from the engine's authored graph.
        if (proposal) {
          controller.enqueue(
            encoder.encode(
              `event: choices\ndata: ${JSON.stringify({
                choices: proposal.choices,
                terminal,
              })}\n\n`,
            ),
          );
        }
        // Forward the deterministic-fallback sentinel out of band. The
        // router stamps `isFallback: true` on the ProviderGeneration when
        // the deterministic provider had to serve (every real provider
        // failed / was ineligible). `completeSceneStream` persists this
        // flag on the scene record so the reader UI renders the
        // FallbackTurnPanel instead of the placeholder prose + choices.
        const isFallback = result.generation.isFallback === true;
        const tokenUsage = result.generation.tokenUsage;
        const modelId = result.generation.modelId;
        if (onComplete)
          await onComplete({
            prose,
            provider,
            proposal,
            terminal,
            isFallback,
            tokenUsage,
            ...(modelId ? { modelId } : {}),
          });
        controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
        controller.close();
      } catch (error) {
        // Client-disconnect path: the SSE consumer is gone. Patch the
        // scene's streamStatus so the next request can retry, but skip
        // the `event: error` / `event: done` enqueues — there's nobody
        // on the other end of the controller and enqueueing on a cancelled
        // stream throws. We still call `onError` (which runs the
        // `failSceneStream` mutation) so we don't leave the scene record
        // stuck in "streaming" until the lock TTL expires.
        const disconnected =
          error instanceof ClientDisconnectedError || abortController.signal.aborted;
        if (onError) await onError();
        if (!disconnected) {
          try {
            controller.enqueue(
              encoder.encode(
                `event: error\ndata: ${JSON.stringify({
                  error: "llm_stream_failed",
                })}\n\n`,
              ),
            );
          } catch {
            // Controller already closed (client raced us); ignore.
          }
        }
        try {
          controller.close();
        } catch {
          // Already closed via `cancel` callback below; safe to ignore.
        }
      } finally {
        // Always stop the heartbeat — success path, error path, or
        // controller-already-closed path. Without this, the interval
        // would keep firing after the stream resolves and leak.
        alive = false;
        clearInterval(heartbeat);
      }
    },
    cancel(reason) {
      // Fires when the SSE client closes the connection (browser tab
      // closed, fetch AbortController on the client, network drop). The
      // router observes this signal between provider attempts and bails
      // out with a ClientDisconnectedError instead of falling through to
      // the deterministic provider.
      abortController.abort(reason);
    },
  });

  return new Response(stream, {
    headers: {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      ...extraHeaders,
    },
  });
}
