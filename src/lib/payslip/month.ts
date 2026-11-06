// Month helpers for payslips. Pure, so client and server components can both use them.
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-08-01" or "2026-08" gives "August 2026". */
export function monthLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export const isMonth = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value >= "2000-01";

/** The month before the day given: "2026-11-01" gives "2026-10". */
export function previousMonthOf(isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
