"use client";

import { useTransition } from "react";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { decideRequest } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";

type Props = {
  requestId: string;
  personName: string;
  /** e.g. "Casual leave" */
  type: string;
  /** e.g. "16–18 Nov · 3 days" */
  detail: string;
  /** Rejecting a cancellation keeps the leave, so it reads "Keep leave" */
  rejectLabel?: string;
};

export function DecisionButtons({ requestId, personName, type, detail, rejectLabel = "Reject" }: Props) {
  const [isPending, startTransition] = useTransition();

  function decide(decision: "approved" | "rejected") {
    startTransition(async () => {
      const result = await decideRequest(requestId, decision);
      if (result.ok) {
        toast.success(`${type} ${decision} for ${personName.split(" ")[0]}`, { description: detail });
      } else {
        toast.error("Couldn't update the request. It may have already been handled.");
      }
    });
  }

  return (
    <div className="flex shrink-0 gap-2 pl-11 sm:pl-0">
      <Button
        variant="outline"
        size="sm"
        disabled={isPending}
        className="text-rejected hover:bg-rejected-surface hover:text-rejected"
        onClick={() => decide("rejected")}
        aria-label={`Reject ${type} for ${personName}`}
      >
        <X aria-hidden />
        {rejectLabel}
      </Button>
      <Button
        size="sm"
        disabled={isPending}
        onClick={() => decide("approved")}
        aria-label={`Approve ${type} for ${personName}`}
      >
        <Check aria-hidden />
        Approve
      </Button>
    </div>
  );
}
