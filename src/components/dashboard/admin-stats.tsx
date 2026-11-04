import { CalendarClock, CalendarOff, Flag } from "lucide-react";
import { formatDate } from "@/lib/dates";
import { isCancelRequest } from "@/lib/leave";
import type { LeaveRequest, previousSnapshot } from "@/lib/types";
import { StatGrid } from "./stat-grid";
import type { StatTrend } from "./stat-card";

export type UpcomingHolidayInfo = { name: string; date: Date; daysAway: number };

/** `goodWhen` says which direction of change is good news. */
function trendOf(delta: number, label: string, goodWhen: "up" | "down" | "neutral"): StatTrend {
  if (delta === 0) return { direction: "flat", value: "No change", label, sentiment: "neutral" };
  const direction = delta > 0 ? "up" : "down";
  const sentiment = goodWhen === "neutral" ? "neutral" : goodWhen === direction ? "positive" : "negative";
  return { direction, value: delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`, label, sentiment };
}

export function AdminStats({
  pending,
  outTodayCount,
  teamSize,
  nextHoliday,
  previous,
}: {
  pending: LeaveRequest[];
  outTodayCount: number;
  teamSize: number;
  nextHoliday: UpcomingHolidayInfo;
  previous: typeof previousSnapshot;
}) {
  const compOff = pending.filter((r) => r.type === "Comp-off").length;
  const cancellations = pending.filter(isCancelRequest).length;
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
