import { connection } from "next/server";
import { AppShell } from "@/components/layout/app-shell";
import { toShellUser } from "@/components/layout/shell-user";
import { LogPermissionForm } from "@/components/leave/log-permission-form";
import { PermissionsCard } from "@/components/leave/permissions-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { getPermissions } from "@/lib/store";

export const metadata = { title: "Permissions" };

export default async function PermissionsPage() {
  await connection();
  const user = await requireRole("employee");
  const permissions = await getPermissions(user.id);

  return (
    <AppShell user={toShellUser(user)} active="/employee/permissions">
      <div className="grid items-start gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <PermissionsCard
            permissions={permissions}
            showEmployee={false}
            title="Your permissions"
            description="Time you took off for an hour or two."
          />
        </div>
        <Card className="[--card-spacing:--spacing(6)]">
          <CardHeader>
            <CardTitle>Note a permission</CardTitle>
            <CardDescription>For a few hours off on one working day.</CardDescription>
          </CardHeader>
          <CardContent>
            <LogPermissionForm />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
