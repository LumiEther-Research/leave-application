const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-01-05" as "5 Jan 2026" (the current app's `d MMM yyyy`). Read from the text, so no time zone can shift the day. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "16500.50" as "₹16,500.50", in Indian digit grouping (lakhs and crores), like the current app's formatInr. */
export function formatInr(plain: string): string {
  const [rupees, paise = "00"] = plain.split(".");
  const head = rupees.slice(0, -3);
  const grouped = (head ? head.replace(/\B(?=(\d{2})+$)/g, ",") + "," : "") + rupees.slice(-3);
  return `₹${grouped}.${paise.padEnd(2, "0")}`;
}
