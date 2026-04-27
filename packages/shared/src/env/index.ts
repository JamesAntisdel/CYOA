import { z } from "zod";

export const serverEnvSchema = z.object({
  CONVEX_DEPLOYMENT: z.string().min(1).optional(),
  BETTER_AUTH_SECRET: z.string().min(1).optional(),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  VERTEX_PROJECT_ID: z.string().min(1).optional(),
  VERTEX_LOCATION: z.string().min(1).optional(),
  DEEPSEEK_API_KEY: z.string().min(1).optional(),
});
export type ServerEnv = z.infer<typeof serverEnvSchema>;

export const clientEnvSchema = z.object({
  EXPO_PUBLIC_CONVEX_URL: z.string().url().optional(),
});
export type ClientEnv = z.infer<typeof clientEnvSchema>;
