// Generating a payslip: check the numbers, render the PDF, then store it. Nothing is stored unless the PDF
// was made. Server only.
import { calculatePay } from "./money";
import { buildPayslipHtml, PdfServiceError, renderPdf } from "./render";
import { findPayslipEmployee, payslipState, savePayslip } from "./store";

export type GenerateInput = {
  employeeId: string;
  /** "2026-08" */
  month: string;
  basic: string;
  deduction: string;
  /** the admin agreed to overwrite an existing payslip for this month */
  replace: boolean;
};

export type GenerateResult =
  | { ok: true; outcome: "saved" | "replaced"; employeeName: string; month: string }
  | { ok: false; kind: "invalid"; errors: { employee?: string; month?: string; basic?: string; deduction?: string } }
  | { ok: false; kind: "confirm"; employeeName: string; month: string }
  | { ok: false; kind: "pdf"; message: string };

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export type Deps = { render?: (html: string) => Promise<Buffer> };

export async function generatePayslip(input: GenerateInput, deps: Deps = {}): Promise<GenerateResult> {
  const render = deps.render ?? renderPdf;
  const errors: { employee?: string; month?: string; basic?: string; deduction?: string } = {};

  const employee = await findPayslipEmployee(input.employeeId);
  if (!employee) errors.employee = "Choose an employee.";
  if (!MONTH.test(input.month) || input.month < "2000-01") errors.month = "Choose a month.";
  const pay = calculatePay({ basic: input.basic, deduction: input.deduction });
  if (!pay.ok) Object.assign(errors, pay.errors);
  if (Object.keys(errors).length || !employee || !pay.ok) return { ok: false, kind: "invalid", errors };

  const periodMonth = `${input.month}-01`;
  const state = await payslipState(employee.id, periodMonth);
  // Replacing a published payslip needs the admin's go-ahead. A draft is what this is for, so it needs none.
  if (!input.replace && state === "published")
    return { ok: false, kind: "confirm", employeeName: employee.name, month: input.month };
  const replace = input.replace || state === "draft";

  let pdf: Buffer;
  try {
    pdf = await render(
      await buildPayslipHtml({
        employeeName: employee.name,
        employeeCode: employee.employeeCode,
        designation: employee.designation,
        periodMonth,
        basic: pay.basic,
        deduction: pay.deduction,
        net: pay.net,
      }),
    );
  } catch (error) {
    return { ok: false, kind: "pdf", message: error instanceof PdfServiceError ? error.message : "PDF service is not running" };
  }

  // Generating by hand is the admin finalising it, so it is published.
  const saved = await savePayslip({ employeeId: employee.id, periodMonth, ...pay, pdf }, replace, true);
  // Someone else made this month's payslip while the PDF was rendering.
  if (saved === "exists") return { ok: false, kind: "confirm", employeeName: employee.name, month: input.month };
  return { ok: true, outcome: saved, employeeName: employee.name, month: input.month };
}
