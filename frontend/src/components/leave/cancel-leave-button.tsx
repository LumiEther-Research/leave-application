import { useState } from "react";
import { useNavigate, useRevalidator } from "react-router-dom";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { send } from "@/lib/api";

type Props = {
  requestId: string;
  /** "withdraw" for pending leave (immediate), "request" for approved leave (needs an admin) */
  action: "withdraw" | "request";
  /** e.g. "16–18 Nov" */
  dates: string;
};

export function CancelLeaveButton({ requestId, action, dates }: Props) {
  const [pending, setPending] = useState(false);
  const navigate = useNavigate();
  const { revalidate } = useRevalidator();
  const label = action === "withdraw" ? "Withdraw" : "Cancel leave";

  async function cancel() {
    setPending(true);
    try {
      const reply = await send("POST", `/api/employee/leave/${encodeURIComponent(requestId)}/cancel`);
      if (reply.status === 401) return navigate("/login");
      if (reply.status !== 200) {
        toast.error(typeof reply.body?.error === "string" ? reply.body.error : "Couldn't cancel. Please try again.");
      } else if (reply.body?.action === "withdraw") {
        toast.success("Leave withdrawn", { description: dates });
      } else {
        toast.success("Cancellation requested", { description: `${dates} · waiting for approval` });
      }
      revalidate();
    } catch {
      toast.error("Couldn't cancel. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Button variant="outline" size="sm" disabled={pending} onClick={cancel} aria-label={`${label}, ${dates}`}>
      <Undo2 aria-hidden />
      {pending ? "Sending…" : label}
    </Button>
  );
}
