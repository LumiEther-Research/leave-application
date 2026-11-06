// Fills the payslip template and turns it into a PDF through the WeasyPrint service (see /pdf-service).
// Server only: reads the template and the logo from disk.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { amountInWords, formatInr } from "./money";

// The letterhead's address and CIN come from the sample payslip. Change them here if they are wrong.
export const COMPANY = {
  name: "LumiEther Research LLP,",
  address: "152, BOOHBCS 1st Stage, Doddakallasandra, Off Kanakapura Road, Bengaluru-560062",
  cin: "ACN-8436",
};

export const PDF_SERVICE_DOWN = "PDF service is not running";

export class PdfServiceError extends Error {
  constructor(message = PDF_SERVICE_DOWN) {
    super(message);
  }
}

export type PayslipData = {
  employeeName: string;
  employeeCode: string;
  designation: string | null;
  /** first day of the month, "2026-08-01" */
  periodMonth: string;
  basic: number;
  deduction: number;
  net: number;
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** "2026-08-01" gives ["2026-08-01", "2026-08-31"]. */
export function periodRange(periodMonth: string): [string, string] {
  const [y, m] = periodMonth.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${y}-${String(m).padStart(2, "0")}-01`, `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`];
}

/** Replaces {{name}} with the escaped value, and keeps {{#if name}}...{{/if}} only when that value is set. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template
    .replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key: string, body: string) => (values[key] ? body : ""))
    .replace(/\{\{(\w+)\}\}/g, (_, key: string) => (key === "logo" ? values.logo : escapeHtml(values[key] ?? "")));
}

export async function buildPayslipHtml(data: PayslipData): Promise<string> {
  const [template, logo] = await Promise.all([
    readFile(join(process.cwd(), "src/lib/payslip/template.html"), "utf8"),
    readFile(join(process.cwd(), "public/lumiether-logo.png")),
  ]);
  const [periodStart, periodEnd] = periodRange(data.periodMonth);
  return fillTemplate(template, {
    // The PDF service can't see this app's files, so the logo travels inside the HTML.
    logo: `data:image/png;base64,${logo.toString("base64")}`,
    companyName: COMPANY.name,
    companyAddress: COMPANY.address,
    companyCin: COMPANY.cin,
    period: periodStart.slice(0, 7),
    periodStart,
    periodEnd,
    employeeName: data.employeeName,
    employeeCode: data.employeeCode,
    designation: data.designation?.trim() || "—",
    basic: formatInr(data.basic).slice(1),
    gross: formatInr(data.basic).slice(1),
    deduction: formatInr(data.deduction).slice(1),
    hasDeduction: data.deduction > 0 ? "1" : "",
    grossInr: formatInr(data.basic),
    deductionInr: formatInr(data.deduction),
    netInr: formatInr(data.net),
    amountInWords: amountInWords(data.net),
  });
}

/** Sends HTML to the PDF service and returns the PDF bytes. Any failure to reach it is "PDF service is not running". */
export async function renderPdf(html: string): Promise<Buffer> {
  const base = process.env.PDF_SERVICE_URL;
  if (!base) throw new PdfServiceError();
  let response: Response;
  try {
    response = await fetch(new URL("/render", base), {
      method: "POST",
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: html,
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new PdfServiceError();
  }
  if (!response.ok) throw new PdfServiceError(`The PDF service couldn't render the payslip (HTTP ${response.status}).`);
  const pdf = Buffer.from(await response.arrayBuffer());
  if (pdf.subarray(0, 4).toString() !== "%PDF") throw new PdfServiceError("The PDF service returned something that isn't a PDF.");
  return pdf;
}
