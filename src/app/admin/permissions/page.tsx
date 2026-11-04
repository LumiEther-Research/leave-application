import { connection } from "next/server";
import { AppShell } from "@/components/layout/app-shell";
import { toShellUser } from "@/components/layout/shell-user";
import { PermissionsCard } from "@/components/leave/permissions-card";
import { requireRole } from "@/lib/auth/session";
import { getPermissions } from "@/lib/store";

export const metadata = { title: "Permissions" };

export default async function AdminPermissionsPage() {
  await connection();
  const user = await requireRole("admin");
  const permissions = await getPermissions();

  return (
    <AppShell user={toShellUser(user)} active="/admin/permissions">
      <PermissionsCard
        permissions={permissions}
        showEmployee
        title="Permissions"
        description="Short absences your team has noted. They aren't taken from leave."
      />
    </AppShell>
  );
}
