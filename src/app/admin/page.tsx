import { connection } from "next/server";
import { AdminGreeting } from "@/components/dashboard/admin-greeting";
import { AdminStats } from "@/components/dashboard/admin-stats";
import { HolidayTimeline } from "@/components/holidays/holiday-timeline";
import { LeaveBalanceCard } from "@/components/leave/leave-balance-card";
import { LeaveByMonthBars } from "@/components/leave/leave-by-month-bars";
import { PendingRequestsCard } from "@/components/leave/pending-requests-card";
import { WhosOutCard } from "@/components/leave/whos-out-card";
import { AppShell } from "@/components/layout/app-shell";
import { toShellUser } from "@/components/layout/shell-user";
import { requireRole } from "@/lib/auth/session";
import { getHour, getToday } from "@/lib/dates";
import { getUpcomingHolidays } from "@/lib/holidays";
import {
  drawsOnBalance,
  getLeaveBalances,
  getLeaveEntries,
  getMonthlyLeave,
  getOutOn,
  getOutThisWeek,
  getAwaitingDecision,
  getPending,
} from "@/lib/leave";
import { getDashboardData } from "@/lib/store";

export default async function AdminPage() {
  await connection(); // depends on the current date, so render per request
  const user = await requireRole("admin");
  const today = getToday();
  const data = await getDashboardData();

  // Everything below derives from data.requests and data.pastLeaveDays.
  // Waiting on the admin: pending requests plus cancellation requests on approved leave.
  const pending = getAwaitingDecision(data.requests);
  const outToday = getOutOn(data.requests, today);
  const entries = getLeaveEntries(data.requests, data.pastLeaveDays, data.holidays, today.getFullYear());
  const holidays = getUpcomingHolidays(data.holidays, today);

  return (
    <AppShell user={toShellUser(user)} active="/admin">
      <div className="flex flex-col gap-8">
        <AdminGreeting
          name={user.name.split(" ")[0]}
          hour={getHour()}
          today={today}
          pendingCount={pending.length}
          outTodayCount={outToday.length}
        />

        <AdminStats
          pending={pending}
          outTodayCount={outToday.length}
          teamSize={data.employees.length}
          nextHoliday={holidays[0]}
          previous={data.previous}
        />

        <div className="grid gap-6 xl:grid-cols-3">
          <div className="flex flex-col gap-6 xl:col-span-2">
            <PendingRequestsCard pending={pending} employees={data.employees} holidays={data.holidays} />
            <LeaveByMonthBars
              monthly={getMonthlyLeave(entries)}
              year={today.getFullYear()}
              pendingRequestCount={getPending(data.requests).filter(drawsOnBalance).length}
            />
          </div>
          <div className="flex flex-col gap-6">
            <WhosOutCard entries={getOutThisWeek(data.requests, today)} employees={data.employees} today={today} />
            <HolidayTimeline holidays={holidays} />
          </div>
        </div>

        <LeaveBalanceCard
          balances={getLeaveBalances(data.employees, entries, data.requests, data.holidays, today.getFullYear(), today)}
        />
      </div>
    </AppShell>
  );
}
