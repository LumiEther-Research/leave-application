// Money for payslips (port of the current app's money.ts). Amounts are handled in paise (whole numbers). The backend
// is the judge of every amount; this only shows the net pay while the admin types.

/** numeric(12,2) holds up to 9,999,999,999.99 */
export const MAX_PAISE = 999_999_999_999;

/** Parses "16500", "16,500.5" or "16500.50" into paise. Null if it isn't a plain non-negative amount. */
export function parseAmount(input: string): number | null {
  const m = input.trim().replace(/,/g, "").match(/^(\d{1,10})(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || 0);
}

/** Paise as the plain "16500.50" a number input or a numeric column uses. */
export const toPlain = (paise: number) => `${Math.trunc(paise / 100)}.${String(paise % 100).padStart(2, "0")}`;

/** Indian grouping with two decimals: ₹16,500.00 and ₹1,00,000.00. */
export function formatInr(paise: number): string {
  const rupees = String(Math.trunc(paise / 100));
  const head = rupees.slice(0, -3);
  const grouped = (head ? head.replace(/\B(?=(\d{2})+$)/g, ",") + "," : "") + rupees.slice(-3);
  return `₹${grouped}.${String(paise % 100).padStart(2, "0")}`;
}

export type PayResult = { ok: true; basic: number; deduction: number; net: number } | { ok: false; errors: { basic?: string; deduction?: string } };

/** Net = basic minus deduction. The deduction must be between 0 and the basic. */
export function calculatePay(input: { basic: string; deduction: string }): PayResult {
  const errors: { basic?: string; deduction?: string } = {};
  const basic = parseAmount(input.basic);
  // An empty deduction means none.
  const deduction = input.deduction.trim() === "" ? 0 : parseAmount(input.deduction);

  if (input.basic.trim().startsWith("-")) errors.basic = "Basic can't be negative.";
  else if (basic === null) errors.basic = "Enter the basic as an amount, like 16500 or 16500.50.";
  else if (basic <= 0) errors.basic = "Basic must be more than zero.";
  else if (basic > MAX_PAISE) errors.basic = "That basic is too large.";

  if (input.deduction.trim().startsWith("-")) errors.deduction = "Deduction can't be negative.";
  else if (deduction === null) errors.deduction = "Enter the deduction as an amount, like 1500 or 1500.50.";
  else if (basic !== null && !errors.basic && deduction > basic) errors.deduction = `Deduction can't be more than the basic of ${formatInr(basic)}.`;

  if (errors.basic || errors.deduction || basic === null || deduction === null) return { ok: false, errors };
  return { ok: true, basic, deduction, net: basic - deduction };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-08-01" or "2026-08" gives "August 2026". */
export function monthLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}
