// Client access to the UGC moderation surface (product-readiness launch
// blocker: Apple 1.2 / Play UGC + GenAI). Two audiences:
//   - every reader: `reportContent` (report a tale / community seed / AI scene).
//   - admins only: `getRemoteReportQueue` + `resolveRemoteReport` (the takedown
//     queue). The server rejects non-admins, so a non-null queue result is
//     itself proof of admin — the admin view keys its gate off that.
//
// Uses the shared `convexHttp` transport (`/api/{query,mutation}`) — the
// anonymous local backend doesn't handshake the WS path. Registered functions
// all live in `convex/moderation.ts`, so the module segment is `moderation`.

import { convexClient } from "./convex";
import { convexHttp as callConvexHttp } from "./convexHttp";

/** Full registered convex paths — pinned so tests can assert them. */
export const MODERATION_PATHS = {
  reportContent: "moderation:reportContent",
  listReports: "moderation:listReports",
  resolveReport: "moderation:resolveReport",
} as const;

// Client mirror of the server report vocabulary. Kept in lockstep with
// convex/moderation.ts REPORT_REASONS.
export const REPORT_REASONS = [
  { value: "sexual_content", label: "Sexual or explicit content" },
  { value: "hate_or_harassment", label: "Hate or harassment" },
  { value: "self_harm", label: "Self-harm or suicide" },
  { value: "violence_or_threats", label: "Violence or threats" },
  { value: "illegal_or_csam", label: "Illegal content or child exploitation" },
  { value: "spam_or_scam", label: "Spam or scam" },
  { value: "other", label: "Something else" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["value"];
export type ReportTargetType = "tale" | "scene" | "save" | "seed" | "comment" | "other";
export type ReportStatus = "open" | "resolved" | "dismissed";

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

// --- Coercers (BC2 — the wire is cast, never trusted) ---------------------

function asNum(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asStr(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

const REASON_VALUES = REPORT_REASONS.map((r) => r.value) as readonly string[];
const TARGET_VALUES: readonly string[] = ["tale", "scene", "save", "seed", "comment", "other"];
const STATUS_VALUES: readonly string[] = ["open", "resolved", "dismissed"];

function asReason(value: unknown): ReportReason {
  return REASON_VALUES.includes(value as string) ? (value as ReportReason) : "other";
}

function asTargetType(value: unknown): ReportTargetType {
  return TARGET_VALUES.includes(value as string) ? (value as ReportTargetType) : "other";
}

function asStatus(value: unknown): ReportStatus {
  return STATUS_VALUES.includes(value as string) ? (value as ReportStatus) : "open";
}

/** Adapt one raw report row from the wire into the client shape. Tolerant. */
export function adaptReportRow(raw: unknown): AdminReportRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.reportId !== "string") return null;
  return {
    reportId: r.reportId,
    reporterAccountId: asStr(r.reporterAccountId),
    targetType: asTargetType(r.targetType),
    targetId: asStr(r.targetId),
    reason: asReason(r.reason),
    details: typeof r.details === "string" && r.details.length > 0 ? r.details : null,
    status: asStatus(r.status),
    resolutionNote:
      typeof r.resolutionNote === "string" && r.resolutionNote.length > 0
        ? r.resolutionNote
        : null,
    contentHidden: r.contentHidden === true,
    createdAt: asNum(r.createdAt),
    updatedAt: asNum(r.updatedAt),
  };
}

/** Adapt the `{ reports: [...] }` list envelope. Never null; [] = empty. */
export function adaptReportQueue(raw: unknown): AdminReportRow[] {
  const reports = (raw as { reports?: unknown })?.reports;
  if (!Array.isArray(reports)) return [];
  return reports
    .map(adaptReportRow)
    .filter((r): r is AdminReportRow => r !== null);
}

// --- Callers ---------------------------------------------------------------

/**
 * Submit a content report. Returns the new report's id + status, or null when
 * unreachable / the session proof is missing (the affordance treats null as
 * "couldn't send — try again"). Any reader (guest or user) may report.
 */
export async function reportContent(input: {
  accountId: string;
  guestTokenHash?: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  details?: string;
}): Promise<{ reportId: string; status: ReportStatus } | null> {
  if (!convexClient) return null;
  return callConvexHttp<{ reportId: string; status: ReportStatus }>(
    "mutation",
    MODERATION_PATHS.reportContent,
    input as unknown as Record<string, unknown>,
  );
}

/**
 * Fetch the admin takedown queue. Returns null when unreachable OR the caller
 * isn't an admin (server refused) — the admin view keeps its gate closed on
 * null. A non-null (possibly empty) array proves the caller is an admin.
 */
export async function getRemoteReportQueue(input: {
  accountId: string;
  guestTokenHash?: string;
  status?: ReportStatus;
  limit?: number;
}): Promise<AdminReportRow[] | null> {
  if (!convexClient) return null;
  const raw = await callConvexHttp<unknown>(
    "query",
    MODERATION_PATHS.listReports,
    input as unknown as Record<string, unknown>,
  );
  return raw === null ? null : adaptReportQueue(raw);
}

/**
 * Resolve or dismiss a report (admin-only), optionally hiding the reported
 * content. Returns the closed status, or null when unreachable / refused.
 */
export async function resolveRemoteReport(input: {
  accountId: string;
  guestTokenHash?: string;
  reportId: string;
  status: "resolved" | "dismissed";
  note?: string;
  hideContent?: boolean;
}): Promise<{ reportId: string; status: "resolved" | "dismissed"; contentHidden: boolean } | null> {
  if (!convexClient) return null;
  return callConvexHttp<{
    reportId: string;
    status: "resolved" | "dismissed";
    contentHidden: boolean;
  }>("mutation", MODERATION_PATHS.resolveReport, input as unknown as Record<string, unknown>);
}
