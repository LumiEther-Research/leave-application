import { getSessionUser } from "@/lib/auth/session";
import { getPayslipFileFor } from "@/lib/payslip/store";

const notFound = () => new Response("Not found", { status: 404 });

/** An employee can download only their own payslip, an admin any. Everyone else, signed in or not, gets a 404. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return notFound();
  const { id } = await ctx.params;
  const file = await getPayslipFileFor(user, id);
  if (!file) return notFound();
  return new Response(new Uint8Array(file.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
