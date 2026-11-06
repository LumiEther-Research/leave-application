// The monthly job: a draft payslip for everyone with a salary, at zero LOP. Drafts stay hidden from employees
// until the admin publishes them (after typing any LOP). Server only.
import { timingSafeEqual } from "node:crypto";
import { buildPayslipHtml, PdfServiceError, renderPdf } from "./render";
import { listEmployeesNeedingPayslip, savePayslip } from "./store";

export type DraftResult = { created: number; skipped: number; failed: string | null };

/** Makes drafts for the month ("2026-10"). Never touches a payslip that already exists. Stops at once if the PDF service is down. */
export async function createDraftPayslips(month: string, deps: { render?: (html: string) => Promise<Buffer> } = {}): Promise<DraftResult> {
  const render = deps.render ?? renderPdf;
  const periodMonth = `${month}-01`;
  const result: DraftResult = { created: 0, skipped: 0, failed: null };

  for (const employee of await listEmployeesNeedingPayslip(periodMonth)) {
    try {
      const pdf = await render(
        await buildPayslipHtml({
          employeeName: employee.name,
          employeeCode: employee.employeeCode,
          designation: employee.designation,
          periodMonth,
          basic: employee.monthlySalary!,
          deduction: 0,
          net: employee.monthlySalary!,
        }),
      );
      const saved = await savePayslip(
        { employeeId: employee.id, periodMonth, basic: employee.monthlySalary!, deduction: 0, net: employee.monthlySalary!, pdf },
        false,
        false,
      );
      if (saved === "saved") result.created++;
      else result.skipped++; // someone made it while we rendered
    } catch (error) {
      result.failed = error instanceof PdfServiceError ? error.message : "Couldn't create a payslip";
      break;
    }
  }
  return result;
}

/** True only for `Authorization: Bearer <CRON_SECRET>`. With no secret set, nothing is authorised. */
export function isCronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 16 || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

