import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AppShell } from "@/components/layout/app-shell";
import { toShellUser } from "@/components/layout/shell-user";
import { ClaimCompOffForm } from "@/components/leave/claim-comp-off-form";
import { MyRequestsCard } from "@/components/leave/my-requests-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { getDashboardData } from "@/lib/store";

export const metadata = { title: "Comp-off" };

export default async function CompOffPage() {
  await connection();
  const user = await requireRole("employee");
  const data = await getDashboardData();

  const me = data.employees.find((e) => e.id === user.id);
  if (!me) redirect("/login");

  return (
    <AppShell user={toShellUser(user)} active="/employee/comp-off">
      <div className="grid items-start gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <MyRequestsCard kind="comp-off" requests={data.requests} employee={me} holidays={data.holidays} />
        </div>
        <Card className="[--card-spacing:--spacing(6)]">
          <CardHeader>
            <CardTitle>Request comp-off</CardTitle>
            <CardDescription>
              Working a weekend or a national holiday earns 1 day (half a day for half a day&apos;s work).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ClaimCompOffForm />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
