"use client";

import { useActionState, useEffect, useState } from "react";
import { AlertCircle, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { addEmployee, type CreateEmployeeState } from "@/app/admin/employees/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MIN_PASSWORD_LENGTH } from "@/lib/employees";
import { CATEGORIES, categoryLabel } from "@/lib/types";

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

export function AddEmployeeForm() {
  const [state, action, pending] = useActionState<CreateEmployeeState, FormData>(addEmployee, {});
  const [category, setCategory] = useState<string>(state.values?.category || "employee");

  useEffect(() => {
    if (state.created) {
      toast.success(`${state.created.name} added`, { description: state.created.email });
    }
  }, [state]);

  const errors = state.errors ?? {};
  const invalid = (key: keyof typeof errors) =>
    errors[key] ? { "aria-invalid": true, "aria-describedby": `${key}-error` } : {};

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.error && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <Field id="email" label="Gmail address" error={errors.email}>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="name@gmail.com"
          autoComplete="off"
          defaultValue={state.values?.email}
          required
          {...invalid("email")}
        />
      </Field>
      <Field
        id="category"
        label="Category"
        hint="Decides how many leave days they get. Set the days under Leave policy."
        error={errors.category}
      >
        <Select name="category" value={category} onValueChange={(v) => v && setCategory(v)}>
          <SelectTrigger id="category" className="w-full" {...invalid("category")}>
            <SelectValue>{categoryLabel[category as keyof typeof categoryLabel]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {categoryLabel[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field
        id="joiningDate"
        label="Joining date"
        hint="Comp-off expires on the joining anniversary."
        error={errors.joiningDate}
      >
        <Input
          id="joiningDate"
          name="joiningDate"
          type="date"
          defaultValue={state.values?.joiningDate}
          required
          {...invalid("joiningDate")}
        />
      </Field>
      <Field
        id="password"
        label="Temporary password"
        hint={`At least ${MIN_PASSWORD_LENGTH} characters. Share it with them directly.`}
        error={errors.password}
      >
        <Input id="password" name="password" type="text" autoComplete="off" required {...invalid("password")} />
      </Field>
      <Button type="submit" disabled={pending} className="self-start">
        <UserPlus aria-hidden />
        {pending ? "Adding…" : "Add employee"}
      </Button>
    </form>
  );
}
