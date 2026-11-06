import { getToday, toISODate } from "@/lib/dates";
import { createDraftPayslips, isCronAuthorized } from "@/lib/payslip/drafts";
import { previousMonthOf } from "@/lib/payslip/month";

/**
 * Called by Vercel Cron on the 1st (see vercel.json) with `Authorization: Bearer $CRON_SECRET`. Creates last
 * month's draft payslips. Anyone else gets a 404, so the route doesn't advertise itself.
 */
export async function GET(request: Request) {
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return new Response("Not found", { status: 404 });
  }
  const month = previousMonthOf(toISODate(getToday()));
  const result = await createDraftPayslips(month);
  return Response.json({ month, ...result }, { status: result.failed ? 503 : 200 });
}
