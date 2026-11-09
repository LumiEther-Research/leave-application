import { redirect, useLoaderData } from "react-router-dom";
import { AddAdminForm } from "@/components/employees/add-admin-form";
import { AdminListCard } from "@/components/employees/admin-list-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, send, type Admin } from "@/lib/api";
import { useSessionUser } from "@/lib/session-user";

export async function adminsLoader(): Promise<Admin[]> {
  // Loaders run side by side, so this can't wait for the shell's role check: the backend answers for itself.
  const reply = await send("GET", "/api/admin/admins");
  if (reply.status === 401) throw redirect("/login");
  if (reply.status === 403) throw redirect("/employee"); // signed in, but not an admin
  if (reply.status !== 200) throw new ApiError(reply.status, reply.body);
  return (reply.body?.admins as Admin[] | undefined) ?? [];
}

export function AdminsPage() {
  const admins = useLoaderData() as Admin[];
  const user = useSessionUser();
  return (
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
  );
}
