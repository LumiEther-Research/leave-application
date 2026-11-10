import { useLoaderData } from "react-router-dom";
import { LeavePolicyForm } from "@/components/employees/leave-policy-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { load, type PolicyRow } from "@/lib/api";

export const leavePolicyLoader = () => load<{ categories: PolicyRow[] }>("/api/admin/leave-policy", "/employee");

export function LeavePolicyPage() {
  const { categories } = useLoaderData() as { categories: PolicyRow[] };
  // Keyed by the saved days, so the fields show what was saved after a reload of the data.
  const key = categories.map((c) => c.daysPerYear).join("-");
  return (
    <Card className="max-w-xl [--card-spacing:--spacing(6)]">
      <CardHeader>
        <CardTitle>Leave days per year</CardTitle>
        <CardDescription>
          Choose how many leave days each category gets in a year. Weekends and national holidays aren&apos;t deducted, and approved comp-off is added on
          top. Changes apply to everyone in that category straight away. Employees never see these numbers.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <LeavePolicyForm key={key} rows={categories} />
      </CardContent>
    </Card>
  );
}
