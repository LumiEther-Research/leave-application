"use client";

import { useActionState, useEffect, useState } from "react";
import { AlertCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { applyLeave, type ApplyLeaveState } from "@/app/employee/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatRange } from "@/lib/dates";
import { LEAVE_TYPES } from "@/lib/requests";
import { FormField } from "./form-field";

const LENGTHS = [
  { value: "full", label: "Full day" },
  { value: "half", label: "Half day" },
] as const;

export function ApplyLeaveForm() {
  const [state, action, pending] = useActionState<ApplyLeaveState, FormData>(applyLeave, {});
  const [type, setType] = useState<string>(LEAVE_TYPES[0]);
  const [length, setLength] = useState<string>(LENGTHS[0].value);
  const half = length === "half";

  useEffect(() => {
    if (state.submitted) {
      toast.success(`${state.submitted.type} requested`, {
        description: `${formatRange(state.submitted.from, state.submitted.to)}${state.submitted.halfDay ? " (half day)" : ""} · waiting for approval`,
      });
    }
  }, [state]);

  const errors = state.errors ?? {};
  const invalid = (key: "from" | "to" | "type" | "dayLength") =>
    errors[key] ? { "aria-invalid": true, "aria-describedby": `${key}-error` } : {};

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {errors.form && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{errors.form}</AlertDescription>
        </Alert>
      )}
      <FormField id="type" label="Type" error={errors.type}>
        <Select name="type" value={type} onValueChange={(v) => v && setType(v)}>
          <SelectTrigger id="type" className="w-full" {...invalid("type")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEAVE_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <FormField id="dayLength" label="How long" error={errors.dayLength}>
        <Select name="dayLength" value={length} onValueChange={(v) => v && setLength(v)}>
          <SelectTrigger id="dayLength" className="w-full" {...invalid("dayLength")}>
            <SelectValue>{LENGTHS.find((l) => l.value === length)?.label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {LENGTHS.map((l) => (
              <SelectItem key={l.value} value={l.value}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id="from" label={half ? "Date" : "From"} error={errors.from}>
          <Input id="from" name="from" type="date" defaultValue={state.values?.from} required {...invalid("from")} />
        </FormField>
        <FormField
          id="to"
          label="To"
          hint={half ? "Not needed for a half day." : "Same as From for a single day."}
          error={half ? undefined : errors.to}
        >
          <Input
            id="to"
            name="to"
            type="date"
            defaultValue={state.values?.to}
            disabled={half}
            required={!half}
            {...(half ? {} : invalid("to"))}
          />
        </FormField>
      </div>
      <p className="text-xs text-muted-foreground">
        A half day counts as 0.5 day. Saturdays, Sundays and national holidays aren&apos;t deducted, and approved
        comp-off is used first.
      </p>
      <Button type="submit" disabled={pending} className="self-start">
        <Send aria-hidden />
        {pending ? "Sending…" : "Request leave"}
      </Button>
    </form>
  );
}
