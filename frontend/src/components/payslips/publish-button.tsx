import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { send } from "@/lib/api";

/** Publishes a draft payslip as it is. To add LOP first, use the form instead. */
export function PublishButton({ id, name, month, onDone }: { id: string; name: string; month: string; onDone: () => void }) {
  const [pending, setPending] = useState(false);
  const navigate = useNavigate();

  async function publish() {
    setPending(true);
    try {
      const reply = await send("POST", `/api/admin/payslips/${encodeURIComponent(id)}/publish`);
      if (reply.status === 401) return navigate("/login");
      if (reply.status === 200) toast.success(`${month} payslip published for ${name}`);
      else toast.error(typeof reply.body?.error === "string" ? reply.body.error : "Couldn't publish. Please try again.");
      onDone();
    } catch {
      toast.error("Couldn't publish. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Button size="sm" disabled={pending} aria-label={`Publish ${month} payslip for ${name}`} onClick={publish}>
      <Send aria-hidden />
      {pending ? "Publishing…" : "Publish"}
    </Button>
  );
}
