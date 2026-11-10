import { useRef, useState, type FormEvent } from "react";
import { useNavigate, useRevalidator } from "react-router-dom";
import { AlertCircle, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { FormField } from "@/components/leave/form-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { send } from "@/lib/api";
import { CATEGORIES, categoryLabel } from "@/lib/categories";
import { MIN_PASSWORD_LENGTH } from "@/lib/constants";

type Field = "email" | "joiningDate" | "category" | "monthlySalary" | "designation" | "password";
type Errors = Partial<Record<Field, string>>;
const EMPTY = { email: "", joiningDate: "", monthlySalary: "", designation: "" };

export function AddEmployeeForm() {
  const navigate = useNavigate();
  const { revalidate } = useRevalidator();
  const [values, setValues] = useState(EMPTY);
  const [category, setCategory] = useState("employee");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);
  const password = useRef<HTMLInputElement>(null);

  const invalid = (key: Field) => (errors[key] ? { "aria-invalid": true, "aria-describedby": `${key}-error` } : {});
  const bind = (key: keyof typeof EMPTY) => ({
    value: values[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [key]: e.target.value })),
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setErrors({});
    setFormError(undefined);
    try {
      const reply = await send("POST", "/api/admin/employees", { ...values, category, password: password.current?.value ?? "" });
      if (reply.status === 401) return navigate("/login");
      if (reply.status === 201) {
        const created = (reply.body as { created: { name: string; email: string } }).created;
        toast.success(`${created.name} added`, { description: created.email });
        setValues(EMPTY); // the chosen category stays, as in the current app
        revalidate();
      } else if (reply.status === 422) {
        setErrors((reply.body?.errors as Errors | undefined) ?? {});
      } else {
        setFormError(typeof reply.body?.error === "string" ? reply.body.error : "Couldn't add the employee. Please try again.");
      }
    } catch {
      setFormError("Couldn't add the employee. Please try again.");
    } finally {
      if (password.current) password.current.value = ""; // never kept, whatever happened
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
      <FormField id="email" label="Gmail address" error={errors.email}>
        <Input id="email" name="email" type="email" placeholder="name@gmail.com" autoComplete="off" required {...bind("email")} {...invalid("email")} />
      </FormField>
      <FormField
        id="category"
        label="Category"
        hint="Decides how many leave days they get. Set the days under Leave policy."
        error={errors.category}
      >
        <NativeSelect id="category" name="category" className="w-full" value={category} onChange={(e) => setCategory(e.target.value)} {...invalid("category")}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {categoryLabel[c]}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <FormField id="joiningDate" label="Joining date" hint="Comp-off expires on the joining anniversary." error={errors.joiningDate}>
        <Input id="joiningDate" name="joiningDate" type="date" required {...bind("joiningDate")} {...invalid("joiningDate")} />
      </FormField>
      <FormField id="designation" label="Designation" hint="Optional. Shown on their payslip." error={errors.designation}>
        <Input id="designation" name="designation" autoComplete="off" placeholder="Software Engineer" {...bind("designation")} {...invalid("designation")} />
      </FormField>
      <FormField id="monthlySalary" label="Monthly salary (₹)" hint="Optional. Becomes the basic on their payslips." error={errors.monthlySalary}>
        <Input
          id="monthlySalary"
          name="monthlySalary"
          inputMode="decimal"
          autoComplete="off"
          placeholder="16500"
          className="tabular-nums"
          {...bind("monthlySalary")}
          {...invalid("monthlySalary")}
        />
      </FormField>
      <FormField
        id="password"
        label="Temporary password"
        hint={`At least ${MIN_PASSWORD_LENGTH} characters. Share it with them directly.`}
        error={errors.password}
      >
        <Input id="password" name="password" type="text" ref={password} autoComplete="off" required {...invalid("password")} />
      </FormField>
      <Button type="submit" disabled={pending} className="self-start">
        <UserPlus aria-hidden />
        {pending ? "Adding…" : "Add employee"}
      </Button>
    </form>
  );
}
