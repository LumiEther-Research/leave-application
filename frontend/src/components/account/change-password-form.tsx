import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { FormField } from "@/components/leave/form-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { send } from "@/lib/api";
import { MIN_PASSWORD_LENGTH } from "@/lib/constants";

type Key = "current" | "next" | "confirm";
type Errors = Partial<Record<Key | "form", string>>;

export function ChangePasswordForm() {
  const navigate = useNavigate();
  const form = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);

  const invalid = (key: Key) => (errors[key] ? { "aria-invalid": true, "aria-describedby": `${key}-error` } : {});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const text = (k: Key) => String(data.get(k) ?? "");
    setPending(true);
    setErrors({});
    try {
      const reply = await send("POST", "/api/account/password", { current: text("current"), next: text("next"), confirm: text("confirm") });
      if (reply.status === 401) return navigate("/login");
      if (reply.status === 200) {
        toast.success("Password changed", { description: "Other devices have been signed out." });
      } else if (reply.status === 422) {
        setErrors((reply.body?.errors as Errors | undefined) ?? {});
      } else {
        setErrors({ form: "Couldn't change the password. Please try again." });
      }
    } catch {
      setErrors({ form: "Couldn't change the password. Please try again." });
    } finally {
      form.current?.reset(); // every field is emptied after each submit, as the current app's form does
      setPending(false);
    }
  }

  return (
    <form ref={form} onSubmit={submit} className="flex flex-col gap-5" noValidate>
      {errors.form && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{errors.form}</AlertDescription>
        </Alert>
      )}
      <FormField id="current" label="Current password" error={errors.current}>
        <Input id="current" name="current" type="password" autoComplete="current-password" required {...invalid("current")} />
      </FormField>
      <FormField id="next" label="New password" hint={`At least ${MIN_PASSWORD_LENGTH} characters.`} error={errors.next}>
        <Input id="next" name="next" type="password" autoComplete="new-password" required {...invalid("next")} />
      </FormField>
      <FormField id="confirm" label="Confirm new password" error={errors.confirm}>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required {...invalid("confirm")} />
      </FormField>
      <Button type="submit" disabled={pending} className="self-start">
        <KeyRound aria-hidden />
        {pending ? "Saving…" : "Change password"}
      </Button>
    </form>
  );
}
