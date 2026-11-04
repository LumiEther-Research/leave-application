"use server";

import { redirect } from "next/navigation";
import { changePassword, type PasswordChangeErrors } from "@/lib/auth/change-password";
import { getSessionUser, startSession } from "@/lib/auth/session";

export type ChangePasswordState = {
  /** true after a successful change, so the form can toast and clear */
  changed?: boolean;
  errors?: PasswordChangeErrors;
};

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

/** Any signed-in user, for their own password only. The user comes from the session, never the form. */
export async function changeMyPassword(_prev: ChangePasswordState, formData: FormData): Promise<ChangePasswordState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const result = await changePassword(user, {
    current: text(formData, "current"),
    next: text(formData, "next"),
    confirm: text(formData, "confirm"),
  });
  if (!result.ok) return { errors: result.errors };

  // The old session stops working with the old password, so start a new one on this device.
  await startSession(user);
  return { changed: true };
}
