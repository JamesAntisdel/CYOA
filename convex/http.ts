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

authComponent.registerRoutes(http, createAuth, {
  cors: {
    allowedOrigins: [
      process.env.PUBLIC_APP_URL,
      process.env.EXPO_PUBLIC_APP_URL,
      process.env.EXPO_PUBLIC_CONVEX_SITE_URL,
    ].filter((origin): origin is string => typeof origin === "string" && origin.length > 0),
  },
});

http.route({
  path: "/llm/scene-stream",
  method: "POST",
  handler: httpActionGeneric(async (ctx, request) => {
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
      return Response.json({ error: "invalid_scene_generation_request" }, { status: 400 });
    }

    let sceneRequest: SceneGenerationRequest;
    try {
      sceneRequest = await ctx.runQuery(makeFunctionReference<"query">("game:getAuthorizedSceneStreamRequest"), {
        accountId: streamRequest.accountId,
        saveId: streamRequest.saveId,
        ...(streamRequest.guestTokenHash ? { guestTokenHash: streamRequest.guestTokenHash } : {}),
      });
    } catch {
      return Response.json({ error: "llm_stream_forbidden" }, { status: 403 });
    }

    return sceneStreamResponse(
      sceneRequest,
      new LlmRouter(),
      async ({ prose, provider }) => {
        await ctx.runMutation(makeFunctionReference<"mutation">("game:completeSceneStream"), {
          accountId: streamRequest.accountId,
          saveId: streamRequest.saveId,
          prose,
          provider,
          ...(streamRequest.guestTokenHash ? { guestTokenHash: streamRequest.guestTokenHash } : {}),
        });
      },
      async () => {
        await ctx.runMutation(makeFunctionReference<"mutation">("game:failSceneStream"), {
          accountId: streamRequest.accountId,
          saveId: streamRequest.saveId,
          ...(streamRequest.guestTokenHash ? { guestTokenHash: streamRequest.guestTokenHash } : {}),
        });
      },
    );
  }),
});

http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: httpActionGeneric(async (ctx, request) => {
    const body = await request.text();
    const signature = request.headers.get("stripe-signature");
    const handled = await handleStripeWebhookForTest({
      body,
      signature,
      webhookSecret: requireStripeWebhookSecret(),
      applyEvent: (event) =>
        ctx.runMutation(makeFunctionReference<"mutation">("billingFunctions:applyNormalizedStripeEvent"), {
          event,
        }),
    });
    return Response.json({ ok: true, ignored: handled.ignored });
  }),
});

export default http;

export function sceneStreamResponse(
  request: SceneGenerationRequest,
  router = new LlmRouter(),
  onComplete?: (result: { prose: string; provider: string }) => Promise<void>,
  onError?: () => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let prose = "";
        let provider = "deterministic";
        for await (const chunk of router.streamScene(request)) {
          prose += chunk.text;
          provider = chunk.provider;
          controller.enqueue(encoder.encode(`event: token\ndata: ${JSON.stringify(chunk)}\n\n`));
        }
        if (onComplete) await onComplete({ prose, provider });
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
    },
  });
}
