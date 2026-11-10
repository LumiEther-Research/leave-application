import { useState } from "react";
import { useNavigate, useRevalidator } from "react-router-dom";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { send } from "@/lib/api";

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
  const [pending, setPending] = useState(false);
  const navigate = useNavigate();
  const { revalidate } = useRevalidator();

  async function decide(decision: "approved" | "rejected") {
    setPending(true);
    try {
      const reply = await send("POST", `/api/admin/requests/${encodeURIComponent(requestId)}/decision`, { decision });
      if (reply.status === 401) return navigate("/login");
      if (reply.status === 200) {
        toast.success(`${type} ${decision} for ${personName.split(" ")[0]}`, { description: detail });
        revalidate();
      } else {
        toast.error("Couldn't update the request. It may have already been handled.");
        revalidate();
      }
    } catch {
      toast.error("Couldn't update the request. It may have already been handled.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex shrink-0 gap-2 pl-11 sm:pl-0">
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        className="text-rejected hover:bg-rejected-surface hover:text-rejected"
        onClick={() => decide("rejected")}
        aria-label={`Reject ${type} for ${personName}`}
      >
        <X aria-hidden />
        {rejectLabel}
      </Button>
      <Button size="sm" disabled={pending} onClick={() => decide("approved")} aria-label={`Approve ${type} for ${personName}`}>
        <Check aria-hidden />
        Approve
      </Button>
    </div>
  );
}
