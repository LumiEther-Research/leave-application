import { connection } from "next/server";
import { LeavePolicyForm } from "@/components/employees/leave-policy-form";
import { AppShell } from "@/components/layout/app-shell";
import { toShellUser } from "@/components/layout/shell-user";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { getEmployees, getLeaveCategories } from "@/lib/store";

export const metadata = { title: "Leave policy" };

export default async function LeavePolicyPage() {
  await connection();
  const user = await requireRole("admin");
  const [categories, employees] = await Promise.all([getLeaveCategories(), getEmployees()]);
  const rows = categories.map((c) => ({ ...c, employees: employees.filter((e) => e.category === c.category).length }));

  return (
    <AppShell user={toShellUser(user)} active="/admin/leave-policy">
      <Card className="max-w-xl [--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle>Leave days per year</CardTitle>
          <CardDescription>
            Choose how many leave days each category gets in a year. Weekends and national holidays aren&apos;t
            deducted, and approved comp-off is added on top. Changes apply to everyone in that category straight away.
            Employees never see these numbers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LeavePolicyForm rows={rows} />
        </CardContent>
      </Card>
    </AppShell>
  );
}
