/**
 * Canonical Convex HTTP transport for the client. The app talks to Convex over
 * the HTTP `/api/{query|mutation|action}` endpoints rather than the WS client,
 * because the anonymous local backend doesn't handshake the WS deployment
 * selector (see the note in `gameApi.ts`). This is the shared home for that
 * call pattern; all per-feature `*Api.ts` client modules import from here.
 */
export async function convexHttp<T = unknown>(
  kind: "query" | "mutation" | "action",
  path: string,
  args: Record<string, unknown>,
  timeoutMs = 5000,
): Promise<T | null> {
  const baseUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
  if (!baseUrl) {
    console.warn("[convexHttp] EXPO_PUBLIC_CONVEX_URL not set");
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/${kind}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, args: args ?? {}, format: "json" }),
      signal: controller.signal,
      cache: "no-store",
      keepalive: false,
      credentials: "include",
    });
    if (!res.ok) {
      console.warn(`[convexHttp] ${kind} ${path} HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { status?: string; value?: T; errorMessage?: string };
    if (data.status === "success") return (data.value ?? null) as T | null;
    console.warn(`[convexHttp] ${kind} ${path} server error:`, data.errorMessage ?? data);
    return null;
  } catch (err) {
    if ((err as { name?: string })?.name !== "AbortError") {
      console.error(`[convexHttp] ${kind} ${path} threw:`, err);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Variant of {@link convexHttp} that surfaces server-side AppError codes via a
 * discriminated union instead of collapsing them to `null`. Used where the UI
 * needs a specific reason (e.g. the streaming-turn / free-form paths). Transport
 * failures (network / abort / non-2xx) still return `null` — they carry no
 * useful mutation-level code.
 */
export async function convexHttpWithError<T = unknown>(
  kind: "query" | "mutation" | "action",
  path: string,
  args: Record<string, unknown>,
  timeoutMs = 5000,
): Promise<({ ok: true } & T) | { ok: false; errorCode: string; errorMessage: string } | null> {
  const baseUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
  if (!baseUrl) {
    console.warn("[convexHttp] EXPO_PUBLIC_CONVEX_URL not set");
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/${kind}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, args: args ?? {}, format: "json" }),
      signal: controller.signal,
      cache: "no-store",
      keepalive: false,
      credentials: "include",
    });
    if (!res.ok) {
      console.warn(`[convexHttp] ${kind} ${path} HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { status?: string; value?: T; errorMessage?: string };
    if (data.status === "success") {
      const value = (data.value ?? {}) as T;
      return { ok: true, ...value };
    }
    const raw = typeof data.errorMessage === "string" ? data.errorMessage : "unknown_error";
    return { ok: false, errorCode: raw.replace(/^AppError:\s*/u, ""), errorMessage: raw };
  } catch (err) {
    if ((err as { name?: string })?.name !== "AbortError") {
      console.error(`[convexHttp] ${kind} ${path} threw:`, err);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}
