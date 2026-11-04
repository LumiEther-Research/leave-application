"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { setLeaveCategoryDays } from "@/lib/store";
import { CATEGORIES, type Category } from "@/lib/types";

export type LeavePolicyState = {
  /** true after a successful save, so the form can toast */
  saved?: boolean;
  /** one message per category that was wrong */
  errors?: Partial<Record<Category, string>>;
  /** sent back on failure so the fields keep what was typed */
  values?: Partial<Record<Category, string>>;
};

/** Admin only. Sets how many leave days a year each category gets; it takes effect for everyone in it at once. */
export async function saveLeavePolicy(_prev: LeavePolicyState, formData: FormData): Promise<LeavePolicyState> {
  await requireRole("admin");

  const values: Partial<Record<Category, string>> = {};
  const errors: Partial<Record<Category, string>> = {};
  const days = {} as Record<Category, number>;
  for (const c of CATEGORIES) {
    const raw = String(formData.get(c) ?? "").trim();
    values[c] = raw;
    const n = Number(raw);
    if (raw === "" || !Number.isInteger(n)) errors[c] = "Enter a whole number of days.";
    else if (n < 0 || n > 366) errors[c] = "Use a number between 0 and 366.";
    else days[c] = n;
  }
  if (Object.keys(errors).length) return { errors, values };

  for (const c of CATEGORIES) await setLeaveCategoryDays(c, days[c]);
  revalidatePath("/admin/leave-policy");
  revalidatePath("/admin");
  return { saved: true };
}
