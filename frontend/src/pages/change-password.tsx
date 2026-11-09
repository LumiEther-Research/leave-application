import { ChangePasswordForm } from "@/components/account/change-password-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useSessionUser } from "@/lib/session-user";

export function ChangePasswordPage() {
  const user = useSessionUser();
  return (
    <Card className="max-w-lg [--card-spacing:--spacing(6)]">
      <CardHeader>
        <CardTitle>Change password</CardTitle>
        <CardDescription>
          {user.role === "admin"
            ? "Choose a new password for your admin account. You'll stay signed in here; other devices are signed out."
            : "Replace the temporary password your admin gave you. You'll stay signed in here; other devices are signed out."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <ChangePasswordForm />
      </CardContent>
    </Card>
  );
}
