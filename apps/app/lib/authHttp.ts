/**
 * Shared helpers for the BetterAuth HTTP surface, used by both authClient.ts
 * (email/password + session) and authApi.ts (social + magic-link). Previously
 * copy-pasted in both.
 */
export async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function getErrorMessage(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const message = (data as { message?: unknown; error?: unknown }).message ?? (data as { error?: unknown }).error;
  return typeof message === "string" ? message : undefined;
}
