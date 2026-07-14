// User-generated-content moderation (product-readiness review — launch blocker:
// Apple 1.2 / Play UGC + GenAI policy). Now that the community shelf ships
// (public tales + seeds + AI-generated reader scenes), the store policies
// require (a) a way for any reader to REPORT objectionable content and (b) an
// operator surface to review and act on those reports (takedown).
//
// Shape mirrors adminContent.ts:
//   - `reportContent` is caller-authenticated: the reporter proves they own the
//     account row they claim (guest-token proof or auth identity) via
//     `loadAndAuthorizeAccount`, so a report can't be spoofed onto another
//     account. Guests can report (they hold an account row too).
//   - `listReports` / `resolveReport` are ADMIN-gated: `loadAndAuthorizeAccount`
//     proves ownership, THEN `assertAdmin` throws `admin_required` before any
//     report row is read or mutated. No queue leaks to a non-admin.
//
// The pure helpers (normalize/build/project/resolve) carry the whole testable
// surface (unit-tested in convex/tests/moderation.test.ts); the registered
// wrappers are the thin DB-bound seam.
//
// SCHEMA (INTEGRATOR): this module writes to a `reports` table that does NOT yet
// exist in schema.ts. The exact defineTable shape is reported in the task's
// integratorNeeds. Every field is concrete-or-optional and legacy-tolerant so a
// row written before a later field existed still projects.

import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

import { assertAdmin, loadAndAuthorizeAccount } from "./lib/authz";
import { accountFromDoc } from "./lib/docs";
import { cleanDoc } from "./lib/docs";
import { AppError } from "./lib/errors";

// --- Enums (exported so client + tests pin the same wire vocabulary) -------

export const REPORT_REASONS = [
  "sexual_content",
  "hate_or_harassment",
  "self_harm",
  "violence_or_threats",
  "illegal_or_csam",
  "spam_or_scam",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_TARGET_TYPES = ["tale", "scene", "save", "seed", "comment", "other"] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const REPORT_STATUSES = ["open", "resolved", "dismissed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

// Hard cap on free-text so a hostile reporter can't stuff the row. Trimmed and
// truncated in `buildReportDoc`.
export const REPORT_DETAILS_MAX = 2000;

// Default + max queue page size for the admin listing.
export const REPORTS_PAGE_DEFAULT = 50;
export const REPORTS_PAGE_MAX = 200;

// --- Pure helpers (unit-tested) -------------------------------------------

/** Coerce an arbitrary value to a known reason; unknown → "other". */
export function normalizeReportReason(value: unknown): ReportReason {
  return (REPORT_REASONS as readonly string[]).includes(value as string)
    ? (value as ReportReason)
    : "other";
}

/** Coerce an arbitrary value to a known target type; unknown → "other". */
export function normalizeTargetType(value: unknown): ReportTargetType {
  return (REPORT_TARGET_TYPES as readonly string[]).includes(value as string)
    ? (value as ReportTargetType)
    : "other";
}

/** Coerce a resolution status; only "resolved"/"dismissed" are valid closes. */
export function normalizeResolveStatus(value: unknown): "resolved" | "dismissed" {
  return value === "dismissed" ? "dismissed" : "resolved";
}

export function clampReportsPageSize(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
    return REPORTS_PAGE_DEFAULT;
  }
  return Math.min(Math.floor(limit), REPORTS_PAGE_MAX);
}

export type ReportDoc = {
  reporterAccountId: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  details?: string;
  status: ReportStatus;
  createdAt: number;
  updatedAt: number;
};

/**
 * Build the `reports` insert doc from a report request. Pure + tolerant:
 * normalizes the reason/target vocabulary, trims + caps the free-text detail
 * (omitted entirely when blank so `cleanDoc` keeps the row minimal), and stamps
 * status "open". Throws `report_target_required` when there is nothing to
 * report against — the one hard precondition.
 */
export function buildReportDoc(input: {
  reporterAccountId: string;
  targetType: unknown;
  targetId: unknown;
  reason: unknown;
  details?: unknown;
  now: number;
}): ReportDoc {
  const targetId = typeof input.targetId === "string" ? input.targetId.trim() : "";
  if (!targetId) throw new AppError("report_target_required");
  const details =
    typeof input.details === "string" && input.details.trim().length > 0
      ? input.details.trim().slice(0, REPORT_DETAILS_MAX)
      : undefined;
  return {
    reporterAccountId: input.reporterAccountId,
    targetType: normalizeTargetType(input.targetType),
    targetId,
    reason: normalizeReportReason(input.reason),
    ...(details !== undefined ? { details } : {}),
    status: "open",
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export type AdminReportRow = {
  reportId: string;
  reporterAccountId: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  resolutionNote: string | null;
  contentHidden: boolean;
  createdAt: number;
  updatedAt: number;
};

/**
 * Project a raw `reports` doc into the admin queue row. Tolerant: a legacy /
 * partial row degrades to safe defaults rather than throwing. `details` and
 * `resolutionNote` use null-for-absent (BC2 wire convention).
 */
export function projectReportRow(doc: Record<string, unknown>): AdminReportRow {
  const status = (REPORT_STATUSES as readonly string[]).includes(doc.status as string)
    ? (doc.status as ReportStatus)
    : "open";
  return {
    reportId: String(doc._id),
    reporterAccountId:
      doc.reporterAccountId === undefined || doc.reporterAccountId === null
        ? ""
        : String(doc.reporterAccountId),
    targetType: normalizeTargetType(doc.targetType),
    targetId: typeof doc.targetId === "string" ? doc.targetId : "",
    reason: normalizeReportReason(doc.reason),
    details: typeof doc.details === "string" && doc.details.length > 0 ? doc.details : null,
    status,
    resolutionNote:
      typeof doc.resolutionNote === "string" && doc.resolutionNote.length > 0
        ? doc.resolutionNote
        : null,
    contentHidden: doc.contentHidden === true,
    createdAt: asCount(doc.createdAt),
    updatedAt: asCount(doc.updatedAt),
  };
}

/**
 * Build the patch that closes a report. Pure: stamps the new status, records
 * who resolved it + when, an optional (trimmed) note, and whether the
 * underlying content was hidden as part of the action.
 */
export function resolveReportPatch(input: {
  status: unknown;
  resolvedByAccountId: string;
  note?: unknown;
  contentHidden?: boolean;
  now: number;
}): Record<string, unknown> {
  const note =
    typeof input.note === "string" && input.note.trim().length > 0
      ? input.note.trim().slice(0, REPORT_DETAILS_MAX)
      : undefined;
  return cleanDoc({
    status: normalizeResolveStatus(input.status),
    resolvedByAccountId: input.resolvedByAccountId,
    resolvedAt: input.now,
    updatedAt: input.now,
    ...(note !== undefined ? { resolutionNote: note } : {}),
    ...(input.contentHidden ? { contentHidden: true } : {}),
  });
}

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// --- Args ------------------------------------------------------------------

const accountId = v.id("accounts");
const guestTokenHash = v.optional(v.string());
const reportReason = v.union(...REPORT_REASONS.map((r) => v.literal(r)));
const targetType = v.union(...REPORT_TARGET_TYPES.map((t) => v.literal(t)));

// --- Registered functions --------------------------------------------------

/**
 * Report a piece of user-generated / AI-generated content. Caller-authenticated
 * (the reporter proves they own the account row), tolerant of the reason/target
 * vocabulary, and idempotent-ish (each tap writes one open report; the admin
 * queue dedupes by eye). Returns the new report id + status.
 */
export const reportContent = mutationGeneric({
  args: {
    accountId,
    guestTokenHash,
    targetType,
    targetId: v.string(),
    reason: reportReason,
    details: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ reportId: string; status: ReportStatus }> => {
    // Prove the caller owns the reporter account (guest-token or auth identity).
    const reporter = await loadAndAuthorizeAccount(ctx, args.accountId, args.guestTokenHash);
    const doc = buildReportDoc({
      reporterAccountId: String(reporter._id),
      targetType: args.targetType,
      targetId: args.targetId,
      reason: args.reason,
      details: args.details,
      now: Date.now(),
    });
    const reportId = await ctx.db.insert("reports", cleanDoc(doc));
    return { reportId: String(reportId), status: doc.status };
  },
});

/**
 * Admin takedown queue. Lists reports for a given status (default "open"),
 * newest first, bounded. Admin-gated: a non-admin caller is rejected before any
 * row is read.
 */
export const listReports = queryGeneric({
  args: {
    accountId,
    guestTokenHash,
    status: v.optional(v.union(...REPORT_STATUSES.map((s) => v.literal(s)))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ reports: AdminReportRow[] }> => {
    await authorizeAdmin(ctx, args.accountId, args.guestTokenHash);
    const status: ReportStatus = args.status ?? "open";
    const numItems = clampReportsPageSize(args.limit);
    // Prefer the by_status index when present; fall back to a bounded full scan
    // (filtered) so the query still works before the index lands.
    let rows: Array<Record<string, unknown>>;
    try {
      rows = await ctx.db
        .query("reports")
        .withIndex("by_status", (q: any) => q.eq("status", status))
        .order("desc")
        .take(numItems);
    } catch {
      const scanned = await ctx.db.query("reports").order("desc").take(REPORTS_PAGE_MAX);
      rows = scanned.filter((r: Record<string, unknown>) => (r.status ?? "open") === status);
    }
    return { reports: rows.slice(0, numItems).map(projectReportRow) };
  },
});

/**
 * Resolve (or dismiss) a report. Admin-gated. Optionally HIDES the reported
 * content as part of the action — for `targetType: "tale"` this sets the tale's
 * `accessRevokedAt` (the existing revoke field), which is the takedown lever the
 * read/fork paths already honor. Returns the closed status + whether content was
 * hidden.
 */
export const resolveReport = mutationGeneric({
  args: {
    accountId,
    guestTokenHash,
    reportId: v.id("reports"),
    status: v.union(v.literal("resolved"), v.literal("dismissed")),
    note: v.optional(v.string()),
    hideContent: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ reportId: string; status: "resolved" | "dismissed"; contentHidden: boolean }> => {
    const admin = await authorizeAdmin(ctx, args.accountId, args.guestTokenHash);
    const report = await ctx.db.get(args.reportId);
    if (!report) throw new AppError("report_not_found");

    const now = Date.now();
    let contentHidden = false;
    if (args.hideContent === true) {
      contentHidden = await hideReportedContent(ctx, report, now);
    }

    const patch = resolveReportPatch({
      status: args.status,
      resolvedByAccountId: admin,
      ...(args.note !== undefined ? { note: args.note } : {}),
      contentHidden,
      now,
    });
    await ctx.db.patch(args.reportId, patch);
    return {
      reportId: String(args.reportId),
      status: normalizeResolveStatus(args.status),
      contentHidden,
    };
  },
});

// --- internals -------------------------------------------------------------

/**
 * Load caller, prove session ownership, THEN assert admin. Returns the admin's
 * account id (for resolution bookkeeping). Never leaks content — or an id's
 * admin status — to a caller who hasn't proven both.
 */
async function authorizeAdmin(
  ctx: any,
  callerAccountId: unknown,
  callerGuestTokenHash: string | undefined,
): Promise<string> {
  const caller = await loadAndAuthorizeAccount(ctx, callerAccountId, callerGuestTokenHash);
  assertAdmin(accountFromDoc(caller));
  return String(caller._id);
}

/**
 * Take down the content a report points at. Only tales have a first-class
 * revoke lever today (`published_tales.accessRevokedAt`), which the read/fork
 * paths already honor — so a tale takedown flips that. Other target types have
 * no content-level hide yet; the report is still marked `contentHidden: false`
 * and closed (the operator handles those out of band for now). Best-effort:
 * a missing target does not fail the resolution.
 */
async function hideReportedContent(
  ctx: any,
  report: Record<string, unknown>,
  now: number,
): Promise<boolean> {
  if (report.targetType !== "tale") return false;
  const targetId = typeof report.targetId === "string" ? report.targetId : "";
  if (!targetId) return false;
  try {
    const tale = await ctx.db.get(targetId as any);
    if (!tale) return false;
    await ctx.db.patch(targetId as any, { accessRevokedAt: now, updatedAt: now });
    return true;
  } catch {
    return false;
  }
}
