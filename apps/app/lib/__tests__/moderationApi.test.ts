// Moderation client (product-readiness launch blocker: Apple 1.2 / Play UGC +
// GenAI). Pins the registered path contract and the tolerant wire adapters:
// the queue envelope, null-for-absent optionals, and unknown-enum coercion.

import { describe, expect, it } from "vitest";

import {
  adaptReportQueue,
  adaptReportRow,
  MODERATION_PATHS,
  REPORT_REASONS,
} from "../moderationApi";

describe("moderationApi — path contract", () => {
  it("uses full registered convex paths incl. the module prefix", () => {
    expect(MODERATION_PATHS.reportContent).toBe("moderation:reportContent");
    expect(MODERATION_PATHS.listReports).toBe("moderation:listReports");
    expect(MODERATION_PATHS.resolveReport).toBe("moderation:resolveReport");
  });

  it("mirrors the server reason vocabulary", () => {
    const values = REPORT_REASONS.map((r) => r.value);
    expect(values).toContain("sexual_content");
    expect(values).toContain("illegal_or_csam");
    expect(values).toContain("self_harm");
    expect(values).toContain("other");
    // Every option carries a human label.
    expect(REPORT_REASONS.every((r) => typeof r.label === "string" && r.label.length > 0)).toBe(true);
  });
});

describe("moderationApi — adaptReportRow", () => {
  it("adapts a full row", () => {
    const row = adaptReportRow({
      reportId: "report_1",
      reporterAccountId: "acct_1",
      targetType: "tale",
      targetId: "tale_1",
      reason: "self_harm",
      details: "bad",
      status: "open",
      resolutionNote: "",
      contentHidden: false,
      createdAt: 5,
      updatedAt: 5,
    });
    expect(row).toEqual({
      reportId: "report_1",
      reporterAccountId: "acct_1",
      targetType: "tale",
      targetId: "tale_1",
      reason: "self_harm",
      details: "bad",
      status: "open",
      resolutionNote: null,
      contentHidden: false,
      createdAt: 5,
      updatedAt: 5,
    });
  });

  it("returns null for a row missing its id", () => {
    expect(adaptReportRow({ reason: "other" })).toBeNull();
    expect(adaptReportRow(null)).toBeNull();
    expect(adaptReportRow("nope")).toBeNull();
  });

  it("coerces unknown enums and null-for-absents optionals", () => {
    const row = adaptReportRow({ reportId: "r", reason: "???", targetType: "???", status: "???" });
    expect(row).not.toBeNull();
    expect(row!.reason).toBe("other");
    expect(row!.targetType).toBe("other");
    expect(row!.status).toBe("open");
    expect(row!.details).toBeNull();
    expect(row!.resolutionNote).toBeNull();
    expect(row!.contentHidden).toBe(false);
  });
});

describe("moderationApi — adaptReportQueue", () => {
  it("adapts the { reports: [...] } envelope and drops garbage rows", () => {
    const rows = adaptReportQueue({
      reports: [
        { reportId: "r1", reason: "spam_or_scam", targetType: "tale", status: "open" },
        null,
        { reason: "no_id" },
        { reportId: "r2", reason: "hate_or_harassment", targetType: "seed", status: "resolved" },
      ],
    });
    expect(rows.map((r) => r.reportId)).toEqual(["r1", "r2"]);
  });

  it("returns [] for a malformed envelope", () => {
    expect(adaptReportQueue(null)).toEqual([]);
    expect(adaptReportQueue({})).toEqual([]);
    expect(adaptReportQueue({ reports: "nope" })).toEqual([]);
  });
});
