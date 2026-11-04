import { differenceInCalendarDays } from "./dates";
import type { Holiday } from "./types";

export type UpcomingHoliday = { name: string; date: Date; daysAway: number };

/** Next occurrence of each yearly holiday on or after `today`, soonest first. */
export function getUpcomingHolidays(holidays: Holiday[], today: Date): UpcomingHoliday[] {
  return holidays
    .map(({ name, month, day }) => {
      let date = new Date(today.getFullYear(), month - 1, day);
      if (date < today) date = new Date(today.getFullYear() + 1, month - 1, day);
      return { name, date, daysAway: differenceInCalendarDays(date, today) };
    })
    .sort((a, b) => a.daysAway - b.daysAway);
}
