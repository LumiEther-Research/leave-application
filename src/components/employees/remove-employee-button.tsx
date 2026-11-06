"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { removeEmployee } from "@/app/admin/employees/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** Removes an employee for good, after a confirmation that says what goes with them. */
export function RemoveEmployeeButton({ employeeId, name, email }: { employeeId: string; name: string; email: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await removeEmployee(employeeId);
      if (result.ok) {
        toast.success(`${name} was removed`, { description: email });
        setOpen(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="text-rejected hover:bg-rejected-surface hover:text-rejected"
            aria-label={`Remove ${name}`}
          />
        }
      >
        <Trash2 aria-hidden />
        Remove
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {name}?</DialogTitle>
          <DialogDescription>
            {email} is signed out straight away and cannot sign in again. Their leave, comp-off, permissions and payslips
            are deleted for good. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Keep employee</DialogClose>
          <Button variant="destructive" onClick={confirm} disabled={isPending}>
            {isPending ? "Removing…" : "Remove employee"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
