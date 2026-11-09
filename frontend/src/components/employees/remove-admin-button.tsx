import { useState } from "react";
import { useNavigate, useRevalidator } from "react-router-dom";
import { UserMinus } from "lucide-react";
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

type Props = { adminId: string; name: string; email: string };

export function RemoveAdminButton({ adminId, name, email }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const navigate = useNavigate();
  const { revalidate } = useRevalidator();

  async function confirm() {
    setPending(true);
    try {
      const reply = await send("DELETE", `/api/admin/admins/${encodeURIComponent(adminId)}`);
      if (reply.status === 401) return navigate("/login");
      if (reply.status === 200) {
        toast.success(`${name} is no longer an admin`, { description: email });
        setOpen(false);
        revalidate();
      } else {
        // The backend's own words: "You can't remove your own admin account.", "...the last admin..."
        toast.error(typeof reply.body?.error === "string" ? reply.body.error : "Couldn't remove the admin. Please try again.");
      }
    } catch {
      toast.error("Couldn't remove the admin. Please try again.");
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
            aria-label={`Remove ${name} as admin`}
          />
        }
      >
        <UserMinus aria-hidden />
        Remove
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {name} as admin?</DialogTitle>
          <DialogDescription>{email} will be signed out straight away and lose all admin access.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Keep admin</DialogClose>
          <Button variant="destructive" onClick={confirm} disabled={pending}>
            {pending ? "Removing…" : "Remove admin"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
