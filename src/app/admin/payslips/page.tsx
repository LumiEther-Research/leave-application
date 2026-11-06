import { connection } from "next/server";
import { AppShell } from "@/components/layout/app-shell";
import { toShellUser } from "@/components/layout/shell-user";
import { GeneratePayslipForm } from "@/components/payslips/generate-payslip-form";
import { PayslipList } from "@/components/payslips/payslip-list";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { getToday, toISODate } from "@/lib/dates";
import { isMonth, monthLabel } from "@/lib/payslip/month";
import { getPayslipEmployees, listPayslipsForMonth } from "@/lib/payslip/store";

export const metadata = { title: "Payslips" };

export default async function AdminPayslipsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await connection();
  const user = await requireRole("admin");
  const { month: requested = "" } = await searchParams;
  const month = isMonth(requested) ? requested : toISODate(getToday()).slice(0, 7);
  const [employees, payslips] = await Promise.all([getPayslipEmployees(), listPayslipsForMonth(`${month}-01`)]);

  return (
    <AppShell user={toShellUser(user)} active="/admin/payslips">
      <div className="grid items-start gap-6 xl:grid-cols-3">
        <Card className="[--card-spacing:--spacing(6)] xl:order-2">
          <CardHeader>
            <CardTitle>Generate a payslip</CardTitle>
            <CardDescription>Pick an employee and a month. The PDF is saved and can be downloaded below.</CardDescription>
          </CardHeader>
          <CardContent>
            <GeneratePayslipForm employees={employees} month={month} />
          </CardContent>
        </Card>
        <div className="xl:order-1 xl:col-span-2">
          <PayslipList
            payslips={payslips}
            showEmployee
            title={`Payslips for ${monthLabel(month)}`}
            description="On the 1st, drafts are made for last month at no LOP. Employees see a payslip only once it is published."
            emptyTitle="No payslips this month"
            emptyDescription="Generate one with the form and it will show up here."
          />
        </div>
      </div>
    </AppShell>
  );
}
