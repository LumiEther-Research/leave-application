import { useState } from "react";
import { useNavigate, useRevalidator } from "react-router-dom";
import { toast } from "sonner";
import { NativeSelect } from "@/components/ui/native-select";
import { send } from "@/lib/api";
import { CATEGORIES, categoryLabel, type Category } from "@/lib/categories";

/** Changes an employee's category right from the list. Shows the new value at once and puts it back if the server refuses. */
export function CategorySelect({ employeeId, name, value }: { employeeId: string; name: string; value: string }) {
  const [current, setCurrent] = useState(value);
  const [pending, setPending] = useState(false);
  const navigate = useNavigate();
  const { revalidate } = useRevalidator();

  async function change(next: string) {
    if (!next || next === current) return;
    const previous = current;
    setCurrent(next);
    setPending(true);
    try {
      const reply = await send("PATCH", `/api/admin/employees/${encodeURIComponent(employeeId)}/category`, { category: next });
      if (reply.status === 401) return navigate("/login");
      if (reply.status === 200) {
        toast.success(`${name} is now a ${categoryLabel[next as Category].toLowerCase()}`);
        revalidate();
      } else {
        setCurrent(previous);
        toast.error(typeof reply.body?.error === "string" ? reply.body.error : "Couldn't change the category. Please try again.");
      }
    } catch {
      setCurrent(previous);
      toast.error("Couldn't change the category. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <NativeSelect size="sm" className="w-32" aria-label={`Category for ${name}`} value={current} disabled={pending} onChange={(e) => change(e.target.value)}>
      {CATEGORIES.map((c) => (
        <option key={c} value={c}>
          {categoryLabel[c]}
        </option>
      ))}
    </NativeSelect>
  );
}
