"use client";

import { useTransition } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { publishPayslipAction } from "@/app/admin/payslips/actions";
import { Button } from "@/components/ui/button";

/** Publishes a draft payslip as it is. To add LOP first, use the form instead. */
export function PublishButton({ id, name, month }: { id: string; name: string; month: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      aria-label={`Publish ${month} payslip for ${name}`}
      onClick={() =>
        startTransition(async () => {
          const result = await publishPayslipAction(id);
          if (result.ok) toast.success(`${month} payslip published for ${name}`);
          else toast.error(result.error);
        })
      }
    >
      <Send aria-hidden />
      {pending ? "Publishing…" : "Publish"}
    </Button>
  );
}
