import { CalendarClock, CalendarOff, Flag } from "lucide-react";
import type { RequestRow } from "@/lib/api";
import { formatDate } from "@/lib/dates";
import type { UpcomingHoliday } from "@/lib/holidays";
import { isCancelling } from "@/components/leave/request-text";
import { StatGrid } from "./stat-grid";
import type { StatTrend } from "./stat-card";

/** `goodWhen` says which direction of change is good news. */
function trendOf(delta: number, label: string, goodWhen: "up" | "down" | "neutral"): StatTrend {
  if (delta === 0) return { direction: "flat", value: "No change", label, sentiment: "neutral" };
  const direction = delta > 0 ? "up" : "down";
  const sentiment = goodWhen === "neutral" ? "neutral" : goodWhen === direction ? "positive" : "negative";
  return { direction, value: delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`, label, sentiment };
}

/** Earlier snapshots for the trend lines. There is no history yet, so both are 0, as in the current app. */
const previous = { pendingRequests: 0, peopleOutToday: 0 };

export function AdminStats({
  pending,
  outTodayCount,
  teamSize,
  nextHoliday,
}: {
  pending: RequestRow[];
  outTodayCount: number;
  teamSize: number;
  nextHoliday: UpcomingHoliday;
}) {
  const compOff = pending.filter((r) => r.type === "Comp-off").length;
  const cancellations = pending.filter(isCancelling).length;
  const leave = pending.length - compOff - cancellations;

  return (
    <StatGrid
      stats={[
        {
          label: "Pending requests",
          value: pending.length,
          subtext: `${leave} leave · ${compOff} comp-off${cancellations > 0 ? ` · ${cancellations} cancellation${cancellations === 1 ? "" : "s"}` : ""}`,
          icon: CalendarClock,
          tone: "pending",
          trend: trendOf(pending.length - previous.pendingRequests, "vs last week", "down"),
        },
        {
          label: "On leave today",
          value: outTodayCount,
          subtext: `of ${teamSize} employees`,
          icon: CalendarOff,
          tone: "approved",
          trend: trendOf(outTodayCount - previous.peopleOutToday, "vs yesterday", "neutral"),
        },
        {
          label: "Next holiday",
          value: `${nextHoliday.daysAway} days`,
          subtext: `${nextHoliday.name} · ${formatDate(nextHoliday.date, "d MMM yyyy")}`,
          icon: Flag,
        },
      ]}
    />
  );
}
