"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, FileText } from "lucide-react";
import { toast } from "sonner";
import { generatePayslipAction, type GeneratePayslipState } from "@/app/admin/payslips/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { calculatePay, formatInr, toPlain } from "@/lib/payslip/money";
import { monthLabel } from "@/lib/payslip/month";

export type EmployeeOption = {
  id: string;
  name: string;
  employeeCode: string;
  designation: string | null;
  /** paise */
  monthlySalary: number | null;
};

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">{error}</p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

export function GeneratePayslipForm({ employees, month: initialMonth }: { employees: EmployeeOption[]; month: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<GeneratePayslipState, FormData>(generatePayslipAction, {});
  const [, startTransition] = useTransition();
  const [employeeId, setEmployeeId] = useState("");
  const [month, setMonth] = useState(initialMonth);
  const [basic, setBasic] = useState("");
  const [deduction, setDeduction] = useState("");
  const [dismissed, setDismissed] = useState<GeneratePayslipState | null>(null);

  const employee = employees.find((e) => e.id === employeeId);
  const pay = calculatePay({ basic, deduction });

  useEffect(() => {
    if (state.done) toast.success(state.done.message);
    if (state.pdfError) toast.error(state.pdfError);
  }, [state]);

  const pickEmployee = (id: string) => {
    setEmployeeId(id);
    // The basic starts at their monthly salary and can be changed.
    const salary = employees.find((e) => e.id === id)?.monthlySalary;
    setBasic(salary == null ? "" : toPlain(salary));
  };
  const pickMonth = (value: string) => {
    setMonth(value);
    // The list below follows the month.
    if (/^\d{4}-\d{2}$/.test(value)) startTransition(() => router.replace(`/admin/payslips?month=${value}`, { scroll: false }));
  };
  const confirmReplace = () => {
    if (!formRef.current) return;
    const data = new FormData(formRef.current);
    data.set("replace", "1");
    setDismissed(state);
    startTransition(() => action(data));
  };

  const errors = state.errors ?? {};
  const invalid = (key: keyof typeof errors) => (errors[key] ? { "aria-invalid": true, "aria-describedby": `${key}-error` } : {});
  // Only show a deduction problem live once something has been typed.
  const liveError = !pay.ok && (deduction !== "" || basic !== "") ? pay.errors : {};
  const showConfirm = state.confirm && dismissed !== state;

  return (
    <>
      <form ref={formRef} action={action} className="flex flex-col gap-5" noValidate>
        {state.pdfError && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <AlertDescription>
              {state.pdfError}. Nothing was saved.
              {state.pdfError === "PDF service is not running" && " Start it with docker compose up pdf, then try again."}
            </AlertDescription>
          </Alert>
        )}
        <input type="hidden" name="employeeId" value={employeeId} />
        <Field id="employee" label="Employee" error={errors.employee}>
          <Select value={employeeId} onValueChange={(v) => v && pickEmployee(v)}>
            <SelectTrigger id="employee" className="w-full" {...invalid("employee")}>
              <SelectValue placeholder="Choose an employee">
                {employee ? `${employee.name} (${employee.employeeCode})` : undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {employees.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name} ({e.employeeCode})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {employee && (
          <dl className="grid grid-cols-2 gap-4 rounded-lg bg-muted/50 p-4 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Employee ID</dt>
              <dd className="font-medium tabular-nums">{employee.employeeCode}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Designation</dt>
              <dd className="font-medium">{employee.designation?.trim() || "Not set"}</dd>
            </div>
          </dl>
        )}

        <Field id="month" label="Month" error={errors.month}>
          <Input id="month" name="month" type="month" value={month} onChange={(e) => pickMonth(e.target.value)} required {...invalid("month")} />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            id="basic"
            label="Basic (₹)"
            hint={employee && employee.monthlySalary == null ? "No monthly salary is set for them. Type the basic." : "Starts at their monthly salary."}
            error={errors.basic ?? liveError.basic}
          >
            <Input id="basic" name="basic" inputMode="decimal" autoComplete="off" value={basic} onChange={(e) => setBasic(e.target.value)} className="tabular-nums" required {...invalid("basic")} />
          </Field>
          <Field id="deduction" label="Deduction (₹)" hint="Loss of pay. Leave empty for none." error={errors.deduction ?? liveError.deduction}>
            <Input id="deduction" name="deduction" inputMode="decimal" autoComplete="off" placeholder="0" value={deduction} onChange={(e) => setDeduction(e.target.value)} className="tabular-nums" {...invalid("deduction")} />
          </Field>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border bg-primary-subtle px-4 py-3">
          <span className="text-sm text-muted-foreground">Net pay</span>
          <span aria-live="polite" className="text-lg font-semibold text-primary tabular-nums">
            {pay.ok ? formatInr(pay.net) : "—"}
          </span>
        </div>

        <Button type="submit" disabled={pending || !pay.ok || !employee || !month} className="self-start">
          <FileText aria-hidden />
          {pending ? "Generating…" : "Generate payslip"}
        </Button>
      </form>

      <Dialog open={!!showConfirm} onOpenChange={(open) => !open && setDismissed(state)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace this payslip?</DialogTitle>
            <DialogDescription>
              {state.confirm?.employeeName} already has a payslip for {state.confirm && monthLabel(state.confirm.month)}. Generating again replaces it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDismissed(state)}>Cancel</Button>
            <Button onClick={confirmReplace}>Replace payslip</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
