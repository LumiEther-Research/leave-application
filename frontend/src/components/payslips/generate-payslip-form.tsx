import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, FileText } from "lucide-react";
import { toast } from "sonner";
import { FormField } from "@/components/leave/form-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { send, type PayslipEmployee } from "@/lib/api";
import { calculatePay, formatInr, monthLabel } from "@/lib/money";

type Errors = { employee?: string; month?: string; basic?: string; deduction?: string };

export function GeneratePayslipForm({
  employees,
  month,
  onMonth,
  onDone,
}: {
  employees: PayslipEmployee[];
  month: string;
  /** the list follows the month */
  onMonth: (month: string) => void;
  onDone: () => void;
}) {
  const navigate = useNavigate();
  const [employeeId, setEmployeeId] = useState("");
  const [basic, setBasic] = useState("");
  const [deduction, setDeduction] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [pdfError, setPdfError] = useState<string>();
  const [confirm, setConfirm] = useState<{ employeeName: string; month: string }>();
  const [pending, setPending] = useState(false);

  const employee = employees.find((e) => e.id === employeeId);
  const pay = calculatePay({ basic, deduction });

  const pickEmployee = (id: string) => {
    setEmployeeId(id);
    // The basic starts at their monthly salary and can be changed.
    setBasic(employees.find((e) => e.id === id)?.monthlySalary ?? "");
  };

  async function generate(replace: boolean) {
    if (pending) return;
    setPending(true);
    setErrors({});
    setPdfError(undefined);
    try {
      const reply = await send("POST", "/api/admin/payslips", { employeeId, month, basic, deduction, replace });
      if (reply.status === 401) return navigate("/login");
      if (reply.status === 201) {
        toast.success((reply.body as { done: { message: string } }).done.message);
        onDone();
      } else if (reply.status === 422) setErrors((reply.body?.errors as Errors | undefined) ?? {});
      else if (reply.status === 409 && reply.body?.confirm) setConfirm(reply.body.confirm as { employeeName: string; month: string });
      else if (typeof reply.body?.pdfError === "string") {
        setPdfError(reply.body.pdfError);
        toast.error(reply.body.pdfError);
      } else toast.error("Couldn't generate the payslip. Please try again.");
    } catch {
      toast.error("Couldn't generate the payslip. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void generate(false);
  };
  const invalid = (key: keyof Errors) => (errors[key] ? { "aria-invalid": true, "aria-describedby": `${key}-error` } : {});
  // Only show a deduction problem live once something has been typed.
  const liveError = !pay.ok && (deduction !== "" || basic !== "") ? pay.errors : {};

  return (
    <>
      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        {pdfError && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <AlertDescription>
              {pdfError}. Nothing was saved.
              {pdfError === "PDF service is not running" && " Start it with docker compose up pdf, then try again."}
            </AlertDescription>
          </Alert>
        )}
        <FormField id="employee" label="Employee" error={errors.employee}>
          <NativeSelect id="employee" className="w-full" value={employeeId} onChange={(e) => pickEmployee(e.target.value)} {...invalid("employee")}>
            <option value="">Choose an employee</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.employeeCode})
              </option>
            ))}
          </NativeSelect>
        </FormField>

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

        <FormField id="month" label="Month" error={errors.month}>
          <Input id="month" name="month" type="month" value={month} onChange={(e) => onMonth(e.target.value)} required {...invalid("month")} />
        </FormField>

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            id="basic"
            label="Basic (₹)"
            hint={employee && employee.monthlySalary == null ? "No monthly salary is set for them. Type the basic." : "Starts at their monthly salary."}
            error={errors.basic ?? liveError.basic}
          >
            <Input id="basic" name="basic" inputMode="decimal" autoComplete="off" value={basic} onChange={(e) => setBasic(e.target.value)} className="tabular-nums" required {...invalid("basic")} />
          </FormField>
          <FormField id="deduction" label="Deduction (₹)" hint="Loss of pay. Leave empty for none." error={errors.deduction ?? liveError.deduction}>
            <Input id="deduction" name="deduction" inputMode="decimal" autoComplete="off" placeholder="0" value={deduction} onChange={(e) => setDeduction(e.target.value)} className="tabular-nums" {...invalid("deduction")} />
          </FormField>
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

      <Dialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace this payslip?</DialogTitle>
            <DialogDescription>
              {confirm?.employeeName} already has a payslip for {confirm && monthLabel(confirm.month)}. Generating again replaces it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(undefined)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setConfirm(undefined);
                void generate(true);
              }}
            >
              Replace payslip
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
