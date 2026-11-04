"use server";

import { revalidatePath } from "next/cache";
import { hashPassword } from "@/lib/auth/password";
import { requireRole } from "@/lib/auth/session";
import { isEmailInUse, removeAdmin as removeAdminAccount } from "@/lib/auth/users";
import { nameFromEmail, validateNewAdmin, type NewAdminErrors } from "@/lib/employees";
import { isUniqueViolation } from "@/lib/db";
import { createAdmin } from "@/lib/store";

export type CreateAdminState = {
  /** set after a successful create, so the form can toast and clear */
  created?: { name: string; email: string };
  errors?: NewAdminErrors;
  error?: string;
  /** sent back on failure so the field keeps what was typed (never the password) */
  values?: { email: string };
};

/** Admins only. The new admin gets the temporary password chosen here and can change it after signing in. */
export async function addAdmin(_prev: CreateAdminState, formData: FormData): Promise<CreateAdminState> {
  await requireRole("admin");

  const values = { email: String(formData.get("email") ?? "") };
  const result = validateNewAdmin(
    { ...values, password: String(formData.get("password") ?? "") },
    { emails: (await isEmailInUse(values.email)) ? [values.email] : [] },
  );
  if (!result.ok) return { errors: result.errors, values };

  try {
    const admin = await createAdmin({
      name: nameFromEmail(result.value.email),
      email: result.value.email,
      passwordHash: await hashPassword(result.value.password),
    });
    revalidatePath("/admin/admins");
    return { created: { name: admin.name, email: admin.email } };
  } catch (error) {
    if (isUniqueViolation(error)) return { errors: { email: "Someone already uses this email." }, values };
    return { error: "Couldn't add the admin. Please try again.", values };
  }
}

export type RemoveAdminResult = { ok: true } | { ok: false; error: string };

/** Admins only. Removes another admin; the removed admin is signed out on their next request. */
export async function removeAdmin(adminId: string): Promise<RemoveAdminResult> {
  const user = await requireRole("admin");
  const result = await removeAdminAccount(user, String(adminId));
  if (result.ok) revalidatePath("/admin/admins");
  return result;
}
