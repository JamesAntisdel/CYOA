/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as account from "../account.js";
import type * as accountFunctions from "../accountFunctions.js";
import type * as admin_devRollback from "../admin/devRollback.js";
import type * as analytics from "../analytics.js";
import type * as analyticsEvents from "../analyticsEvents.js";
import type * as assets from "../assets.js";
import type * as betterAuth_auth from "../betterAuth/auth.js";
import type * as betterAuth_providers from "../betterAuth/providers.js";
import type * as billing_apple from "../billing/apple.js";
import type * as billing_config from "../billing/config.js";
import type * as billing_entitlements from "../billing/entitlements.js";
import type * as billing_google from "../billing/google.js";
import type * as billing_nativeReceipts from "../billing/nativeReceipts.js";
import type * as billing_paywall from "../billing/paywall.js";
import type * as billing_stripe from "../billing/stripe.js";
import type * as billing_webhook from "../billing/webhook.js";
import type * as billingFunctions from "../billingFunctions.js";
import type * as contentPolicy from "../contentPolicy.js";
import type * as coop from "../coop.js";
import type * as coopFunctions from "../coopFunctions.js";
import type * as creator from "../creator.js";
import type * as creatorFunctions from "../creatorFunctions.js";
import type * as crons from "../crons.js";
import type * as daily from "../daily.js";
import type * as dailyFunctions from "../dailyFunctions.js";
import type * as endings from "../endings.js";
import type * as endingsFunctions from "../endingsFunctions.js";
import type * as game from "../game.js";
import type * as hardcore from "../hardcore.js";
import type * as http from "../http.js";
import type * as index from "../index.js";
import type * as keepsakes from "../keepsakes.js";
import type * as lib_authz from "../lib/authz.js";
import type * as lib_docs from "../lib/docs.js";
import type * as lib_entitlement from "../lib/entitlement.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_ids from "../lib/ids.js";
import type * as lib_projections from "../lib/projections.js";
import type * as lifecycle from "../lifecycle.js";
import type * as liveCore from "../liveCore.js";
import type * as llm_anthropic from "../llm/anthropic.js";
import type * as llm_deepseek from "../llm/deepseek.js";
import type * as llm_deterministic from "../llm/deterministic.js";
import type * as llm_httpClient from "../llm/httpClient.js";
import type * as llm_parse from "../llm/parse.js";
import type * as llm_promptGuards from "../llm/promptGuards.js";
import type * as llm_prompts_scene from "../llm/prompts/scene.js";
import type * as llm_providerPolicy from "../llm/providerPolicy.js";
import type * as llm_responseSchema from "../llm/responseSchema.js";
import type * as llm_router from "../llm/router.js";
import type * as llm_summarizer from "../llm/summarizer.js";
import type * as llm_ttsVoices from "../llm/ttsVoices.js";
import type * as llm_types from "../llm/types.js";
import type * as llm_vertex from "../llm/vertex.js";
import type * as media_audio from "../media/audio.js";
import type * as media_cinematicFunctions from "../media/cinematicFunctions.js";
import type * as media_cinematicTriggers from "../media/cinematicTriggers.js";
import type * as media_cinematics from "../media/cinematics.js";
import type * as media_geminiImageClient from "../media/geminiImageClient.js";
import type * as media_imagen from "../media/imagen.js";
import type * as media_imagenClient from "../media/imagenClient.js";
import type * as media_mediaCleanup from "../media/mediaCleanup.js";
import type * as media_mediaStrategy from "../media/mediaStrategy.js";
import type * as media_npcMedia from "../media/npcMedia.js";
import type * as media_omniClient from "../media/omniClient.js";
import type * as media_proMediaGate from "../media/proMediaGate.js";
import type * as media_sceneMedia from "../media/sceneMedia.js";
import type * as media_veo from "../media/veo.js";
import type * as memory from "../memory.js";
import type * as migrations from "../migrations.js";
import type * as operatorDashboardFunctions from "../operatorDashboardFunctions.js";
import type * as ratelimit from "../ratelimit.js";
import type * as safety from "../safety.js";
import type * as saves from "../saves.js";
import type * as seasons from "../seasons.js";
import type * as seeds from "../seeds.js";
import type * as tales from "../tales.js";
import type * as talesFunctions from "../talesFunctions.js";
import type * as turn from "../turn.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  account: typeof account;
  accountFunctions: typeof accountFunctions;
  "admin/devRollback": typeof admin_devRollback;
  analytics: typeof analytics;
  analyticsEvents: typeof analyticsEvents;
  assets: typeof assets;
  "betterAuth/auth": typeof betterAuth_auth;
  "betterAuth/providers": typeof betterAuth_providers;
  "billing/apple": typeof billing_apple;
  "billing/config": typeof billing_config;
  "billing/entitlements": typeof billing_entitlements;
  "billing/google": typeof billing_google;
  "billing/nativeReceipts": typeof billing_nativeReceipts;
  "billing/paywall": typeof billing_paywall;
  "billing/stripe": typeof billing_stripe;
  "billing/webhook": typeof billing_webhook;
  billingFunctions: typeof billingFunctions;
  contentPolicy: typeof contentPolicy;
  coop: typeof coop;
  coopFunctions: typeof coopFunctions;
  creator: typeof creator;
  creatorFunctions: typeof creatorFunctions;
  crons: typeof crons;
  daily: typeof daily;
  dailyFunctions: typeof dailyFunctions;
  endings: typeof endings;
  endingsFunctions: typeof endingsFunctions;
  game: typeof game;
  hardcore: typeof hardcore;
  http: typeof http;
  index: typeof index;
  keepsakes: typeof keepsakes;
  "lib/authz": typeof lib_authz;
  "lib/docs": typeof lib_docs;
  "lib/entitlement": typeof lib_entitlement;
  "lib/errors": typeof lib_errors;
  "lib/ids": typeof lib_ids;
  "lib/projections": typeof lib_projections;
  lifecycle: typeof lifecycle;
  liveCore: typeof liveCore;
  "llm/anthropic": typeof llm_anthropic;
  "llm/deepseek": typeof llm_deepseek;
  "llm/deterministic": typeof llm_deterministic;
  "llm/httpClient": typeof llm_httpClient;
  "llm/parse": typeof llm_parse;
  "llm/promptGuards": typeof llm_promptGuards;
  "llm/prompts/scene": typeof llm_prompts_scene;
  "llm/providerPolicy": typeof llm_providerPolicy;
  "llm/responseSchema": typeof llm_responseSchema;
  "llm/router": typeof llm_router;
  "llm/summarizer": typeof llm_summarizer;
  "llm/ttsVoices": typeof llm_ttsVoices;
  "llm/types": typeof llm_types;
  "llm/vertex": typeof llm_vertex;
  "media/audio": typeof media_audio;
  "media/cinematicFunctions": typeof media_cinematicFunctions;
  "media/cinematicTriggers": typeof media_cinematicTriggers;
  "media/cinematics": typeof media_cinematics;
  "media/geminiImageClient": typeof media_geminiImageClient;
  "media/imagen": typeof media_imagen;
  "media/imagenClient": typeof media_imagenClient;
  "media/mediaCleanup": typeof media_mediaCleanup;
  "media/mediaStrategy": typeof media_mediaStrategy;
  "media/npcMedia": typeof media_npcMedia;
  "media/omniClient": typeof media_omniClient;
  "media/proMediaGate": typeof media_proMediaGate;
  "media/sceneMedia": typeof media_sceneMedia;
  "media/veo": typeof media_veo;
  memory: typeof memory;
  migrations: typeof migrations;
  operatorDashboardFunctions: typeof operatorDashboardFunctions;
  ratelimit: typeof ratelimit;
  safety: typeof safety;
  saves: typeof saves;
  seasons: typeof seasons;
  seeds: typeof seeds;
  tales: typeof tales;
  talesFunctions: typeof talesFunctions;
  turn: typeof turn;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
