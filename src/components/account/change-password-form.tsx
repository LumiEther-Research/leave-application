"use client";

import { useActionState, useEffect } from "react";
import { AlertCircle, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { changeMyPassword, type ChangePasswordState } from "@/app/account/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/leave/form-field";
import { MIN_PASSWORD_LENGTH } from "@/lib/employees";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState<ChangePasswordState, FormData>(changeMyPassword, {});

  useEffect(() => {
    if (state.changed) toast.success("Password changed", { description: "Other devices have been signed out." });
  }, [state]);

  const errors = state.errors ?? {};
  const invalid = (key: "current" | "next" | "confirm") =>
    errors[key] ? { "aria-invalid": true, "aria-describedby": `${key}-error` } : {};

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {errors.form && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{errors.form}</AlertDescription>
        </Alert>
      )}
      <FormField id="current" label="Current password" error={errors.current}>
        <Input
          id="current"
          name="current"
          type="password"
          autoComplete="current-password"
          required
          {...invalid("current")}
        />
      </FormField>
      <FormField
        id="next"
        label="New password"
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        error={errors.next}
      >
        <Input id="next" name="next" type="password" autoComplete="new-password" required {...invalid("next")} />
      </FormField>
      <FormField id="confirm" label="Confirm new password" error={errors.confirm}>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          {...invalid("confirm")}
        />
      </FormField>
      <Button type="submit" disabled={pending} className="self-start">
        <KeyRound aria-hidden />
        {pending ? "Saving…" : "Change password"}
      </Button>
    </form>
  );
}
