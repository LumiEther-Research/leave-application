"use client";

import { useActionState, useEffect, useState } from "react";
import { AlertCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { claimCompOff, type ClaimCompOffState } from "@/app/employee/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate, parseISO } from "@/lib/dates";
import { FormField } from "./form-field";

const LENGTHS = [
  { value: "full", label: "Full day (1 comp-off day)" },
  { value: "half", label: "Half day (0.5 comp-off day)" },
] as const;

export function ClaimCompOffForm() {
  const [state, action, pending] = useActionState<ClaimCompOffState, FormData>(claimCompOff, {});
  const [length, setLength] = useState<string>(LENGTHS[0].value);

  useEffect(() => {
    if (state.submitted) {
      toast.success("Comp-off requested", {
        description: `${formatDate(parseISO(state.submitted.workedOn), "d MMM yyyy")} · waiting for approval`,
      });
    }
  }, [state]);

  const errors = state.errors ?? {};
  const invalid = (key: "workedOn" | "dayLength") =>
    errors[key] ? { "aria-invalid": true, "aria-describedby": `${key}-error` } : {};

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {errors.form && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{errors.form}</AlertDescription>
        </Alert>
      )}
      <FormField
        id="workedOn"
        label="Day you worked"
        hint="A Saturday, a Sunday or a national holiday."
        error={errors.workedOn}
      >
        <Input
          id="workedOn"
          name="workedOn"
          type="date"
          defaultValue={state.values?.workedOn}
          required
          {...invalid("workedOn")}
        />
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
      <p className="text-xs text-muted-foreground">It&apos;s added to your leave balance once an admin approves it.</p>
      <Button type="submit" disabled={pending} className="self-start">
        <Send aria-hidden />
        {pending ? "Sending…" : "Request comp-off"}
      </Button>
    </form>
  );
}
