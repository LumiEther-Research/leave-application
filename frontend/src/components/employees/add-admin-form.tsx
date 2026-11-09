import { useRef, useState, type FormEvent } from "react";
import { useNavigate, useRevalidator } from "react-router-dom";
import { AlertCircle, ShieldPlus } from "lucide-react";
import { toast } from "sonner";
import { FormField } from "@/components/leave/form-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { send } from "@/lib/api";
import { MIN_PASSWORD_LENGTH } from "@/lib/constants";

type Errors = { email?: string; password?: string };

export function AddAdminForm() {
  const navigate = useNavigate();
  const { revalidate } = useRevalidator();
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);
  const password = useRef<HTMLInputElement>(null);

  const invalid = (key: keyof Errors) => (errors[key] ? { "aria-invalid": true, "aria-describedby": `${key}-error` } : {});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setErrors({});
    setFormError(undefined);
    try {
      const reply = await send("POST", "/api/admin/admins", { email, password: password.current?.value ?? "" });
      if (reply.status === 401) return navigate("/login");
      if (reply.status === 201) {
        const created = (reply.body as { created: { name: string; email: string } }).created;
        toast.success(`${created.name} is now an admin`, { description: created.email });
        setEmail("");
        revalidate();
      } else if (reply.status === 422) {
        setErrors((reply.body?.errors as Errors | undefined) ?? {});
      } else {
        setFormError(typeof reply.body?.error === "string" ? reply.body.error : "Couldn't add the admin. Please try again.");
      }
    } catch {
      setFormError("Couldn't add the admin. Please try again.");
    } finally {
      if (password.current) password.current.value = ""; // the form resets after every submit, as in the current app
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      {formError && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}
      <FormField id="email" label="Email address" error={errors.email}>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="name@company.com"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
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
        <Input id="password" name="password" type="text" ref={password} autoComplete="off" required {...invalid("password")} />
      </FormField>
      <Button type="submit" disabled={pending} className="self-start">
        <ShieldPlus aria-hidden />
        {pending ? "Adding…" : "Add admin"}
      </Button>
    </form>
  );
}
