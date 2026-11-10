import { Clock } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PermissionRow } from "@/lib/api";
import { formatDate, parseISO } from "@/lib/dates";
import { formatMinutes } from "@/lib/minutes";

/** Permissions, newest first. The admin's copy shows whose each one is. */
export function PermissionsCard({
  permissions,
  showEmployee,
  title,
  description,
}: {
  permissions: PermissionRow[];
  showEmployee: boolean;
  title: string;
  description: string;
}) {
  const hours = formatMinutes(permissions.reduce((n, p) => n + p.minutes, 0));

  return (
    <Card className="[--card-spacing:--spacing(6)]">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription className="tabular-nums">
          {description}
          {permissions.length > 0 && ` ${permissions.length} so far, ${hours} in total.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {permissions.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="No permissions yet"
            description={showEmployee ? "Permissions your team notes will show up here." : "When you take a few hours off, note it with the form."}
          />
        ) : (
          <>
            {/* Desktop: table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    {showEmployee && <TableHead className="h-11">Employee</TableHead>}
                    <TableHead className="h-11">Day</TableHead>
                    <TableHead className="h-11">Time</TableHead>
                    <TableHead className="h-11">Length</TableHead>
                    <TableHead className="h-11">Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {permissions.map((p) => (
                    <TableRow key={p.id}>
                      {showEmployee && <TableCell className="py-3 font-medium">{p.employeeName}</TableCell>}
                      <TableCell className="py-3 tabular-nums">{formatDate(parseISO(p.date), "EEE, d MMM yyyy")}</TableCell>
                      <TableCell className="py-3 text-muted-foreground tabular-nums">
                        {p.from}–{p.to}
                      </TableCell>
                      <TableCell className="py-3 tabular-nums">{formatMinutes(p.minutes)}</TableCell>
                      <TableCell className="py-3 text-muted-foreground">{p.reason || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile: stacked cards */}
            <ul className="flex flex-col gap-3 md:hidden">
              {permissions.map((p) => (
                <li key={p.id} className="flex flex-col gap-1 rounded-lg border border-border p-4">
                  <p className="text-sm font-medium">{showEmployee ? p.employeeName : formatDate(parseISO(p.date), "EEE, d MMM yyyy")}</p>
                  <p className="text-sm text-muted-foreground tabular-nums">
                    {showEmployee && `${formatDate(parseISO(p.date), "EEE, d MMM yyyy")} · `}
                    {p.from}–{p.to} · {formatMinutes(p.minutes)}
                  </p>
                  {p.reason && <p className="text-xs text-muted-foreground">{p.reason}</p>}
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
