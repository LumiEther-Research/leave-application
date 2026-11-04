import { Users } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, parseISO } from "@/lib/dates";
import { initialsOf, plural } from "@/lib/leave";
import type { Employee } from "@/lib/types";
import { CategorySelect } from "./category-select";

function Person({ employee }: { employee: Employee }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar>
        <AvatarFallback className="bg-primary-subtle text-xs font-medium text-primary">
          {initialsOf(employee.name)}
        </AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{employee.name}</span>
        <span className="truncate text-xs text-muted-foreground">{employee.email}</span>
      </div>
    </div>
  );
}

export function EmployeeListCard({ employees }: { employees: Employee[] }) {
  return (
    <Card className="[--card-spacing:--spacing(6)]">
      <CardHeader>
        <CardTitle>Employees</CardTitle>
        <CardDescription>
          {plural(employees.length, "employee")}. Each signs in with their Gmail address.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {employees.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No employees yet"
            description="Add your first employee with the form. They can sign in as soon as you do."
          />
        ) : (
          <>
            {/* Desktop: table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-11">Employee</TableHead>
                    <TableHead className="h-11">Category</TableHead>
                    <TableHead className="h-11 text-right">Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employees.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="py-3">
                        <Person employee={e} />
                      </TableCell>
                      <TableCell className="py-3">
                        <CategorySelect employeeId={e.id} name={e.name} value={e.category} />
                      </TableCell>
                      <TableCell className="py-3 text-right text-muted-foreground tabular-nums">
                        {formatDate(parseISO(e.joiningDate), "d MMM yyyy")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile: stacked cards */}
            <ul className="flex flex-col gap-3 md:hidden">
              {employees.map((e) => (
                <li key={e.id} className="flex flex-col gap-2 rounded-lg border border-border p-4">
                  <Person employee={e} />
                  <p className="text-xs text-muted-foreground tabular-nums">
                    Joined {formatDate(parseISO(e.joiningDate), "d MMM yyyy")}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
