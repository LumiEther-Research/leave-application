import { CircleCheckBig } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { formatDate, formatRange, parseISO } from "@/lib/dates";
import { compOffDaysFor, initialsOf, isCancelRequest, leaveDays, plural } from "@/lib/leave";
import type { Employee, Holiday, LeaveRequest } from "@/lib/types";
import { DecisionButtons } from "./decision-buttons";
import { StatusBadge } from "./status-badge";

export function PendingRequestsCard({
  pending,
  employees,
  holidays,
}: {
  pending: LeaveRequest[];
  employees: Employee[];
  holidays: Holiday[];
}) {
  return (
    <Card className="[--card-spacing:--spacing(6)]">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>Needs your attention</CardTitle>
          {pending.length > 0 && (
            <Badge variant="secondary" className="tabular-nums">
              {pending.length}
            </Badge>
          )}
        </div>
        <CardDescription>Leave, comp-off and cancellation requests waiting for a decision.</CardDescription>
      </CardHeader>
      <CardContent>
        {pending.length === 0 ? (
          <EmptyState
            icon={CircleCheckBig}
            title="You're all caught up"
            description="New leave, comp-off and cancellation requests will show up here for approval."
          />
        ) : (
          <ul className="-my-2 divide-y divide-border">
            {pending.map((r) => {
              const name = employees.find((e) => e.id === r.employeeId)?.name ?? "Unknown";
              const detail =
                r.type === "Comp-off"
                  ? `Worked ${formatDate(parseISO(r.from), "EEE, d MMM yyyy")} · ${plural(compOffDaysFor(r.from, r.halfDay, holidays), "day")}${r.halfDay ? " (half day)" : ""}`
                  : `${formatRange(r.from, r.to)} · ${plural(leaveDays(r, holidays), "day")}${r.halfDay ? " (half day)" : ""}`;
              const cancelling = isCancelRequest(r);
              return (
                <li
                  key={r.id}
                  className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <Avatar>
                      <AvatarFallback className="bg-primary-subtle text-xs font-medium text-primary">
                        {initialsOf(name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{name}</p>
                        <StatusBadge status={cancelling ? "cancelling" : "pending"} />
                      </div>
                      <p className="text-sm text-muted-foreground tabular-nums">
                        {cancelling ? `Cancel ${r.type.toLowerCase()}` : r.type} · {detail}
                      </p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {cancelling ? "Cancellation requested" : "Applied"}{" "}
                        {formatDate(
                          parseISO(cancelling && r.cancelRequestedOn ? r.cancelRequestedOn : r.appliedOn),
                          "d MMM",
                        )}
                      </p>
                    </div>
                  </div>
                  <DecisionButtons
                    requestId={r.id}
                    personName={name}
                    type={cancelling ? "Cancellation" : r.type}
                    detail={detail}
                    rejectLabel={cancelling ? "Keep leave" : "Reject"}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
