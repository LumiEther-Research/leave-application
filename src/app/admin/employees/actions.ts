"use server";

import { revalidatePath } from "next/cache";
import { hashPassword } from "@/lib/auth/password";
import { requireRole } from "@/lib/auth/session";
import { nameFromEmail, validateNewEmployee, validatePayroll, type NewEmployeeErrors, type PayrollErrors } from "@/lib/employees";
import { isUniqueViolation } from "@/lib/db";
import { createEmployee, deleteEmployee, setEmployeeCategory, setEmployeePayroll } from "@/lib/store";
import { CATEGORIES, type Category } from "@/lib/types";
import { isEmailInUse } from "@/lib/auth/users";

export type CreateEmployeeState = {
  /** set after a successful create, so the form can toast and reset */
  created?: { name: string; email: string };
  errors?: NewEmployeeErrors;
  /** sent back on failure so the fields keep what was typed (never the password) */
  values?: { email: string; joiningDate: string; category: string; monthlySalary: string; designation: string };
  error?: string;
};

/** Admin only. The admin chooses the temporary password; only its hash is stored. */
export async function addEmployee(_prev: CreateEmployeeState, formData: FormData): Promise<CreateEmployeeState> {
  await requireRole("admin");

  const values = {
    email: String(formData.get("email") ?? ""),
    joiningDate: String(formData.get("joiningDate") ?? ""),
    category: String(formData.get("category") ?? ""),
    monthlySalary: String(formData.get("monthlySalary") ?? ""),
    designation: String(formData.get("designation") ?? ""),
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
      monthlySalary: result.value.monthlySalary,
      designation: result.value.designation,
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

export type UpdatePayrollResult = { ok: true } | { ok: false; errors?: PayrollErrors; error?: string };

/** Admin only. Saves the monthly salary and designation shown on payslips. Empty clears a value. */
export async function updateEmployeePayroll(
  employeeId: string,
  input: { monthlySalary: string; designation: string },
): Promise<UpdatePayrollResult> {
  await requireRole("admin");
  const result = validatePayroll(input);
  if (!result.ok) return { ok: false, errors: result.errors };
  if (!(await setEmployeePayroll(String(employeeId), result.value))) {
    return { ok: false, error: "That employee no longer exists." };
  }
  revalidatePath("/admin/employees");
  revalidatePath("/admin/payslips");
  return { ok: true };
}

export type RemoveEmployeeResult = { ok: true } | { ok: false; error: string };

/** Admin only. Permanently removes the employee and everything of theirs: leave, comp-off, permissions, payslips. */
export async function removeEmployee(employeeId: string): Promise<RemoveEmployeeResult> {
  await requireRole("admin");
  if (!(await deleteEmployee(String(employeeId)))) return { ok: false, error: "That employee no longer exists." };
  revalidatePath("/admin/employees");
  revalidatePath("/admin/payslips");
  revalidatePath("/admin");
  return { ok: true };
}
