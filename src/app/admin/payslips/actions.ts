"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { generatePayslip } from "@/lib/payslip/generate";
import { monthLabel } from "@/lib/payslip/month";
import { publishPayslip } from "@/lib/payslip/store";

export type GeneratePayslipState = {
  errors?: { employee?: string; month?: string; basic?: string; deduction?: string };
  /** the month already has a payslip for this employee: ask before replacing it */
  confirm?: { employeeName: string; month: string };
  pdfError?: string;
  done?: { message: string };
  /** changes on every result, so the form can tell a new result from an old one */
  nonce?: number;
};

/** Admin only. Without `replace=1` an existing payslip for that month is never touched. */
export async function generatePayslipAction(_prev: GeneratePayslipState, formData: FormData): Promise<GeneratePayslipState> {
  await requireRole("admin");
  const nonce = Date.now();
  const result = await generatePayslip({
    employeeId: String(formData.get("employeeId") ?? ""),
    month: String(formData.get("month") ?? ""),
    basic: String(formData.get("basic") ?? ""),
    deduction: String(formData.get("deduction") ?? ""),
    replace: formData.get("replace") === "1",
  });

  if (result.ok) {
    revalidatePath("/admin/payslips");
    revalidatePath("/employee/payslips");
    const verb = result.outcome === "replaced" ? "replaced" : "generated";
    return { nonce, done: { message: `Payslip ${verb} for ${result.employeeName}, ${monthLabel(result.month)}` } };
  }
  if (result.kind === "invalid") return { nonce, errors: result.errors };
  if (result.kind === "confirm") return { nonce, confirm: { employeeName: result.employeeName, month: result.month } };
  return { nonce, pdfError: result.message };
}

/** Admin only. Publishes a draft as it is (no LOP), so the employee can see and download it. */
export async function publishPayslipAction(payslipId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireRole("admin");
  if (!(await publishPayslip(String(payslipId)))) return { ok: false, error: "That payslip is already published or no longer exists." };
  revalidatePath("/admin/payslips");
  revalidatePath("/employee/payslips");
  return { ok: true };
}
