"use client";

import { useState, useTransition } from "react";
import { UserMinus } from "lucide-react";
import { toast } from "sonner";
import { removeAdmin } from "@/app/admin/admins/actions";
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

type Props = {
  adminId: string;
  name: string;
  email: string;
};

export function RemoveAdminButton({ adminId, name, email }: Props) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await removeAdmin(adminId);
      if (result.ok) {
        toast.success(`${name} is no longer an admin`, { description: email });
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
          <Button variant="destructive" onClick={confirm} disabled={isPending}>
            {isPending ? "Removing…" : "Remove admin"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
