"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { changeEmployeeCategory } from "@/app/admin/employees/actions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CATEGORIES, categoryLabel, type Category } from "@/lib/types";

/** Changes an employee's category right from the list. */
export function CategorySelect({ employeeId, name, value }: { employeeId: string; name: string; value: Category }) {
  const [current, setCurrent] = useState<Category>(value);
  const [isPending, startTransition] = useTransition();

  function change(next: string | null) {
    if (!next || next === current) return;
    const previous = current;
    setCurrent(next as Category);
    startTransition(async () => {
      const result = await changeEmployeeCategory(employeeId, next);
      if (result.ok) {
        toast.success(`${name} is now a ${categoryLabel[next as Category].toLowerCase()}`);
      } else {
        setCurrent(previous);
        toast.error(result.error);
      }
    });
  }

  return (
    <Select value={current} onValueChange={change} disabled={isPending}>
      <SelectTrigger size="sm" className="w-32" aria-label={`Category for ${name}`}>
        <SelectValue>{categoryLabel[current]}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {CATEGORIES.map((c) => (
          <SelectItem key={c} value={c}>
            {categoryLabel[c]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
