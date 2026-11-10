import { parseISO } from "@/lib/dates";

/** A holiday as the backend sends it: its next date (yyyy-mm-dd) and how many days away that is. */
export type HolidayInfo = { name: string; date: string; daysAway: number };
export type UpcomingHoliday = { name: string; date: Date; daysAway: number };

export const toUpcoming = (holidays: HolidayInfo[]): UpcomingHoliday[] =>
  holidays.map((h) => ({ name: h.name, date: parseISO(h.date), daysAway: h.daysAway }));
