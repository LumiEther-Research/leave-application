import { redirect, useLoaderData } from "react-router-dom";
import { AddEmployeeForm } from "@/components/employees/add-employee-form";
import { EmployeeListCard } from "@/components/employees/employee-list-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, send, type EmployeeRow } from "@/lib/api";

export async function employeesLoader(): Promise<EmployeeRow[]> {
  const reply = await send("GET", "/api/admin/employees");
  if (reply.status === 401) throw redirect("/login");
  if (reply.status === 403) throw redirect("/employee"); // signed in, but not an admin
  if (reply.status !== 200) throw new ApiError(reply.status, reply.body);
  return (reply.body?.employees as EmployeeRow[] | undefined) ?? [];
}

export function EmployeesPage() {
  const employees = useLoaderData() as EmployeeRow[];
  return (
    <div className="grid items-start gap-6 xl:grid-cols-3">
      <div className="xl:col-span-2">
        <EmployeeListCard employees={employees} />
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
  );
}
