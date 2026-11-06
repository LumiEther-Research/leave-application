// Money for payslips. Pure functions (no server imports), so the form can use them too.
// Amounts are handled in paise (whole numbers) so 0.1 + 0.2 style rounding never creeps in.

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

export type PayInput = { basic: string; deduction: string };
export type PayResult =
  | { ok: true; basic: number; deduction: number; net: number }
  | { ok: false; errors: { basic?: string; deduction?: string } };

/** Net = basic minus deduction. The deduction must be between 0 and the basic. */
export function calculatePay(input: PayInput): PayResult {
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
  else if (basic !== null && !errors.basic && deduction > basic)
    errors.deduction = `Deduction can't be more than the basic of ${formatInr(basic)}.`;

  if (errors.basic || errors.deduction || basic === null || deduction === null) return { ok: false, errors };
  return { ok: true, basic, deduction, net: basic - deduction };
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

/** 1 to 999 in words. */
function underThousand(n: number): string {
  const parts: string[] = [];
  if (n >= 100) parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
  const rest = n % 100;
  if (rest > 0) parts.push(rest < 20 ? ONES[rest] : TENS[Math.floor(rest / 10)] + (rest % 10 ? `-${ONES[rest % 10]}` : ""));
  return parts.join(" ");
}

/** Whole rupees in the Indian system: Crore, Lakh, Thousand. Zero is "Zero". */
function rupeesInWords(n: number): string {
  if (n === 0) return "Zero";
  const parts: [number, string][] = [
    [Math.floor(n / 10_000_000), "Crore"],
    [Math.floor(n / 100_000) % 100, "Lakh"],
    [Math.floor(n / 1000) % 100, "Thousand"],
    [n % 1000, ""],
  ];
  return parts
    .filter(([count]) => count > 0)
    .map(([count, unit]) => (unit ? `${underThousand(count)} ${unit}` : underThousand(count)))
    .join(", ");
}

/** "INR Sixteen Thousand, Five Hundred only." Paise, if any, follow: "... and Fifty Paise only." */
export function amountInWords(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  return `INR ${rupeesInWords(rupees)}${rest ? ` and ${underThousand(rest)} Paise` : ""} only.`;
}
