import { z } from "zod";

export const serverEnvSchema = z.object({
  CONVEX_DEPLOYMENT: z.string().min(1).optional(),
  BETTER_AUTH_SECRET: z.string().min(1).optional(),
  BETTER_AUTH_URL: z.string().url().optional(),
  SITE_URL: z.string().url().optional(),
  JWKS: z.string().min(1).optional(),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  STRIPE_PRICE_UNLIMITED_MONTHLY: z.string().min(1).optional(),
  STRIPE_PRICE_UNLIMITED_ANNUAL: z.string().min(1).optional(),
  STRIPE_PRICE_PRO_MONTHLY: z.string().min(1).optional(),
  STRIPE_PRICE_PRO_ANNUAL: z.string().min(1).optional(),
  APPLE_PRODUCT_UNLIMITED_MONTHLY: z.string().min(1).optional(),
  APPLE_PRODUCT_PRO_MONTHLY: z.string().min(1).optional(),
  GOOGLE_PRODUCT_UNLIMITED_MONTHLY: z.string().min(1).optional(),
  GOOGLE_PRODUCT_PRO_MONTHLY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_MODEL: z.string().min(1).optional(),
  VERTEX_PROJECT_ID: z.string().min(1).optional(),
  VERTEX_LOCATION: z.string().min(1).optional(),
  VERTEX_ACCESS_TOKEN: z.string().min(1).optional(),
  VERTEX_TEXT_MODEL: z.string().min(1).optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_TEXT_MODEL: z.string().min(1).optional(),
  GEMINI_VEO_MODEL: z.string().min(1).optional(),
  GEMINI_VEO_DURATION_MS: z.enum(["4000", "6000", "8000"]).optional(),
  GEMINI_VEO_RESOLUTION: z.enum(["720p", "1080p"]).optional(),
  GEMINI_VEO_ASPECT_RATIO: z.enum(["16:9", "9:16"]).optional(),
  GEMINI_VEO_ESTIMATED_CENTS_PER_SECOND: z.string().regex(/^\d+(\.\d+)?$/u).optional(),
  DEEPSEEK_API_KEY: z.string().min(1).optional(),
  DEEPSEEK_MODEL: z.string().min(1).optional(),
  LLM_TIMEOUT_MS: z.string().regex(/^\d+$/u).optional(),
});
export type ServerEnv = z.infer<typeof serverEnvSchema>;

export const clientEnvSchema = z.object({
  PUBLIC_APP_URL: z.string().url().optional(),
  EXPO_PUBLIC_APP_URL: z.string().url().optional(),
  EXPO_PUBLIC_AUTH_MODE: z.enum(["local", "better-auth"]).optional(),
  EXPO_PUBLIC_CONVEX_URL: z.string().url().optional(),
  EXPO_PUBLIC_CONVEX_SITE_URL: z.string().url().optional(),
  EXPO_PUBLIC_PROVIDER_MOCKS_URL: z.string().url().optional(),
  EXPO_PUBLIC_STRIPE_CHECKOUT_MODE: z.enum(["web", "native"]).optional(),
});
export type ClientEnv = z.infer<typeof clientEnvSchema>;
