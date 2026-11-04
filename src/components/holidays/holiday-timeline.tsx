import { formatDate } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { UpcomingHoliday } from "@/lib/holidays";

export function HolidayTimeline({ holidays }: { holidays: UpcomingHoliday[] }) {
  return (
    <Card className="[--card-spacing:--spacing(6)]">
      <CardHeader>
        <CardTitle>Upcoming holidays</CardTitle>
        <CardDescription>National holidays, soonest first.</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="relative flex flex-col gap-1">
          <span aria-hidden className="absolute top-4 bottom-4 left-3 w-px -translate-x-1/2 bg-border" />
          {holidays.map((h, i) => {
            const next = i === 0;
            return (
              <li key={h.name} className="relative flex items-start gap-3">
                <div className="relative z-10 flex h-9 w-6 shrink-0 items-center justify-center bg-card">
                  <span
                    aria-hidden
                    className={cn(
                      "rounded-full",
                      next ? "size-3 bg-primary ring-4 ring-primary-subtle" : "size-2 bg-border"
                    )}
                  />
                </div>
                <div
                  className={cn(
                    "flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg px-3 py-2",
                    next && "bg-primary-subtle"
                  )}
                >
                  <div className="flex min-w-0 flex-col">
                    <p className={cn("text-sm font-medium", next && "text-primary")}>{h.name}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">{formatDate(h.date, "EEE, d MMM yyyy")}</p>
                  </div>
                  {next ? (
                    <Badge className="tabular-nums">Next · {h.daysAway} days</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground tabular-nums">in {h.daysAway} days</span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
