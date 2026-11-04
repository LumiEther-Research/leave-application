import { PartyPopper } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { endOfWeek, formatDate, formatRange, isWithinInterval, parseISO, startOfWeek } from "@/lib/dates";
import { initialsOf } from "@/lib/leave";
import type { Employee, LeaveRequest } from "@/lib/types";

export function WhosOutCard({
  entries,
  employees,
  today,
}: {
  entries: LeaveRequest[];
  employees: Employee[];
  today: Date;
}) {
  const weekStart = startOfWeek(today);
  const weekEnd = endOfWeek(today);

  return (
    <Card className="[--card-spacing:--spacing(6)]">
      <CardHeader>
        <CardTitle>Who&apos;s out this week</CardTitle>
        <CardDescription className="tabular-nums">
          {formatDate(weekStart, "d MMM")} – {formatDate(weekEnd, "d MMM")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <EmptyState icon={PartyPopper} title="Everyone's in" description="Nobody is on leave this week." />
        ) : (
          <ul className="flex flex-col gap-4">
            {entries.map((e) => {
              const name = employees.find((p) => p.id === e.employeeId)?.name ?? "Unknown";
              const outToday = isWithinInterval(today, { start: parseISO(e.from), end: parseISO(e.to) });
              return (
                <li key={e.id} className="flex items-center gap-3">
                  <Avatar>
                    <AvatarFallback className="bg-primary-subtle text-xs font-medium text-primary">
                      {initialsOf(name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <p className="truncate text-sm font-medium">{name}</p>
                    <p className="text-xs text-muted-foreground">
                      {e.type}
                      {e.halfDay && " · half day"}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <p className="text-xs text-muted-foreground tabular-nums">{formatRange(e.from, e.to)}</p>
                    {outToday && <Badge variant="secondary">Out today</Badge>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
