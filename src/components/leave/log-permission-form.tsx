"use client";

import { useActionState, useEffect } from "react";
import { AlertCircle, Clock } from "lucide-react";
import { toast } from "sonner";
import { logPermission, type LogPermissionState } from "@/app/employee/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate, parseISO } from "@/lib/dates";
import { MAX_REASON_LENGTH } from "@/lib/requests";
import { FormField } from "./form-field";

export function LogPermissionForm() {
  const [state, action, pending] = useActionState<LogPermissionState, FormData>(logPermission, {});

  useEffect(() => {
    if (state.logged) {
      toast.success("Permission noted", {
        description: `${formatDate(parseISO(state.logged.date), "d MMM yyyy")} · ${state.logged.from}–${state.logged.to}`,
      });
    }
  }, [state]);

  const errors = state.errors ?? {};
  const invalid = (key: "date" | "from" | "to" | "reason") =>
    errors[key] ? { "aria-invalid": true, "aria-describedby": `${key}-error` } : {};

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {errors.form && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{errors.form}</AlertDescription>
        </Alert>
      )}
      <FormField id="date" label="Day" error={errors.date}>
        <Input id="date" name="date" type="date" defaultValue={state.values?.date} required {...invalid("date")} />
      </FormField>
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id="from" label="From" error={errors.from}>
          <Input id="from" name="from" type="time" defaultValue={state.values?.from} required {...invalid("from")} />
        </FormField>
        <FormField id="to" label="To" error={errors.to}>
          <Input id="to" name="to" type="time" defaultValue={state.values?.to} required {...invalid("to")} />
        </FormField>
      </div>
      <FormField id="reason" label="Reason (optional)" error={errors.reason}>
        <Input
          id="reason"
          name="reason"
          type="text"
          maxLength={MAX_REASON_LENGTH}
          defaultValue={state.values?.reason}
          placeholder="e.g. Bank work"
          autoComplete="off"
          {...invalid("reason")}
        />
      </FormField>
      <p className="text-xs text-muted-foreground">
        A permission is a few hours off on a working day. It&apos;s noted for your admin and isn&apos;t taken from your
        leave.
      </p>
      <Button type="submit" disabled={pending} className="self-start">
        <Clock aria-hidden />
        {pending ? "Saving…" : "Note permission"}
      </Button>
    </form>
  );
}
