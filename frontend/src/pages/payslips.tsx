import { useState } from "react";
import { useLoaderData } from "react-router-dom";
import { GeneratePayslipForm } from "@/components/payslips/generate-payslip-form";
import { PayslipList } from "@/components/payslips/payslip-list";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, load, send, type AdminPayslips, type PayslipRow } from "@/lib/api";
import { monthLabel } from "@/lib/money";

/** The month comes from `?month=2026-08` (the backend falls back to the current month if it is missing or unreadable). */
export const adminPayslipsLoader = ({ request }: { request: Request }) => {
  const month = new URL(request.url).searchParams.get("month");
  return load<AdminPayslips>(`/api/admin/payslips${month ? `?month=${encodeURIComponent(month)}` : ""}`, "/employee");
};

export const myPayslipsLoader = () => load<{ payslips: PayslipRow[] }>("/api/employee/payslips", "/admin");

export function AdminPayslipsPage() {
  const first = useLoaderData() as AdminPayslips;
  const [data, setData] = useState(first);
  const [month, setMonth] = useState(first.month);

  // The list follows the month and refreshes after a change, without leaving the page (so the form keeps what was typed).
  async function reload(next: string) {
    const reply = await send("GET", `/api/admin/payslips?month=${encodeURIComponent(next)}`);
    if (reply.status === 200 && reply.body) setData(reply.body as unknown as AdminPayslips);
    else throw new ApiError(reply.status, reply.body);
  }
  const pickMonth = (value: string) => {
    setMonth(value);
    if (/^\d{4}-\d{2}$/.test(value)) {
      window.history.replaceState(null, "", `/admin/payslips?month=${value}`);
      void reload(value).catch(() => {});
    }
  };

  return (
    <div className="grid items-start gap-6 xl:grid-cols-3">
      <Card className="[--card-spacing:--spacing(6)] xl:order-2">
        <CardHeader>
          <CardTitle>Generate a payslip</CardTitle>
          <CardDescription>Pick an employee and a month. The PDF is saved and can be downloaded below.</CardDescription>
        </CardHeader>
        <CardContent>
          <GeneratePayslipForm employees={data.employees} month={month} onMonth={pickMonth} onDone={() => void reload(month).catch(() => {})} />
        </CardContent>
      </Card>
      <div className="xl:order-1 xl:col-span-2">
        <PayslipList
          payslips={data.payslips}
          showEmployee
          title={`Payslips for ${monthLabel(data.month)}`}
          description="On the 1st, drafts are made for last month at no LOP. Employees see a payslip only once it is published."
          emptyTitle="No payslips this month"
          emptyDescription="Generate one with the form and it will show up here."
          onChanged={() => void reload(month).catch(() => {})}
        />
      </div>
    </div>
  );
}

export function MyPayslipsPage() {
  const { payslips } = useLoaderData() as { payslips: PayslipRow[] };
  return (
    <PayslipList
      payslips={payslips}
      showEmployee={false}
      title="Your payslips"
      description="Download a payslip for any month it has been generated."
      emptyTitle="No payslips yet"
      emptyDescription="Your payslips will show up here once your admin generates them."
    />
  );
}
