import { useLoaderData } from "react-router-dom";
import { HolidayTimeline } from "@/components/holidays/holiday-timeline";
import { load, type Holiday } from "@/lib/api";
import { toUpcoming } from "@/lib/holidays";

/** Open to both roles; each passes its own home so a wrong-role visit goes to the right place. */
export const holidaysLoader = (home: string) => () => load<{ holidays: Holiday[] }>("/api/holidays", home);

export function HolidaysPage() {
  const { holidays } = useLoaderData() as { holidays: Holiday[] };
  return (
    <div className="max-w-xl">
      <HolidayTimeline holidays={toUpcoming(holidays)} />
    </div>
  );
}
