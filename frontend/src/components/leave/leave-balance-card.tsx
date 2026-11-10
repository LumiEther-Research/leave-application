import { Link } from "react-router-dom";
import { Users } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { BalanceRow } from "@/lib/api";
import { categoryLabel, type Category } from "@/lib/categories";
import { initialsOf } from "@/lib/initials";

const pct = (used: number, total: number) => (total === 0 ? 0 : Math.min(100, Math.round((used / total) * 100)));

function PersonCell({ name, role }: { name: string; role: string }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar>
        <AvatarFallback className="bg-primary-subtle text-xs font-medium text-primary">
          {initialsOf(name)}
        </AvatarFallback>
      </Avatar>
      <div className="flex flex-col">
        <span className="text-sm font-medium">{name}</span>
        <span className="text-xs text-muted-foreground capitalize">{role}</span>
      </div>
    </div>
  );
}

/** "incl. 1.5 comp-off" and, if any lapsed, "1 expired". */
function compOffNote(available: number, expired: number) {
  return [available > 0 && `incl. ${available} comp-off`, expired > 0 && `${expired} expired`]
    .filter(Boolean)
    .join(" · ");
}

function Remaining({ remaining, available, expired }: { remaining: number; available: number; expired: number }) {
  const note = compOffNote(available, expired);
  return (
    <div className="flex flex-col items-end">
      <span className="font-medium tabular-nums">{remaining}</span>
      {note && <span className="text-xs font-normal text-muted-foreground">{note}</span>}
    </div>
  );
}

function UsageBar({ used, total, name }: { used: number; total: number; name: string }) {
  const value = pct(used, total);
  return (
    <div className="flex items-center gap-3">
      <div
        role="progressbar"
        aria-label={`${name}: ${used} of ${total} leave days used`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-200"
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">{value}%</span>
    </div>
  );
}

export function LeaveBalanceCard({ balances }: { balances: BalanceRow[] }) {
  const totals = balances.reduce(
    (t, b) => ({
      total: t.total + b.total,
      casual: t.casual + b.casual,
      sick: t.sick + b.sick,
      used: t.used + b.used,
      remaining: t.remaining + b.remaining,
      compOffAvailable: t.compOffAvailable + b.compOffAvailable,
      compOffExpired: t.compOffExpired + b.compOffExpired,
    }),
    { total: 0, casual: 0, sick: 0, used: 0, remaining: 0, compOffAvailable: 0, compOffExpired: 0 },
  );

  return (
    <Card className="[--card-spacing:--spacing(6)]">
      <CardHeader>
        <CardTitle>Leave balance</CardTitle>
        <CardDescription>
          Each employee gets the yearly days set for their category, plus approved comp-off. Weekends and national
          holidays are not deducted. Casual and sick both count, and leave uses the soonest-expiring comp-off first.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {balances.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No employees yet"
            description="Balances show up here once you add your first employee."
            action={
              <Link to="/admin/employees" className={buttonVariants()}>
                Add an employee
              </Link>
            }
          />
        ) : (
          <>
            {/* Desktop: table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-11">Employee</TableHead>
                    <TableHead className="h-11 text-right">Total</TableHead>
                    <TableHead className="h-11 text-right">Casual</TableHead>
                    <TableHead className="h-11 text-right">Sick</TableHead>
                    <TableHead className="h-11 text-right">Used</TableHead>
                    <TableHead className="h-11 text-right">Leave remaining</TableHead>
                    <TableHead className="h-11 w-48 pl-6">Usage</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {balances.map(
                    ({ employeeId, name, category, total, casual, sick, used, remaining, compOffAvailable, compOffExpired }) => (
                      <TableRow key={employeeId}>
                        <TableCell className="py-3">
                          <PersonCell name={name} role={categoryLabel[category as Category]} />
                        </TableCell>
                        <TableCell className="py-3 text-right tabular-nums">{total}</TableCell>
                        <TableCell className="py-3 text-right tabular-nums">{casual}</TableCell>
                        <TableCell className="py-3 text-right tabular-nums">{sick}</TableCell>
                        <TableCell className="py-3 text-right tabular-nums">{used}</TableCell>
                        <TableCell className="py-3 text-right">
                          <Remaining remaining={remaining} available={compOffAvailable} expired={compOffExpired} />
                        </TableCell>
                        <TableCell className="py-3 pl-6">
                          <UsageBar used={used} total={total} name={name} />
                        </TableCell>
                      </TableRow>
                    ),
                  )}
                </TableBody>
                <TableFooter>
                  <TableRow className="hover:bg-transparent">
                    <TableCell className="py-3 font-medium">Team total</TableCell>
                    <TableCell className="py-3 text-right tabular-nums">{totals.total}</TableCell>
                    <TableCell className="py-3 text-right tabular-nums">{totals.casual}</TableCell>
                    <TableCell className="py-3 text-right tabular-nums">{totals.sick}</TableCell>
                    <TableCell className="py-3 text-right font-medium tabular-nums">{totals.used}</TableCell>
                    <TableCell className="py-3 text-right">
                      <Remaining
                        remaining={totals.remaining}
                        available={totals.compOffAvailable}
                        expired={totals.compOffExpired}
                      />
                    </TableCell>
                    <TableCell className="py-3 pl-6">
                      <UsageBar used={totals.used} total={totals.total} name="Team" />
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>

            {/* Mobile: stacked cards */}
            <ul className="flex flex-col gap-3 md:hidden">
              {balances.map(({ employeeId, name, category, total, casual, sick, used, remaining, compOffAvailable, compOffExpired }) => (
                <li key={employeeId} className="flex flex-col gap-3 rounded-lg border border-border p-4">
                  <PersonCell name={name} role={categoryLabel[category as Category]} />
                  <UsageBar used={used} total={total} name={name} />
                  <dl className="grid grid-cols-3 gap-x-2 gap-y-3 text-xs text-muted-foreground">
                    {[
                      ["Total", total],
                      ["Casual", casual],
                      ["Sick", sick],
                      ["Used", used],
                      ["Leave remaining", remaining],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd className="text-sm font-medium text-foreground tabular-nums">{value}</dd>
                      </div>
                    ))}
                    {compOffNote(compOffAvailable, compOffExpired) && (
                      <p className="col-span-3 text-xs">{compOffNote(compOffAvailable, compOffExpired)}</p>
                    )}
                  </dl>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
