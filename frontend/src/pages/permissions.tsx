import { useLoaderData } from "react-router-dom";
import { LogPermissionForm } from "@/components/leave/log-permission-form";
import { PermissionsCard } from "@/components/leave/permissions-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { load, type PermissionRow } from "@/lib/api";

type Loaded = { permissions: PermissionRow[] };

export const adminPermissionsLoader = () => load<Loaded>("/api/admin/permissions", "/employee");
export const myPermissionsLoader = () => load<Loaded>("/api/employee/permissions", "/admin");

export function AdminPermissionsPage() {
  const { permissions } = useLoaderData() as Loaded;
  return (
    <PermissionsCard
      permissions={permissions}
      showEmployee
      title="Permissions"
      description="Short absences your team has noted. They aren't taken from leave."
    />
  );
}

export function MyPermissionsPage() {
  const { permissions } = useLoaderData() as Loaded;
  return (
    <div className="grid items-start gap-6 xl:grid-cols-3">
      <div className="xl:col-span-2">
        <PermissionsCard permissions={permissions} showEmployee={false} title="Your permissions" description="Time you took off for an hour or two." />
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
  );
}
