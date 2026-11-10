// Calendar helpers for display (port of the current app's dates.ts). Dates are calendar days held as local midnight,
// read from "yyyy-mm-dd" text, so the time zone can never shift a day. The server decides what "today" is (IST).

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "2026-11-04" to local midnight on that day. */
export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Local calendar date as "yyyy-MM-dd". */
export function toISODate(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mm}-${dd}`;
}

export type DateStyle = "d" | "d MMM" | "d MMM yyyy" | "EEE, d MMM yyyy" | "EEEE, d MMMM yyyy";

export function formatDate(date: Date, style: DateStyle): string {
  const d = date.getDate();
  const month = MONTHS_SHORT[date.getMonth()];
  switch (style) {
    case "d":
      return `${d}`;
    case "d MMM":
      return `${d} ${month}`;
    case "d MMM yyyy":
      return `${d} ${month} ${date.getFullYear()}`;
    case "EEE, d MMM yyyy":
      return `${DAYS_SHORT[date.getDay()]}, ${d} ${month} ${date.getFullYear()}`;
    case "EEEE, d MMMM yyyy":
      return `${DAYS_LONG[date.getDay()]}, ${d} ${MONTHS_LONG[date.getMonth()]} ${date.getFullYear()}`;
  }
}

export const isSameDay = (a: Date, b: Date) => toISODate(a) === toISODate(b);
export const isSameMonth = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

export function differenceInCalendarDays(a: Date, b: Date): number {
  const utc = (x: Date) => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
  return Math.round((utc(a) - utc(b)) / 86_400_000);
}

export function addDays(date: Date, n: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

/** The `year` anniversary of `joiningISO` (a 29 Feb joining date falls on 28 Feb in non-leap years). */
export function anniversaryIn(joiningISO: string, year: number): Date {
  const j = parseISO(joiningISO);
  const d = new Date(year, j.getMonth(), j.getDate());
  return d.getMonth() === j.getMonth() ? d : new Date(year, j.getMonth() + 1, 0);
}

/** Every calendar day from `start` to `end`, inclusive. */
export function eachDayOfInterval({ start, end }: { start: Date; end: Date }): Date[] {
  const days: Date[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
  return days;
}

/** Saturday or Sunday: the non-working days of the 5-day week. */
export const isWeekend = (date: Date) => date.getDay() === 0 || date.getDay() === 6;

export const isWithinInterval = (day: Date, { start, end }: { start: Date; end: Date }) => day >= start && day <= end;

/** Monday of the week containing `date`. */
export function startOfWeek(date: Date): Date {
  return addDays(date, -((date.getDay() + 6) % 7));
}

/** Sunday of the week containing `date`. */
export function endOfWeek(date: Date): Date {
  return addDays(startOfWeek(date), 6);
}

/** "6 Nov", "6–8 Nov" or "30 Oct – 2 Nov" */
export function formatRange(fromISO: string, toISO: string): string {
  const from = parseISO(fromISO);
  const to = parseISO(toISO);
  if (isSameDay(from, to)) return formatDate(from, "d MMM");
  if (isSameMonth(from, to)) return `${formatDate(from, "d")}–${formatDate(to, "d MMM")}`;
  return `${formatDate(from, "d MMM")} – ${formatDate(to, "d MMM")}`;
}
