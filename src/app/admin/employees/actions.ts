"use server";

import { revalidatePath } from "next/cache";
import { hashPassword } from "@/lib/auth/password";
import { requireRole } from "@/lib/auth/session";
import { nameFromEmail, validateNewEmployee, type NewEmployeeErrors } from "@/lib/employees";
import { isUniqueViolation } from "@/lib/db";
import { createEmployee, setEmployeeCategory } from "@/lib/store";
import { CATEGORIES, type Category } from "@/lib/types";
import { isEmailInUse } from "@/lib/auth/users";

export type CreateEmployeeState = {
  /** set after a successful create, so the form can toast and reset */
  created?: { name: string; email: string };
  errors?: NewEmployeeErrors;
  /** sent back on failure so the fields keep what was typed (never the password) */
  values?: { email: string; joiningDate: string; category: string };
  error?: string;
};

/** Admin only. The admin chooses the temporary password; only its hash is stored. */
export async function addEmployee(_prev: CreateEmployeeState, formData: FormData): Promise<CreateEmployeeState> {
  await requireRole("admin");

  const values = {
    email: String(formData.get("email") ?? ""),
    joiningDate: String(formData.get("joiningDate") ?? ""),
    category: String(formData.get("category") ?? ""),
  };
  const result = validateNewEmployee(
    { ...values, password: String(formData.get("password") ?? "") },
    { emails: (await isEmailInUse(values.email)) ? [values.email] : [] },
  );
  if (!result.ok) return { errors: result.errors, values };

  try {
    const employee = await createEmployee({
      name: nameFromEmail(result.value.email),
      email: result.value.email,
      joiningDate: result.value.joiningDate,
      passwordHash: await hashPassword(result.value.password),
      category: result.value.category,
    });
    revalidatePath("/admin/employees");
    revalidatePath("/admin");
    return { created: { name: employee.name, email: employee.email } };
  } catch (error) {
    // Two people adding the same email at once: the unique index lets only one through.
    if (isUniqueViolation(error)) return { errors: { email: "Someone already uses this email." }, values };
    return { error: "Couldn't add the employee. Please try again.", values };
  }
}

export type ChangeCategoryResult = { ok: true } | { ok: false; error: string };

/** Admin only. Moving an employee to another category changes how many leave days they get. */
export async function changeEmployeeCategory(employeeId: string, category: string): Promise<ChangeCategoryResult> {
  await requireRole("admin");
  if (!(CATEGORIES as readonly string[]).includes(category)) return { ok: false, error: "Choose a category." };
  if (!(await setEmployeeCategory(String(employeeId), category as Category))) {
    return { ok: false, error: "That employee no longer exists." };
  }
  revalidatePath("/admin/employees");
  revalidatePath("/admin");
  return { ok: true };
}
