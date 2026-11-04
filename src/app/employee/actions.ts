"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { addCompOffClaim, addLeaveRequest, addPermission, cancelLeaveRequest } from "@/lib/store";
import type { CompOffErrors, LeaveErrors, PermissionErrors } from "@/lib/requests";

export type ApplyLeaveState = {
  /** set after a successful submit, so the form can toast */
  submitted?: { type: string; from: string; to: string; halfDay: boolean };
  errors?: LeaveErrors;
  /** sent back on failure so the fields keep what was typed */
  values?: { from: string; to: string };
};

export type ClaimCompOffState = {
  submitted?: { workedOn: string; halfDay: boolean };
  errors?: CompOffErrors;
  values?: { workedOn: string };
};

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

/** Employees only, and always for themselves: the employee id comes from the session, never the form. */
export async function applyLeave(_prev: ApplyLeaveState, formData: FormData): Promise<ApplyLeaveState> {
  const user = await requireRole("employee");
  const input = {
    type: text(formData, "type"),
    from: text(formData, "from"),
    to: text(formData, "to"),
    dayLength: text(formData, "dayLength") || "full",
  };

  const result = await addLeaveRequest(user.id, input);
  if (!result.ok) return { errors: result.errors, values: { from: input.from, to: input.to } };

  revalidatePath("/employee");
  revalidatePath("/employee/leave");
  revalidatePath("/admin");
  const half = input.dayLength === "half";
  return { submitted: { type: input.type, from: input.from, to: half ? input.from : input.to, halfDay: half } };
}

export async function claimCompOff(_prev: ClaimCompOffState, formData: FormData): Promise<ClaimCompOffState> {
  const user = await requireRole("employee");
  const input = { workedOn: text(formData, "workedOn"), dayLength: text(formData, "dayLength") };

  const result = await addCompOffClaim(user.id, input);
  if (!result.ok) return { errors: result.errors, values: { workedOn: input.workedOn } };

  revalidatePath("/employee");
  revalidatePath("/employee/comp-off");
  revalidatePath("/admin");
  return { submitted: { workedOn: input.workedOn, halfDay: input.dayLength === "half" } };
}

export type CancelLeaveResult = { ok: true; action: "withdraw" | "request" } | { ok: false; error: string };

/** Employees only, and only their own leave. Pending leave is withdrawn; approved leave goes to an admin. */
export async function cancelLeave(requestId: string): Promise<CancelLeaveResult> {
  const user = await requireRole("employee");
  const result = await cancelLeaveRequest(user.id, String(requestId));
  if (result.ok) {
    revalidatePath("/employee");
    revalidatePath("/employee/leave");
    revalidatePath("/admin");
  }
  return result;
}

export type LogPermissionState = {
  /** set after a successful save, so the form can toast */
  logged?: { date: string; from: string; to: string };
  errors?: PermissionErrors;
  /** sent back on failure so the fields keep what was typed */
  values?: { date: string; from: string; to: string; reason: string };
};

/** Employees only, for themselves. Notes a few hours off on one working day; nothing is deducted from leave. */
export async function logPermission(_prev: LogPermissionState, formData: FormData): Promise<LogPermissionState> {
  const user = await requireRole("employee");
  const input = {
    date: text(formData, "date"),
    from: text(formData, "from"),
    to: text(formData, "to"),
    reason: text(formData, "reason"),
  };

  const result = await addPermission(user.id, input);
  if (!result.ok) return { errors: result.errors, values: input };

  revalidatePath("/employee/permissions");
  revalidatePath("/admin/permissions");
  return { logged: { date: input.date, from: input.from, to: input.to } };
}
