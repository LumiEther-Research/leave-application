import { redirect } from "next/navigation";
import { connection } from "next/server";
import { CalendarCheck, CalendarClock } from "lucide-react";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { StatGrid } from "@/components/dashboard/stat-grid";
import { HolidayTimeline } from "@/components/holidays/holiday-timeline";
import { AppShell } from "@/components/layout/app-shell";
import { toShellUser } from "@/components/layout/shell-user";
import { requireRole } from "@/lib/auth/session";
import { getToday } from "@/lib/dates";
import { getUpcomingHolidays } from "@/lib/holidays";
import { appliedLeaveDays, compOffDaysFor, getLeaveBalances, getLeaveEntries, plural } from "@/lib/leave";
import { getDashboardData } from "@/lib/store";

/**
 * What an employee sees is deliberately short: the days of leave they've applied for, their comp-off, and
 * the holidays. Their yearly allowance and remaining days are never shown to them.
 */
export default async function EmployeePage() {
  await connection(); // depends on the current date, so render per request
  const user = await requireRole("employee");
  const today = getToday();
  const year = today.getFullYear();
  const data = await getDashboardData();

  const me = data.employees.find((e) => e.id === user.id);
  if (!me) redirect("/login"); // the account no longer exists
  const mine = data.requests.filter((r) => r.employeeId === me.id);

  const applied = appliedLeaveDays(mine, data.holidays, year);
  const entries = getLeaveEntries(mine, data.pastLeaveDays, data.holidays, year);
  const [balance] = getLeaveBalances([me], entries, mine, data.holidays, year, today);
  const compOffWaiting = mine
    .filter((r) => r.type === "Comp-off" && r.status === "pending")
    .reduce((n, r) => n + compOffDaysFor(r.from, r.halfDay, data.holidays), 0);

  const stats = [
    {
      label: "Leave applied",
      value: plural(applied.total, "day"),
      subtext: `${applied.approved} approved · ${applied.pending} waiting for approval`,
      icon: CalendarCheck,
      tone: "approved" as const,
    },
    {
      label: "Comp-off",
      value: plural(balance.compOffAvailable, "day"),
      subtext: compOffWaiting > 0 ? `${compOffWaiting} more waiting for approval` : "Approved and ready to use",
      icon: CalendarClock,
    },
  ];

  return (
    <AppShell user={toShellUser(user)} active="/employee">
      <div className="flex flex-col gap-8">
        <DashboardSection title="Your leave" description={`Leave you've applied for in ${year}, and your comp-off.`}>
          <StatGrid stats={stats} />
        </DashboardSection>
        <div className="max-w-xl">
          <HolidayTimeline holidays={getUpcomingHolidays(data.holidays, today)} />
        </div>
      </div>
    </AppShell>
  );
}
