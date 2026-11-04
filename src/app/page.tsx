import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionUser, homeFor } from "@/lib/auth/session";

async function RedirectByRole(): Promise<never> {
  const user = await getSessionUser();
  redirect(user ? homeFor(user.role) : "/login");
}

export default function Home() {
  return (
    <Suspense>
      <RedirectByRole />
    </Suspense>
  );
}
