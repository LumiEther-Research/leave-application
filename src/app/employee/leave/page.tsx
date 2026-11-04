import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AppShell } from "@/components/layout/app-shell";
import { toShellUser } from "@/components/layout/shell-user";
import { ApplyLeaveForm } from "@/components/leave/apply-leave-form";
import { MyRequestsCard } from "@/components/leave/my-requests-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { getDashboardData } from "@/lib/store";

export const metadata = { title: "My leave" };

export default async function MyLeavePage() {
  await connection();
  const user = await requireRole("employee");
  const data = await getDashboardData();

  const me = data.employees.find((e) => e.id === user.id);
  if (!me) redirect("/login");

  return (
    <AppShell user={toShellUser(user)} active="/employee/leave">
      <div className="grid items-start gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <MyRequestsCard kind="leave" requests={data.requests} employee={me} holidays={data.holidays} />
        </div>
        <Card className="[--card-spacing:--spacing(6)]">
          <CardHeader>
            <CardTitle>Request leave</CardTitle>
            <CardDescription>Casual or sick leave, for a full day, several days or a half day.</CardDescription>
          </CardHeader>
          <CardContent>
            <ApplyLeaveForm />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
