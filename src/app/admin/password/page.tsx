import { connection } from "next/server";
import { ChangePasswordForm } from "@/components/account/change-password-form";
import { AppShell } from "@/components/layout/app-shell";
import { toShellUser } from "@/components/layout/shell-user";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";

export const metadata = { title: "Change password" };

export default async function ChangePasswordPage() {
  await connection();
  const user = await requireRole("admin");

  return (
    <AppShell user={toShellUser(user)} active="/admin/password">
      <Card className="max-w-lg [--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>
            Choose a new password for your admin account. You&apos;ll stay signed in here; other devices are signed out.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </AppShell>
  );
}
