import { useLoaderData } from "react-router-dom";
import { CalendarCheck, CalendarClock } from "lucide-react";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { StatGrid } from "@/components/dashboard/stat-grid";
import { HolidayTimeline } from "@/components/holidays/holiday-timeline";
import { load, type EmployeeDashboard } from "@/lib/api";
import { toUpcoming } from "@/lib/holidays";
import { plural } from "@/lib/plural";

export const employeeDashboardLoader = () => load<EmployeeDashboard>("/api/employee/dashboard", "/admin");

/**
 * What an employee sees is deliberately short: the days of leave they've applied for, their comp-off, and the
 * holidays. Their yearly allowance and remaining days are never shown to them (the backend doesn't send them).
 */
export function EmployeeDashboardPage() {
  const d = useLoaderData() as EmployeeDashboard;
  const stats = [
    {
      label: "Leave applied",
      value: plural(d.applied.total, "day"),
      subtext: `${d.applied.approved} approved · ${d.applied.pending} waiting for approval`,
      icon: CalendarCheck,
      tone: "approved" as const,
    },
    {
      label: "Comp-off",
      value: plural(d.compOff.available, "day"),
      subtext: d.compOff.waiting > 0 ? `${d.compOff.waiting} more waiting for approval` : "Approved and ready to use",
      icon: CalendarClock,
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <DashboardSection title="Your leave" description={`Leave you've applied for in ${d.year}, and your comp-off.`}>
        <StatGrid stats={stats} />
      </DashboardSection>
      <div className="max-w-xl">
        <HolidayTimeline holidays={toUpcoming(d.holidays)} />
      </div>
    </div>
  );
}
