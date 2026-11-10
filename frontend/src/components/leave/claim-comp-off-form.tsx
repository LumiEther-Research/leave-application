import { useState, type FormEvent } from "react";
import { AlertCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDate, parseISO } from "@/lib/dates";
import { FormField } from "./form-field";
import { useSubmit } from "./use-submit";

const LENGTHS = [
  { value: "full", label: "Full day (1 comp-off day)" },
  { value: "half", label: "Half day (0.5 comp-off day)" },
] as const;

type Fields = { workedOn: string; dayLength: string };

export function ClaimCompOffForm() {
  const { submit, pending, errors } = useSubmit<Fields, { workedOn: string; halfDay: boolean }>(
    "/api/employee/comp-off",
    "Couldn't send the request. Please try again.",
  );
  const [length, setLength] = useState<string>(LENGTHS[0].value);
  const [workedOn, setWorkedOn] = useState("");

  const invalid = (key: keyof Fields) => (errors[key] ? { "aria-invalid": true, "aria-describedby": `${key}-error` } : {});

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const result = await submit({ workedOn, dayLength: length });
    if (result.ok) {
      toast.success("Comp-off requested", { description: `${formatDate(parseISO(result.result.workedOn), "d MMM yyyy")} · waiting for approval` });
      setWorkedOn("");
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
      <FormField id="workedOn" label="Day you worked" hint="A Saturday, a Sunday or a national holiday." error={errors.workedOn}>
        <Input id="workedOn" name="workedOn" type="date" value={workedOn} onChange={(e) => setWorkedOn(e.target.value)} required {...invalid("workedOn")} />
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
      <p className="text-xs text-muted-foreground">It&apos;s added to your leave balance once an admin approves it.</p>
      <Button type="submit" disabled={pending} className="self-start">
        <Send aria-hidden />
        {pending ? "Sending…" : "Request comp-off"}
      </Button>
    </form>
  );
}
