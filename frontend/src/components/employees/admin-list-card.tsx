import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Admin } from "@/lib/api";
import { initialsOf } from "@/lib/initials";
import { plural } from "@/lib/plural";
import { RemoveAdminButton } from "./remove-admin-button";

/** Every admin is equal. You can remove anyone but yourself (the backend enforces this and the last-admin rule too). */
export function AdminListCard({ admins, currentUserId }: { admins: Admin[]; currentUserId: string }) {
  return (
    <Card className="[--card-spacing:--spacing(6)]">
      <CardHeader>
        <CardTitle>Admins</CardTitle>
        <CardDescription>
          {plural(admins.length, "admin")}. Every admin can approve requests and manage employees and other admins.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="-my-2 divide-y divide-border">
          {admins.map((a) => (
            <li key={a.id} className="flex items-center gap-3 py-3">
              <Avatar>
                <AvatarFallback className="bg-primary-subtle text-xs font-medium text-primary">
                  {initialsOf(a.name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{a.name}</span>
                <span className="truncate text-xs text-muted-foreground">{a.email}</span>
              </div>
              {a.id === currentUserId ? (
                <Badge variant="secondary">You</Badge>
              ) : (
                <RemoveAdminButton adminId={a.id} name={a.name} email={a.email} />
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
