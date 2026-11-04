import { connection } from "next/server";
import { AddAdminForm } from "@/components/employees/add-admin-form";
import { AdminListCard } from "@/components/employees/admin-list-card";
import { AppShell } from "@/components/layout/app-shell";
import { toShellUser } from "@/components/layout/shell-user";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { listAdmins } from "@/lib/auth/users";

export const metadata = { title: "Admins" };

export default async function AdminsPage() {
  await connection();
  const user = await requireRole("admin");

  const admins = await listAdmins();

  return (
    <AppShell user={toShellUser(user)} active="/admin/admins">
      <div className="grid items-start gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <AdminListCard admins={admins} currentUserId={user.id} />
        </div>
        <Card className="[--card-spacing:--spacing(6)]">
          <CardHeader>
            <CardTitle>Add an admin</CardTitle>
            <CardDescription>They get the same access as you, including adding more admins.</CardDescription>
          </CardHeader>
          <CardContent>
            <AddAdminForm />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
