import { connection } from "next/server";
import { AddEmployeeForm } from "@/components/employees/add-employee-form";
import { EmployeeListCard } from "@/components/employees/employee-list-card";
import { AppShell } from "@/components/layout/app-shell";
import { toShellUser } from "@/components/layout/shell-user";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { getPayslipEmployees } from "@/lib/payslip/store";
import { getEmployees } from "@/lib/store";

export const metadata = { title: "Employees" };

export default async function EmployeesPage() {
  await connection();
  const user = await requireRole("admin");
  const [employees, payroll] = await Promise.all([getEmployees(), getPayslipEmployees()]);

  return (
    <AppShell user={toShellUser(user)} active="/admin/employees">
      <div className="grid items-start gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <EmployeeListCard employees={employees} payroll={payroll} />
        </div>
        <Card className="[--card-spacing:--spacing(6)]">
          <CardHeader>
            <CardTitle>Add an employee</CardTitle>
            <CardDescription>Only admins can create accounts.</CardDescription>
          </CardHeader>
          <CardContent>
            <AddEmployeeForm />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
