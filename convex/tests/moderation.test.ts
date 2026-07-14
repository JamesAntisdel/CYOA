// Moderation MVP (product-readiness launch blocker: Apple 1.2 / Play UGC +
// GenAI). Covers the pure helpers (normalize / build / project / resolve) and
// the registered-handler seam with a hand-built ctx mock (same style as
// talesFunctions.test.ts): a report writes an open row, the admin queue is
// admin-only (a non-admin is rejected), and resolve closes + optionally hides.

import { describe, expect, it } from "vitest";

import {
  buildReportDoc,
  clampReportsPageSize,
  listReports,
  normalizeReportReason,
  normalizeResolveStatus,
  normalizeTargetType,
  projectReportRow,
  reportContent,
  REPORTS_PAGE_DEFAULT,
  REPORTS_PAGE_MAX,
  REPORT_DETAILS_MAX,
  resolveReport,
  resolveReportPatch,
} from "../moderation";
import { AppError } from "../lib/errors";

// --- pure helpers ---------------------------------------------------------

describe("moderation — normalizers", () => {
  it("passes known reasons through and defaults unknown to 'other'", () => {
    expect(normalizeReportReason("self_harm")).toBe("self_harm");
    expect(normalizeReportReason("nonsense")).toBe("other");
    expect(normalizeReportReason(undefined)).toBe("other");
    expect(normalizeReportReason(42)).toBe("other");
  });

  it("passes known target types through and defaults unknown to 'other'", () => {
    expect(normalizeTargetType("tale")).toBe("tale");
    expect(normalizeTargetType("scene")).toBe("scene");
    expect(normalizeTargetType("garbage")).toBe("other");
  });

  it("coerces resolve status to resolved/dismissed only", () => {
    expect(normalizeResolveStatus("dismissed")).toBe("dismissed");
    expect(normalizeResolveStatus("resolved")).toBe("resolved");
    expect(normalizeResolveStatus("open")).toBe("resolved");
    expect(normalizeResolveStatus(undefined)).toBe("resolved");
  });

  it("clamps the queue page size", () => {
    expect(clampReportsPageSize(undefined)).toBe(REPORTS_PAGE_DEFAULT);
    expect(clampReportsPageSize(0)).toBe(REPORTS_PAGE_DEFAULT);
    expect(clampReportsPageSize(-1)).toBe(REPORTS_PAGE_DEFAULT);
    expect(clampReportsPageSize(10)).toBe(10);
    expect(clampReportsPageSize(9999)).toBe(REPORTS_PAGE_MAX);
  });
});

describe("moderation — buildReportDoc", () => {
  it("builds an open report, normalizing reason/target and trimming detail", () => {
    const doc = buildReportDoc({
      reporterAccountId: "acct_1",
      targetType: "tale",
      targetId: "  tale_9  ",
      reason: "hate_or_harassment",
      details: "  this is bad  ",
      now: 1000,
    });
    expect(doc).toEqual({
      reporterAccountId: "acct_1",
      targetType: "tale",
      targetId: "tale_9",
      reason: "hate_or_harassment",
      details: "this is bad",
      status: "open",
      createdAt: 1000,
      updatedAt: 1000,
    });
  });

  it("omits blank detail and normalizes an unknown reason to 'other'", () => {
    const doc = buildReportDoc({
      reporterAccountId: "acct_1",
      targetType: "weird",
      targetId: "x",
      reason: "???",
      details: "   ",
      now: 5,
    });
    expect(doc.details).toBeUndefined();
    expect(doc.reason).toBe("other");
    expect(doc.targetType).toBe("other");
  });

  it("caps overlong detail at the max length", () => {
    const doc = buildReportDoc({
      reporterAccountId: "a",
      targetType: "tale",
      targetId: "t",
      reason: "spam_or_scam",
      details: "x".repeat(REPORT_DETAILS_MAX + 500),
      now: 1,
    });
    expect(doc.details?.length).toBe(REPORT_DETAILS_MAX);
  });

  it("throws when there is no target to report against", () => {
    expect(() =>
      buildReportDoc({
        reporterAccountId: "a",
        targetType: "tale",
        targetId: "   ",
        reason: "other",
        now: 1,
      }),
    ).toThrow(AppError);
  });
});

describe("moderation — projectReportRow", () => {
  it("projects a full row and null-for-absents the optionals", () => {
    const row = projectReportRow({
      _id: "report_1",
      reporterAccountId: "acct_1",
      targetType: "tale",
      targetId: "tale_1",
      reason: "self_harm",
      status: "open",
      createdAt: 10,
      updatedAt: 10,
    });
    expect(row).toEqual({
      reportId: "report_1",
      reporterAccountId: "acct_1",
      targetType: "tale",
      targetId: "tale_1",
      reason: "self_harm",
      details: null,
      status: "open",
      resolutionNote: null,
      contentHidden: false,
      createdAt: 10,
      updatedAt: 10,
    });
  });

  it("tolerates a legacy/partial row with safe defaults", () => {
    const row = projectReportRow({ _id: "report_x" });
    expect(row.reportId).toBe("report_x");
    expect(row.targetType).toBe("other");
    expect(row.reason).toBe("other");
    expect(row.status).toBe("open");
    expect(row.contentHidden).toBe(false);
    expect(row.createdAt).toBe(0);
  });
});

describe("moderation — resolveReportPatch", () => {
  it("stamps status, resolver, note, and hidden flag", () => {
    const patch = resolveReportPatch({
      status: "resolved",
      resolvedByAccountId: "admin_1",
      note: "  clear violation  ",
      contentHidden: true,
      now: 200,
    });
    expect(patch).toEqual({
      status: "resolved",
      resolvedByAccountId: "admin_1",
      resolvedAt: 200,
      updatedAt: 200,
      resolutionNote: "clear violation",
      contentHidden: true,
    });
  });

  it("omits an absent note and the hidden flag when not hiding", () => {
    const patch = resolveReportPatch({
      status: "dismissed",
      resolvedByAccountId: "admin_1",
      now: 5,
    });
    expect(patch).toEqual({
      status: "dismissed",
      resolvedByAccountId: "admin_1",
      resolvedAt: 5,
      updatedAt: 5,
    });
  });
});

// --- handler seam ---------------------------------------------------------

type AnyDoc = Record<string, any>;

function makeCtx(seed: Record<string, AnyDoc[]>, identitySubject?: string) {
  const tables = new Map<string, AnyDoc[]>();
  const byId = new Map<string, AnyDoc>();
  for (const [table, rows] of Object.entries(seed)) {
    const copy = rows.map((row) => ({ ...row }));
    tables.set(table, copy);
    for (const row of copy) byId.set(String(row._id), row);
  }
  let nextId = 1;

  return {
    auth: {
      getUserIdentity: async () => (identitySubject ? { subject: identitySubject } : null),
    },
    db: {
      async get(id: any) {
        return byId.get(String(id)) ?? null;
      },
      query(table: string) {
        const rows = tables.get(table) ?? [];
        const constraints: Array<[string, unknown]> = [];
        let direction: "asc" | "desc" = "asc";
        const q = {
          eq(field: string, value: unknown) {
            constraints.push([field, value]);
            return q;
          },
        };
        const filtered = () =>
          rows
            .filter((row) => constraints.every(([field, value]) => row[field] === value))
            .sort((a, b) =>
              direction === "asc"
                ? Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0)
                : Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0),
            );
        const chain = {
          withIndex(_name: string, build?: (qq: any) => any) {
            if (build) build(q);
            return chain;
          },
          order(dir: "asc" | "desc") {
            direction = dir;
            return chain;
          },
          async first() {
            return filtered()[0] ?? null;
          },
          async collect() {
            return filtered();
          },
          async take(n: number) {
            return filtered().slice(0, n);
          },
        };
        return chain;
      },
      async insert(table: string, doc: any) {
        const id = `${table}_${nextId++}`;
        const row = { ...doc, _id: id };
        if (!tables.has(table)) tables.set(table, []);
        tables.get(table)!.push(row);
        byId.set(id, row);
        return id;
      },
      async patch(id: any, patch: any) {
        const existing = byId.get(String(id));
        if (!existing) return;
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined) delete existing[key];
          else existing[key] = value;
        }
      },
    },
    _tables: tables,
    _byId: byId,
  };
}

// A guest reporter authorizes by matching guest token; an admin here is a guest
// account carrying isAdmin (assertAdmin only checks the flag; the session proof
// is the guest-token match).
const GUEST = { _id: "acct_guest", kind: "guest", guestTokenHash: "tok_guest" };
const ADMIN = { _id: "acct_admin", kind: "guest", isAdmin: true, guestTokenHash: "tok_admin" };
const NON_ADMIN = { _id: "acct_reader", kind: "guest", guestTokenHash: "tok_reader" };

describe("moderation — reportContent handler", () => {
  it("writes an open report for an authorized reporter", async () => {
    const ctx = makeCtx({ accounts: [GUEST] });
    const result = await (reportContent as any)._handler(ctx, {
      accountId: "acct_guest",
      guestTokenHash: "tok_guest",
      targetType: "tale",
      targetId: "tale_42",
      reason: "hate_or_harassment",
    });
    expect(result.status).toBe("open");
    const reports = ctx._tables.get("reports")!;
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      reporterAccountId: "acct_guest",
      targetType: "tale",
      targetId: "tale_42",
      reason: "hate_or_harassment",
      status: "open",
    });
  });

  it("rejects a reporter who can't prove they own the account", async () => {
    const ctx = makeCtx({ accounts: [GUEST] });
    await expect(
      (reportContent as any)._handler(ctx, {
        accountId: "acct_guest",
        guestTokenHash: "wrong_token",
        targetType: "tale",
        targetId: "tale_42",
        reason: "other",
      }),
    ).rejects.toThrow();
  });
});

describe("moderation — listReports handler (admin-gated)", () => {
  const seed = () => ({
    accounts: [ADMIN, NON_ADMIN],
    reports: [
      {
        _id: "report_open_1",
        reporterAccountId: "acct_reader",
        targetType: "tale",
        targetId: "tale_1",
        reason: "spam_or_scam",
        status: "open",
        createdAt: 100,
        updatedAt: 100,
      },
      {
        _id: "report_resolved_1",
        reporterAccountId: "acct_reader",
        targetType: "tale",
        targetId: "tale_2",
        reason: "other",
        status: "resolved",
        createdAt: 90,
        updatedAt: 95,
      },
    ],
  });

  it("returns the open queue to an admin", async () => {
    const ctx = makeCtx(seed());
    const result = await (listReports as any)._handler(ctx, {
      accountId: "acct_admin",
      guestTokenHash: "tok_admin",
    });
    expect(result.reports).toHaveLength(1);
    expect(result.reports[0].reportId).toBe("report_open_1");
    expect(result.reports[0].status).toBe("open");
  });

  it("filters by the requested status", async () => {
    const ctx = makeCtx(seed());
    const result = await (listReports as any)._handler(ctx, {
      accountId: "acct_admin",
      guestTokenHash: "tok_admin",
      status: "resolved",
    });
    expect(result.reports.map((r: any) => r.reportId)).toEqual(["report_resolved_1"]);
  });

  it("rejects a non-admin caller before any row is read", async () => {
    const ctx = makeCtx(seed());
    await expect(
      (listReports as any)._handler(ctx, {
        accountId: "acct_reader",
        guestTokenHash: "tok_reader",
      }),
    ).rejects.toThrow(/admin_required/);
  });
});

describe("moderation — resolveReport handler (admin-gated)", () => {
  const seed = () => ({
    accounts: [ADMIN, NON_ADMIN],
    published_tales: [{ _id: "tale_1", accessRevokedAt: undefined }],
    reports: [
      {
        _id: "report_1",
        reporterAccountId: "acct_reader",
        targetType: "tale",
        targetId: "tale_1",
        reason: "sexual_content",
        status: "open",
        createdAt: 100,
        updatedAt: 100,
      },
    ],
  });

  it("resolves + hides the tale (sets accessRevokedAt)", async () => {
    const ctx = makeCtx(seed());
    const result = await (resolveReport as any)._handler(ctx, {
      accountId: "acct_admin",
      guestTokenHash: "tok_admin",
      reportId: "report_1",
      status: "resolved",
      hideContent: true,
    });
    expect(result).toMatchObject({ status: "resolved", contentHidden: true });
    const report = ctx._byId.get("report_1")!;
    expect(report.status).toBe("resolved");
    expect(report.contentHidden).toBe(true);
    const tale = ctx._byId.get("tale_1")!;
    expect(typeof tale.accessRevokedAt).toBe("number");
  });

  it("dismisses without hiding", async () => {
    const ctx = makeCtx(seed());
    const result = await (resolveReport as any)._handler(ctx, {
      accountId: "acct_admin",
      guestTokenHash: "tok_admin",
      reportId: "report_1",
      status: "dismissed",
    });
    expect(result).toMatchObject({ status: "dismissed", contentHidden: false });
    const tale = ctx._byId.get("tale_1")!;
    expect(tale.accessRevokedAt).toBeUndefined();
  });

  it("rejects a non-admin caller", async () => {
    const ctx = makeCtx(seed());
    await expect(
      (resolveReport as any)._handler(ctx, {
        accountId: "acct_reader",
        guestTokenHash: "tok_reader",
        reportId: "report_1",
        status: "resolved",
      }),
    ).rejects.toThrow(/admin_required/);
  });
});
