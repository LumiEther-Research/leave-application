import { CalendarClock, CalendarDays } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { RequestRow } from "@/lib/api";
import { formatDate, parseISO } from "@/lib/dates";
import { initialsOf } from "@/lib/initials";
import { DecisionButtons } from "./decision-buttons";
import { isCancelling, requestDetail } from "./request-text";
import { StatusBadge } from "./status-badge";

/**
 * Every employee's leave requests, or comp-off claims, newest first, with a decision on whatever is still waiting.
 * The same decisions as the dashboard's "Needs your attention" card, and the same rules behind them.
 */
export function AdminRequestsCard({ kind, requests }: { kind: "leave" | "comp-off"; requests: RequestRow[] }) {
  const isLeave = kind === "leave";
  const waiting = requests.filter((r) => r.status === "pending" || isCancelling(r)).length;
  return (
    <Card className="[--card-spacing:--spacing(6)]">
      <CardHeader>
        <CardTitle>{isLeave ? "Leave requests" : "Comp-off requests"}</CardTitle>
        <CardDescription className="tabular-nums">
          {isLeave
            ? "Everyone's casual and sick leave. Approve or reject what is waiting; an employee's cancellation of approved leave also needs your approval."
            : "Everyone's comp-off claims. An approved claim is added to that employee's balance until their joining anniversary."}
          {requests.length > 0 && ` ${waiting} waiting for a decision.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {requests.length === 0 ? (
          <EmptyState
            icon={isLeave ? CalendarDays : CalendarClock}
            title={isLeave ? "No leave requests yet" : "No comp-off requests yet"}
            description={isLeave ? "Leave your team requests will show up here." : "Comp-off your team claims will show up here."}
          />
        ) : (
          <ul className="-my-2 divide-y divide-border">
            {requests.map((r) => {
              const cancelling = isCancelling(r);
              const detail = requestDetail(r);
              const needsDecision = r.status === "pending" || cancelling;
              return (
                <li key={r.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                  <div className="flex min-w-0 items-start gap-3">
                    <Avatar>
                      <AvatarFallback className="bg-primary-subtle text-xs font-medium text-primary">{initialsOf(r.employeeName)}</AvatarFallback>
                    </Avatar>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{r.employeeName}</p>
                        <StatusBadge status={cancelling ? "cancelling" : r.status} />
                      </div>
                      <p className="text-sm text-muted-foreground tabular-nums">
                        {cancelling ? `Cancel ${r.type.toLowerCase()}` : r.type} · {detail}
                      </p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {cancelling ? "Cancellation requested" : "Applied"}{" "}
                        {formatDate(parseISO(cancelling && r.cancelRequestedOn ? r.cancelRequestedOn : r.appliedOn), "d MMM")}
                      </p>
                    </div>
                  </div>
                  {needsDecision && (
                    <DecisionButtons
                      requestId={r.id}
                      personName={r.employeeName}
                      type={cancelling ? "Cancellation" : r.type}
                      detail={detail}
                      rejectLabel={cancelling ? "Keep leave" : "Reject"}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
