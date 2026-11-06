"use client";

import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { updateEmployeePayroll } from "@/app/admin/employees/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PayrollErrors } from "@/lib/employees";

/** Opens a small form to change an employee's monthly salary and designation. Admin only (the action checks). */
export function EditPayrollButton({
  employeeId,
  name,
  monthlySalary,
  designation,
}: {
  employeeId: string;
  name: string;
  /** plain "16500.00", or "" if not set */
  monthlySalary: string;
  designation: string;
}) {
  const [open, setOpen] = useState(false);
  const [salary, setSalary] = useState(monthlySalary);
  const [title, setTitle] = useState(designation);
  const [errors, setErrors] = useState<PayrollErrors>({});
  const [pending, startTransition] = useTransition();

  function save(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await updateEmployeePayroll(employeeId, { monthlySalary: salary, designation: title });
      if (result.ok) {
        toast.success(`${name}'s payroll details saved`);
        setOpen(false);
      } else if (result.errors) setErrors(result.errors);
      else toast.error(result.error ?? "Couldn't save. Please try again.");
    });
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        aria-label={`Edit salary and designation for ${name}`}
        onClick={() => {
          setSalary(monthlySalary);
          setTitle(designation);
          setErrors({});
          setOpen(true);
        }}
      >
        <Pencil aria-hidden />
        Edit
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={save} noValidate className="flex flex-col gap-5">
            <DialogHeader>
              <DialogTitle>Payroll details for {name}</DialogTitle>
              <DialogDescription>Shown on their payslips. Leave a field empty to clear it.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`designation-${employeeId}`}>Designation</Label>
              <Input
                id={`designation-${employeeId}`}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoComplete="off"
                aria-invalid={!!errors.designation}
              />
              {errors.designation && <p className="text-xs text-destructive">{errors.designation}</p>}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`salary-${employeeId}`}>Monthly salary (₹)</Label>
              <Input
                id={`salary-${employeeId}`}
                value={salary}
                onChange={(e) => setSalary(e.target.value)}
                inputMode="decimal"
                autoComplete="off"
                className="tabular-nums"
                aria-invalid={!!errors.monthlySalary}
              />
              {errors.monthlySalary && <p className="text-xs text-destructive">{errors.monthlySalary}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
