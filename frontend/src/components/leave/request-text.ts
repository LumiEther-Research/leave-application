import type { RequestRow } from "@/lib/api";
import { formatDate, formatRange, parseISO } from "@/lib/dates";
import { plural } from "@/lib/plural";

/** "Worked Sat, 31 Oct 2026 · 1 day" for comp-off, "16–18 Nov · 3 days" for leave. */
export function requestDetail(r: RequestRow): string {
  return r.type === "Comp-off"
    ? `Worked ${formatDate(parseISO(r.from), "EEE, d MMM yyyy")} · ${plural(r.days, "day")}${r.halfDay ? " (half day)" : ""}`
    : `${formatRange(r.from, r.to)} · ${plural(r.days, "day")}${r.halfDay ? " (half day)" : ""}`;
}

/** Approved leave with a cancellation waiting for an admin. */
export const isCancelling = (r: RequestRow) => r.status === "approved" && r.cancelRequested;
