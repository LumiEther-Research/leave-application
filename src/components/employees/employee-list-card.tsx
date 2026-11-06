import { Users } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, parseISO } from "@/lib/dates";
import { formatInr, toPlain } from "@/lib/payslip/money";
import type { PayslipEmployee } from "@/lib/payslip/store";
import { initialsOf, plural } from "@/lib/leave";
import type { Employee } from "@/lib/types";
import { CategorySelect } from "./category-select";
import { EditPayrollButton } from "./edit-payroll-button";
import { RemoveEmployeeButton } from "./remove-employee-button";

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

function RowActions({ employee, payroll }: { employee: Employee; payroll?: PayslipEmployee }) {
  return (
    <div className="flex items-center gap-2">
      <PayrollEdit employee={employee} payroll={payroll} />
      <RemoveEmployeeButton employeeId={employee.id} name={employee.name} email={employee.email} />
    </div>
  );
}

function PayrollEdit({ employee, payroll }: { employee: Employee; payroll?: PayslipEmployee }) {
  return (
    <EditPayrollButton
      employeeId={employee.id}
      name={employee.name}
      monthlySalary={payroll?.monthlySalary == null ? "" : toPlain(payroll.monthlySalary)}
      designation={payroll?.designation ?? ""}
    />
  );
}

/** `payroll` is each employee's salary and designation, which only admins see. */
export function EmployeeListCard({ employees, payroll }: { employees: Employee[]; payroll: PayslipEmployee[] }) {
  const payrollOf = (id: string) => payroll.find((p) => p.id === id);
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
                    <TableHead className="h-11">Designation</TableHead>
                    <TableHead className="h-11 text-right">Monthly salary</TableHead>
                    <TableHead className="h-11 text-right">Joined</TableHead>
                    <TableHead className="h-11 text-right"><span className="sr-only">Actions</span></TableHead>
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
                      <TableCell className="py-3 text-muted-foreground">
                        {payrollOf(e.id)?.designation || "—"}
                      </TableCell>
                      <TableCell className="py-3 text-right tabular-nums">
                        {payrollOf(e.id)?.monthlySalary == null ? "—" : formatInr(payrollOf(e.id)!.monthlySalary!)}
                      </TableCell>
                      <TableCell className="py-3 text-right text-muted-foreground tabular-nums">
                        {formatDate(parseISO(e.joiningDate), "d MMM yyyy")}
                      </TableCell>
                      <TableCell className="py-3">
                        <div className="flex justify-end">
                          <RowActions employee={e} payroll={payrollOf(e.id)} />
                        </div>
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
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {payrollOf(e.id)?.designation || "No designation"} ·{" "}
                    {payrollOf(e.id)?.monthlySalary == null ? "No salary set" : formatInr(payrollOf(e.id)!.monthlySalary!)}
                  </p>
                  <RowActions employee={e} payroll={payrollOf(e.id)} />
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
