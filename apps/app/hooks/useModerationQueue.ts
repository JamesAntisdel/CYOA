import { useCallback, useEffect, useState } from "react";

import {
  getRemoteReportQueue,
  resolveRemoteReport,
  type AdminReportRow,
  type ReportStatus,
} from "../lib/moderationApi";
import { guestAuthArgs, useGuestSession } from "./useGuestSession";

/**
 * Data hook for the admin takedown queue (product-readiness launch blocker:
 * Apple 1.2 / Play UGC). Mirrors the useAdminContent gate trick: the server
 * refuses non-admins, so a non-null result is itself proof of admin.
 *   - "loading"     — first fetch in flight,
 *   - "ready"       — authorized; `reports` holds the (possibly empty) queue,
 *   - "unavailable" — unreachable OR the caller isn't an admin; keep it closed.
 */
export type ModerationStatus = "loading" | "ready" | "unavailable";

export function useModerationQueue(status: ReportStatus = "open"): {
  status: ModerationStatus;
  reports: AdminReportRow[];
  reload: () => void;
  resolving: string | null;
  resolve: (input: {
    reportId: string;
    status: "resolved" | "dismissed";
    hideContent?: boolean;
    note?: string;
  }) => Promise<boolean>;
} {
  const guest = useGuestSession();
  const accountId = guest.session?.accountId ?? null;
  const [state, setState] = useState<ModerationStatus>("loading");
  const [reports, setReports] = useState<AdminReportRow[]>([]);
  const [resolving, setResolving] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!accountId) {
      setState("loading");
      return undefined;
    }
    let cancelled = false;
    setState("loading");
    void getRemoteReportQueue({ accountId, status, ...guestAuthArgs() }).then((result) => {
      if (cancelled) return;
      if (result === null) {
        setState("unavailable");
        return;
      }
      setReports(result);
      setState("ready");
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, status, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const resolve = useCallback(
    async (input: {
      reportId: string;
      status: "resolved" | "dismissed";
      hideContent?: boolean;
      note?: string;
    }): Promise<boolean> => {
      if (!accountId) return false;
      setResolving(input.reportId);
      try {
        const result = await resolveRemoteReport({
          accountId,
          reportId: input.reportId,
          status: input.status,
          ...(input.hideContent !== undefined ? { hideContent: input.hideContent } : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
          ...guestAuthArgs(),
        });
        if (result) {
          // Drop the row locally so the queue reflects the action immediately.
          setReports((prev) => prev.filter((r) => r.reportId !== input.reportId));
          return true;
        }
        return false;
      } finally {
        setResolving(null);
      }
    },
    [accountId],
  );

  return { status: state, reports, reload, resolving, resolve };
}
