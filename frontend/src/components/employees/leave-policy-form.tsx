import { useState, type FormEvent } from "react";
import { useNavigate, useRevalidator } from "react-router-dom";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { send, type PolicyRow } from "@/lib/api";
import { categoryLabel, type Category } from "@/lib/categories";
import { plural } from "@/lib/plural";

export function LeavePolicyForm({ rows }: { rows: PolicyRow[] }) {
  const navigate = useNavigate();
  const { revalidate } = useRevalidator();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.category, String(r.daysPerYear)])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setErrors({});
    try {
      const reply = await send("PUT", "/api/admin/leave-policy", values);
      if (reply.status === 401) return navigate("/login");
      if (reply.status === 200) {
        toast.success("Leave days saved", { description: "Applied to everyone in each category." });
        revalidate();
      } else if (reply.status === 422) {
        setErrors((reply.body?.errors as Record<string, string>) ?? {});
      } else {
        toast.error("Couldn't save the leave days. Please try again.");
      }
    } catch {
      toast.error("Couldn't save the leave days. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-5" noValidate>
      <ul className="flex flex-col divide-y divide-border">
        {rows.map((r) => {
          const error = errors[r.category];
          return (
            <li key={r.category} className="flex flex-col gap-2 py-4 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor={r.category} className="text-sm font-medium">
                  {categoryLabel[r.category as Category]}
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
                    value={values[r.category] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [r.category]: e.target.value }))}
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
