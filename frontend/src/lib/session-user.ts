import { useRouteLoaderData } from "react-router-dom";
import type { SessionUser } from "@/lib/api";

/** The signed-in user the shell route's loader fetched from /api/auth/me (only one of the two shell routes is ever active). */
export function useSessionUser(): SessionUser {
  const admin = useRouteLoaderData("shell-admin") as SessionUser | undefined;
  const employee = useRouteLoaderData("shell-employee") as SessionUser | undefined;
  return (admin ?? employee) as SessionUser;
}
