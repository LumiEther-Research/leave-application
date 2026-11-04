import { connection } from "next/server";
import { HolidayTimeline } from "@/components/holidays/holiday-timeline";
import { AppShell } from "@/components/layout/app-shell";
import { toShellUser } from "@/components/layout/shell-user";
import { requireRole } from "@/lib/auth/session";
import { getToday } from "@/lib/dates";
import { getUpcomingHolidays } from "@/lib/holidays";
import { getHolidays } from "@/lib/store";

export const metadata = { title: "Holidays" };

export default async function HolidaysPage() {
  await connection();
  const user = await requireRole("employee");
  const holidays = getUpcomingHolidays(await getHolidays(), getToday());

  return (
    <AppShell user={toShellUser(user)} active="/employee/holidays">
      <div className="max-w-xl">
        <HolidayTimeline holidays={holidays} />
      </div>
    </AppShell>
  );
}
