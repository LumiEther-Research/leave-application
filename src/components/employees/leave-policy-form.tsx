"use client";

import { useActionState, useEffect } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { saveLeavePolicy, type LeavePolicyState } from "@/app/admin/leave-policy/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { categoryLabel, type LeaveCategory } from "@/lib/types";
import { plural } from "@/lib/leave";

export type PolicyRow = LeaveCategory & { employees: number };

export function LeavePolicyForm({ rows }: { rows: PolicyRow[] }) {
  const [state, action, pending] = useActionState<LeavePolicyState, FormData>(saveLeavePolicy, {});

  useEffect(() => {
    if (state.saved) toast.success("Leave days saved", { description: "Applied to everyone in each category." });
  }, [state]);

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <ul className="flex flex-col divide-y divide-border">
        {rows.map((r) => {
          const error = state.errors?.[r.category];
          return (
            <li
              key={r.category}
              className="flex flex-col gap-2 py-4 first:pt-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-col gap-0.5">
                <Label htmlFor={r.category} className="text-sm font-medium">
                  {categoryLabel[r.category]}
                </Label>
                <p className="text-xs text-muted-foreground tabular-nums">{plural(r.employees, "person", "people")}</p>
              </div>
              <div className="flex flex-col items-start gap-1 sm:items-end">
                <div className="flex items-center gap-2">
                  <Input
                    id={r.category}
                    name={r.category}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={366}
                    step={1}
                    defaultValue={state.values?.[r.category] ?? r.daysPerYear}
                    className="w-24 text-right tabular-nums"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? `${r.category}-error` : undefined}
                  />
                  <span className="text-sm text-muted-foreground">days a year</span>
                </div>
                {error && (
                  <p id={`${r.category}-error`} className="text-xs text-destructive">
                    {error}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <Button type="submit" disabled={pending} className="self-start">
        <Save aria-hidden />
        {pending ? "Saving…" : "Save leave days"}
      </Button>
    </form>
  );
}
