import { useState, type FormEvent } from "react";
import { AlertCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatRange } from "@/lib/dates";
import { FormField } from "./form-field";
import { useSubmit } from "./use-submit";

const LEAVE_TYPES = ["Casual leave", "Sick leave"] as const;
const LENGTHS = [
  { value: "full", label: "Full day" },
  { value: "half", label: "Half day" },
] as const;

type Fields = { type: string; dayLength: string; from: string; to: string };
type Submitted = { type: string; from: string; to: string; halfDay: boolean };

export function ApplyLeaveForm() {
  const { submit, pending, errors } = useSubmit<Fields, Submitted>("/api/employee/leave", "Couldn't send the request. Please try again.");
  const [type, setType] = useState<string>(LEAVE_TYPES[0]);
  const [length, setLength] = useState<string>(LENGTHS[0].value);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const half = length === "half";

  const invalid = (key: keyof Fields) => (errors[key] ? { "aria-invalid": true, "aria-describedby": `${key}-error` } : {});

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const result = await submit({ type, dayLength: length, from, to: half ? "" : to });
    if (result.ok) {
      const s = result.result;
      toast.success(`${s.type} requested`, {
        description: `${formatRange(s.from, s.to)}${s.halfDay ? " (half day)" : ""} · waiting for approval`,
      });
      setFrom("");
      setTo("");
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
      <FormField id="type" label="Type" error={errors.type}>
        <NativeSelect id="type" name="type" className="w-full" value={type} onChange={(e) => setType(e.target.value)} {...invalid("type")}>
          {LEAVE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <FormField id="dayLength" label="How long" error={errors.dayLength}>
        <NativeSelect id="dayLength" name="dayLength" className="w-full" value={length} onChange={(e) => setLength(e.target.value)} {...invalid("dayLength")}>
          {LENGTHS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id="from" label={half ? "Date" : "From"} error={errors.from}>
          <Input id="from" name="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} required {...invalid("from")} />
        </FormField>
        <FormField id="to" label="To" hint={half ? "Not needed for a half day." : "Same as From for a single day."} error={half ? undefined : errors.to}>
          <Input
            id="to"
            name="to"
            type="date"
            value={half ? "" : to}
            onChange={(e) => setTo(e.target.value)}
            disabled={half}
            required={!half}
            {...(half ? {} : invalid("to"))}
          />
        </FormField>
      </div>
      <p className="text-xs text-muted-foreground">
        A half day counts as 0.5 day. Saturdays, Sundays and national holidays aren&apos;t deducted, and approved comp-off is used first.
      </p>
      <Button type="submit" disabled={pending} className="self-start">
        <Send aria-hidden />
        {pending ? "Sending…" : "Request leave"}
      </Button>
    </form>
  );
}
