import { useState, type FormEvent } from "react";
import { AlertCircle, Clock } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate, parseISO } from "@/lib/dates";
import { MAX_REASON_LENGTH } from "@/lib/minutes";
import { FormField } from "./form-field";
import { useSubmit } from "./use-submit";

type Fields = { date: string; from: string; to: string; reason: string };
const EMPTY: Fields = { date: "", from: "", to: "", reason: "" };

export function LogPermissionForm() {
  const { submit, pending, errors } = useSubmit<Fields, { date: string; from: string; to: string }>(
    "/api/employee/permissions",
    "Couldn't save the permission. Please try again.",
  );
  const [values, setValues] = useState<Fields>(EMPTY);

  const invalid = (key: keyof Fields) => (errors[key] ? { "aria-invalid": true, "aria-describedby": `${key}-error` } : {});
  const bind = (key: keyof Fields) => ({ value: values[key], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [key]: e.target.value })) });

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const result = await submit(values);
    if (result.ok) {
      const l = result.result;
      toast.success("Permission noted", { description: `${formatDate(parseISO(l.date), "d MMM yyyy")} · ${l.from}–${l.to}` });
      setValues(EMPTY);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      {errors.form && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{errors.form}</AlertDescription>
        </Alert>
      )}
      <FormField id="date" label="Day" error={errors.date}>
        <Input id="date" name="date" type="date" required {...bind("date")} {...invalid("date")} />
      </FormField>
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id="from" label="From" error={errors.from}>
          <Input id="from" name="from" type="time" required {...bind("from")} {...invalid("from")} />
        </FormField>
        <FormField id="to" label="To" error={errors.to}>
          <Input id="to" name="to" type="time" required {...bind("to")} {...invalid("to")} />
        </FormField>
      </div>
      <FormField id="reason" label="Reason (optional)" error={errors.reason}>
        <Input id="reason" name="reason" type="text" maxLength={MAX_REASON_LENGTH} placeholder="e.g. Bank work" autoComplete="off" {...bind("reason")} {...invalid("reason")} />
      </FormField>
      <p className="text-xs text-muted-foreground">
        A permission is a few hours off on a working day. It&apos;s noted for your admin and isn&apos;t taken from your leave.
      </p>
      <Button type="submit" disabled={pending} className="self-start">
        <Clock aria-hidden />
        {pending ? "Saving…" : "Note permission"}
      </Button>
    </form>
  );
}
