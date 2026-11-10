import { CalendarDays, CalendarPlus } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RequestRow } from "@/lib/api";
import { formatDate, formatRange, parseISO } from "@/lib/dates";
import { plural } from "@/lib/plural";
import { CancelLeaveButton } from "./cancel-leave-button";
import { StatusBadge, type LeaveStatus } from "./status-badge";

type Row = {
  id: string;
  title: string;
  detail: string;
  note: string;
  status: LeaveStatus;
  /** set when the employee can still cancel this leave */
  cancel?: { action: "withdraw" | "request"; dates: string };
};

/** The employee's own requests, newest first (the backend sorts them). Leave and comp-off share one card. */
export function MyRequestsCard({ kind, requests }: { kind: "leave" | "comp-off"; requests: RequestRow[] }) {
  const rows: Row[] = requests.map((r) => {
    const applied = `Applied ${formatDate(parseISO(r.appliedOn), "d MMM")}`;
    if (kind === "leave") {
      return {
        id: r.id,
        status: r.status === "approved" && r.cancelRequested ? "cancelling" : r.status,
        cancel: r.cancel ? { action: r.cancel, dates: formatRange(r.from, r.to) } : undefined,
        title: r.type,
        detail: `${formatRange(r.from, r.to)} · ${plural(r.days, "day")}${r.halfDay ? " (half day)" : ""}`,
        note: applied,
      };
    }
    return {
      id: r.id,
      title: `Worked ${formatDate(parseISO(r.from), "EEE, d MMM yyyy")}`,
      detail: `${plural(r.days, "day")}${r.halfDay ? " (half day)" : ""}`,
      note: r.status === "rejected" || !r.expiresOn ? applied : `${applied} · expires ${formatDate(parseISO(r.expiresOn), "d MMM yyyy")}`,
      status: r.status,
    };
  });

  const isLeave = kind === "leave";
  return (
    <Card className="[--card-spacing:--spacing(6)]">
      <CardHeader>
        <CardTitle>{isLeave ? "Your leave requests" : "Your comp-off requests"}</CardTitle>
        <CardDescription>
          {isLeave
            ? "Requests stay pending until an admin approves or rejects them. Approved leave that hasn't started can be cancelled with an admin's approval."
            : "Comp-off counts toward your balance once an admin approves it."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState
            icon={isLeave ? CalendarDays : CalendarPlus}
            title={isLeave ? "No leave requests yet" : "No comp-off requests yet"}
            description={
              isLeave
                ? "Use the form to request casual or sick leave. It shows up here."
                : "Worked a weekend or a national holiday? Request comp-off with the form."
            }
          />
        ) : (
          <>
            {/* Desktop: table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-11">{isLeave ? "Type" : "Day worked"}</TableHead>
                    <TableHead className="h-11">{isLeave ? "Dates" : "Earns"}</TableHead>
                    <TableHead className="h-11">Applied</TableHead>
                    <TableHead className="h-11 text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="py-3 font-medium">{r.title}</TableCell>
                      <TableCell className="py-3 text-muted-foreground tabular-nums">{r.detail}</TableCell>
                      <TableCell className="py-3 text-muted-foreground tabular-nums">{r.note}</TableCell>
                      <TableCell className="py-3">
                        <div className="flex items-center justify-end gap-3">
                          {r.cancel && <CancelLeaveButton requestId={r.id} {...r.cancel} />}
                          <StatusBadge status={r.status} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile: stacked cards */}
            <ul className="flex flex-col gap-3 md:hidden">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-col gap-1.5 rounded-lg border border-border p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{r.title}</p>
                    <StatusBadge status={r.status} />
                  </div>
                  <p className="text-sm text-muted-foreground tabular-nums">{r.detail}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">{r.note}</p>
                  {r.cancel && (
                    <div className="pt-1">
                      <CancelLeaveButton requestId={r.id} {...r.cancel} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
