import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { plural, type MonthlyLeave } from "@/lib/leave";

/** A bar list drawn with divs: one row per month, approved then pending. */
export function LeaveByMonthBars({
  monthly,
  year,
  pendingRequestCount,
}: {
  monthly: MonthlyLeave[];
  year: number;
  /** pending leave requests feeding the pending shade */
  pendingRequestCount: number;
}) {
  const totalApproved = monthly.reduce((n, m) => n + m.approved, 0);
  const scale = Math.max(1, ...monthly.map((m) => m.approved + m.pending));

  return (
    <Card className="[--card-spacing:--spacing(6)]">
      <CardHeader>
        <CardTitle>Leave by month</CardTitle>
        <CardDescription>Team leave days in {year}, excluding comp-off and national holidays.</CardDescription>
        <CardAction>
          <p className="text-right text-sm text-muted-foreground tabular-nums">
            <span className="text-base font-semibold text-foreground">{totalApproved}</span> days approved
          </p>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <ul className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Legend">
          <li className="flex items-center gap-2 text-sm">
            <span aria-hidden className="size-3 rounded-[3px] bg-chart-1" />
            <span className="font-medium">Approved</span>
            <span className="text-muted-foreground">Leave already granted</span>
          </li>
          <li className="flex items-center gap-2 text-sm">
            <span aria-hidden className="size-3 rounded-[3px] bg-chart-3" />
            <span className="font-medium">Pending</span>
            <span className="text-muted-foreground">
              {pendingRequestCount > 0
                ? `From ${plural(pendingRequestCount, "pending leave request")}`
                : "No pending leave requests"}
            </span>
          </li>
        </ul>

        <ul className="flex flex-col gap-2.5">
          {monthly.map(({ month, approved, pending }) => (
            <li key={month} className="grid grid-cols-[2rem_1fr_5.5rem] items-center gap-3 text-sm">
              <span className="text-muted-foreground">{month}</span>
              <div aria-hidden className="flex h-2.5 overflow-hidden rounded-full bg-muted">
                <div className="bg-chart-1" style={{ width: `${(approved / scale) * 100}%` }} />
                <div className="bg-chart-3" style={{ width: `${(pending / scale) * 100}%` }} />
              </div>
              <span className="text-right tabular-nums">
                <span className="font-medium">{approved}</span>
                {pending > 0 && <span className="ml-1 text-xs text-muted-foreground">+{pending}</span>}
                <span className="sr-only"> days approved{pending > 0 ? `, ${pending} pending` : ""}</span>
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
