import { useLoaderData } from "react-router-dom";
import { AdminGreeting } from "@/components/dashboard/admin-greeting";
import { AdminStats } from "@/components/dashboard/admin-stats";
import { HolidayTimeline } from "@/components/holidays/holiday-timeline";
import { LeaveBalanceCard } from "@/components/leave/leave-balance-card";
import { LeaveByMonthBars } from "@/components/leave/leave-by-month-bars";
import { PendingRequestsCard } from "@/components/leave/pending-requests-card";
import { WhosOutCard } from "@/components/leave/whos-out-card";
import { load, type AdminDashboard } from "@/lib/api";
import { parseISO } from "@/lib/dates";
import { toUpcoming } from "@/lib/holidays";
import { useSessionUser } from "@/lib/session-user";

export const adminDashboardLoader = () => load<AdminDashboard>("/api/admin/dashboard", "/employee");

export function AdminDashboardPage() {
  const d = useLoaderData() as AdminDashboard;
  const user = useSessionUser();
  const today = parseISO(d.today);
  const holidays = toUpcoming(d.holidays);

  return (
    <div className="flex flex-col gap-8">
      <AdminGreeting name={user.name.split(" ")[0]} hour={d.hour} today={today} pendingCount={d.pending.length} outTodayCount={d.outTodayCount} />

      <AdminStats pending={d.pending} outTodayCount={d.outTodayCount} teamSize={d.teamSize} nextHoliday={holidays[0]} />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="flex flex-col gap-6 xl:col-span-2">
          <PendingRequestsCard pending={d.pending} />
          <LeaveByMonthBars monthly={d.monthly} year={d.year} pendingRequestCount={d.pendingLeaveCount} />
        </div>
        <div className="flex flex-col gap-6">
          <WhosOutCard entries={d.outThisWeek} today={today} />
          <HolidayTimeline holidays={holidays} />
        </div>
      </div>

      <LeaveBalanceCard balances={d.balances} />
    </div>
  );
}
