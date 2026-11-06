import { connection } from "next/server";
import { AppShell } from "@/components/layout/app-shell";
import { toShellUser } from "@/components/layout/shell-user";
import { PayslipList } from "@/components/payslips/payslip-list";
import { requireRole } from "@/lib/auth/session";
import { listPayslipsForEmployee } from "@/lib/payslip/store";

export const metadata = { title: "Payslips" };

export default async function EmployeePayslipsPage() {
  await connection();
  const user = await requireRole("employee");
  const payslips = await listPayslipsForEmployee(user.id);

  return (
    <AppShell user={toShellUser(user)} active="/employee/payslips">
      <PayslipList
        payslips={payslips}
        showEmployee={false}
        title="Your payslips"
        description="Download a payslip for any month it has been generated."
        emptyTitle="No payslips yet"
        emptyDescription="Your payslips will show up here once your admin generates them."
      />
    </AppShell>
  );
}
