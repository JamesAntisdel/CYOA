import { z } from "zod";

import { ageBandSchema } from "../content";

export const accountKindSchema = z.enum(["guest", "user"]);
export type AccountKind = z.infer<typeof accountKindSchema>;

export const authProviderSchema = z.enum([
  "google",
  "apple",
  "github",
  "microsoft",
  "discord",
  "email_magic_link",
]);
export type AuthProvider = z.infer<typeof authProviderSchema>;

export const createGuestRequestSchema = z.object({
  ageBand: ageBandSchema,
});
export type CreateGuestRequest = z.infer<typeof createGuestRequestSchema>;

export const emailAuthRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(80).optional(),
  ageBand: ageBandSchema.optional(),
});
export type EmailAuthRequest = z.infer<typeof emailAuthRequestSchema>;

export const accountProjectionSchema = z.object({
  accountId: z.string().min(1),
  kind: accountKindSchema,
  ageBand: ageBandSchema,
  matureContentEnabled: z.boolean(),
  isAdmin: z.boolean().optional(),
});
export type AccountProjection = z.infer<typeof accountProjectionSchema>;

export const matureContentUpdateRequestSchema = z.object({
  enabled: z.boolean(),
});
export type MatureContentUpdateRequest = z.infer<typeof matureContentUpdateRequestSchema>;
