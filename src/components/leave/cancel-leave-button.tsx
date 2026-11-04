"use client";

import { useTransition } from "react";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";
import { cancelLeave } from "@/app/employee/actions";
import { Button } from "@/components/ui/button";

type Props = {
  requestId: string;
  /** "withdraw" for pending leave (immediate), "request" for approved leave (needs an admin) */
  action: "withdraw" | "request";
  /** e.g. "16–18 Nov" */
  dates: string;
};

export function CancelLeaveButton({ requestId, action, dates }: Props) {
  const [isPending, startTransition] = useTransition();
  const label = action === "withdraw" ? "Withdraw" : "Cancel leave";

  function cancel() {
    startTransition(async () => {
      const result = await cancelLeave(requestId);
      if (!result.ok) {
        toast.error(result.error);
      } else if (result.action === "withdraw") {
        toast.success("Leave withdrawn", { description: dates });
      } else {
        toast.success("Cancellation requested", { description: `${dates} · waiting for approval` });
      }
    });
  }

  return (
    <Button variant="outline" size="sm" disabled={isPending} onClick={cancel} aria-label={`${label}, ${dates}`}>
      <Undo2 aria-hidden />
      {isPending ? "Sending…" : label}
    </Button>
  );
}
