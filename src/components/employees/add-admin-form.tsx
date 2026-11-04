"use client";

import { useActionState, useEffect } from "react";
import { AlertCircle, ShieldPlus } from "lucide-react";
import { toast } from "sonner";
import { addAdmin, type CreateAdminState } from "@/app/admin/admins/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/leave/form-field";
import { MIN_PASSWORD_LENGTH } from "@/lib/employees";

export function AddAdminForm() {
  const [state, action, pending] = useActionState<CreateAdminState, FormData>(addAdmin, {});

  useEffect(() => {
    if (state.created) toast.success(`${state.created.name} is now an admin`, { description: state.created.email });
  }, [state]);

  const errors = state.errors ?? {};
  const invalid = (key: "email" | "password") =>
    errors[key] ? { "aria-invalid": true, "aria-describedby": `${key}-error` } : {};

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.error && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <FormField id="email" label="Email address" error={errors.email}>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="name@company.com"
          autoComplete="off"
          defaultValue={state.values?.email}
          required
          {...invalid("email")}
        />
      </FormField>
      <FormField
        id="password"
        label="Temporary password"
        hint={`At least ${MIN_PASSWORD_LENGTH} characters. Share it with them directly; they can change it after signing in.`}
        error={errors.password}
      >
        <Input id="password" name="password" type="text" autoComplete="off" required {...invalid("password")} />
      </FormField>
      <Button type="submit" disabled={pending} className="self-start">
        <ShieldPlus aria-hidden />
        {pending ? "Adding…" : "Add admin"}
      </Button>
    </form>
  );
}
