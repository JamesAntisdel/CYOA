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
