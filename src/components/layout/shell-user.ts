import type { SessionUser } from "@/lib/auth/session";
import { initialsOf } from "@/lib/leave";
import type { ShellUser } from "./header";

/** The header's user, from the signed-in session. */
export const toShellUser = (user: SessionUser): ShellUser => ({
  name: user.name,
  initials: initialsOf(user.name),
  role: user.role,
});
