import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Brand } from "@/components/layout/brand";
import { RunnerLoader } from "@/components/layout/runner-loader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionUser, homeFor } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

/** Already signed in? Skip the form. Admins land on /admin, employees on /employee. */
async function LoginScreen() {
  const user = await getSessionUser();
  if (user) redirect(homeFor(user.role));
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-4 py-12">
      <Brand height={56} />
      <Card className="w-full max-w-sm [--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle className="text-lg">Sign in</CardTitle>
          <CardDescription>Use the email and password your admin gave you.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<RunnerLoader />}>
      <LoginScreen />
    </Suspense>
  );
}
