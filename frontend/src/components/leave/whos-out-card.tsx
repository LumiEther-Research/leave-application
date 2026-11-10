import { PartyPopper } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { RequestRow } from "@/lib/api";
import { endOfWeek, formatDate, formatRange, isWithinInterval, parseISO, startOfWeek } from "@/lib/dates";
import { initialsOf } from "@/lib/initials";

export function WhosOutCard({ entries, today }: { entries: RequestRow[]; today: Date }) {
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
              const outToday = isWithinInterval(today, { start: parseISO(e.from), end: parseISO(e.to) });
              return (
                <li key={e.id} className="flex items-center gap-3">
                  <Avatar>
                    <AvatarFallback className="bg-primary-subtle text-xs font-medium text-primary">{initialsOf(e.employeeName)}</AvatarFallback>
                  </Avatar>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <p className="truncate text-sm font-medium">{e.employeeName}</p>
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
