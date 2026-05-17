import { httpActionGeneric, httpRouter, makeFunctionReference } from "convex/server";
import { z } from "zod";

import { authComponent, createAuth } from "./betterAuth/auth";
import { requireStripeWebhookSecret } from "./billing/config";
import { handleStripeWebhookForTest } from "./billingFunctions";
import { sceneGenerationRequestSchema, type SceneGenerationRequest, type TokenChunk } from "./llm/types";
import { LlmRouter } from "./llm/router";

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
      sceneRequest = await ctx.runQuery(makeFunctionReference<"query">("game:getAuthorizedSceneStreamRequest"), {
        accountId: streamRequest.accountId,
        saveId: streamRequest.saveId,
        ...(streamRequest.guestTokenHash ? { guestTokenHash: streamRequest.guestTokenHash } : {}),
      });
    } catch {
      return Response.json({ error: "llm_stream_forbidden" }, { status: 403, headers: cors });
    }

    return sceneStreamResponse(
      sceneRequest,
      new LlmRouter(),
      async ({ prose, provider, proposal, terminal }) => {
        await ctx.runMutation(makeFunctionReference<"mutation">("game:completeSceneStream"), {
          accountId: streamRequest.accountId,
          saveId: streamRequest.saveId,
          prose,
          provider,
          ...(streamRequest.guestTokenHash ? { guestTokenHash: streamRequest.guestTokenHash } : {}),
          ...(proposal ? { proposal } : {}),
          ...(terminal ? { terminal } : {}),
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
};

export function sceneStreamResponse(
  request: SceneGenerationRequest,
  router = new LlmRouter(),
  onComplete?: (result: SceneStreamCompleteResult) => Promise<void>,
  onError?: () => Promise<void>,
  extraHeaders: Record<string, string> = {},
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let prose = "";
        let provider = "deterministic";
        const result = await router.streamSceneWithResult(request, (chunk) => {
          prose += chunk.text;
          provider = chunk.provider;
          controller.enqueue(encoder.encode(`event: token\ndata: ${JSON.stringify(chunk)}\n\n`));
        });
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
        if (onComplete) await onComplete({ prose, provider, proposal, terminal });
        controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
        controller.close();
      } catch (error) {
        if (onError) await onError();
        controller.enqueue(
          encoder.encode(
            `event: error\ndata: ${JSON.stringify({
              error: "llm_stream_failed",
            })}\n\n`,
          ),
        );
        controller.close();
      }
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
