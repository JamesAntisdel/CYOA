// SERVER-half tests for the minimal UI-event telemetry path (P3 debt). Drives
// the registered `recordUiEvent` mutation handler against an in-memory ctx and
// asserts the row it writes into the EXISTING `analytics_events` table, plus
// its tolerant fire-and-forget behavior (a bad event name / failing insert
// resolves rather than throws).

import { describe, expect, it } from "vitest";

import { recordUiEvent } from "../uiAnalytics";

type AnyDoc = Record<string, any>;

/** Minimal ctx exposing just `db.insert`, capturing rows per table. */
function makeCtx(onInsert?: (table: string, doc: AnyDoc) => void) {
  const inserts: Array<{ table: string; doc: AnyDoc }> = [];
  const ctx = {
    db: {
      async insert(table: string, doc: AnyDoc) {
        onInsert?.(table, doc);
        inserts.push({ table, doc });
        return `${table}_1`;
      },
    },
  };
  return { ctx, inserts };
}

// Registered mutations expose the raw handler as `_handler` (see
// pushNotifications.test.ts).
const invoke = (ctx: unknown, args: AnyDoc) =>
  (recordUiEvent as any)._handler(ctx, args);

describe("recordUiEvent — UI-event telemetry insert", () => {
  it("inserts a sanitized ui.tome_open row into analytics_events", async () => {
    const { ctx, inserts } = makeCtx();
    const res = await invoke(ctx, { event: "ui.tome_open" });

    expect(res).toEqual({ recorded: true });
    expect(inserts).toHaveLength(1);
    const { table, doc } = inserts[0]!;
    expect(table).toBe("analytics_events");
    expect(doc.eventName).toBe("ui.tome_open");
    expect(doc.payload).toEqual({});
    expect(doc.redacted).toBe(false);
    expect(typeof doc.createdAt).toBe("number");
    // Anonymous by default — no identifier when none was passed.
    expect(doc.accountId).toBeUndefined();
  });

  it("carries the anonymous accountId and the flat scalar payload", async () => {
    const { ctx, inserts } = makeCtx();
    const res = await invoke(ctx, {
      event: "ui.auto_toggle",
      accountId: "acct_9",
      payload: { on: true },
    });

    expect(res).toEqual({ recorded: true });
    const { doc } = inserts[0]!;
    expect(doc.eventName).toBe("ui.auto_toggle");
    expect(doc.accountId).toBe("acct_9");
    expect(doc.payload).toEqual({ on: true });
  });

  it("records ui.ribbon_expand", async () => {
    const { ctx, inserts } = makeCtx();
    await invoke(ctx, { event: "ui.ribbon_expand" });
    expect(inserts[0]!.doc.eventName).toBe("ui.ribbon_expand");
  });

  it("is tolerant: a malformed (non-dotted) event name is swallowed, not thrown", async () => {
    const { ctx, inserts } = makeCtx();
    // `buildAnalyticsEvent` rejects a name without a dotted segment.
    const res = await invoke(ctx, { event: "not_dotted" });
    expect(res).toEqual({ recorded: false });
    expect(inserts).toHaveLength(0);
  });

  it("is tolerant: a failing db.insert resolves to recorded:false (never throws)", async () => {
    const { ctx } = makeCtx(() => {
      throw new Error("db exploded");
    });
    await expect(invoke(ctx, { event: "ui.tome_open" })).resolves.toEqual({
      recorded: false,
    });
  });

  it("redacts a sensitive key smuggled into the payload (defense in depth)", async () => {
    const { ctx, inserts } = makeCtx();
    // `email` matches the analytics sanitizer's sensitive-key patterns.
    const res = await invoke(ctx, {
      event: "ui.tome_open",
      payload: { email: "leak@example.com" },
    });
    expect(res).toEqual({ recorded: true });
    const { doc } = inserts[0]!;
    expect(doc.payload.email).toBe("[redacted]");
    expect(doc.redacted).toBe(true);
  });
});
