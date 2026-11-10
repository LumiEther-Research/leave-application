import { useState } from "react";
import { useNavigate, useRevalidator } from "react-router-dom";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
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
import { send } from "@/lib/api";

/** Removes an employee for good, after a confirmation that says what goes with them. */
export function RemoveEmployeeButton({ employeeId, name, email }: { employeeId: string; name: string; email: string }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const navigate = useNavigate();
  const { revalidate } = useRevalidator();

  async function confirm() {
    setPending(true);
    try {
      const reply = await send("DELETE", `/api/admin/employees/${encodeURIComponent(employeeId)}`);
      if (reply.status === 401) return navigate("/login");
      if (reply.status === 200) {
        toast.success(`${name} was removed`, { description: email });
        setOpen(false);
        revalidate();
      } else {
        toast.error(typeof reply.body?.error === "string" ? reply.body.error : "Couldn't remove the employee. Please try again.");
      }
    } catch {
      toast.error("Couldn't remove the employee. Please try again.");
    } finally {
      setPending(false);
    }
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
          <Button variant="destructive" onClick={confirm} disabled={pending}>
            {pending ? "Removing…" : "Remove employee"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
