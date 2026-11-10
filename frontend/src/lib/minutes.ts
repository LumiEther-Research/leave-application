/** "1 hr", "30 min", "1 hr 30 min". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h > 0 && `${h} hr`, m > 0 && `${m} min`].filter(Boolean).join(" ") || "0 min";
}

/** The longest reason a permission may carry (the backend and the database enforce it too). */
export const MAX_REASON_LENGTH = 200;
