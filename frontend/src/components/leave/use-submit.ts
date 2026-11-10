import { useState } from "react";
import { useNavigate, useRevalidator } from "react-router-dom";
import { send } from "@/lib/api";

export type SubmitState<V extends Record<string, string>> = {
  errors: Partial<Record<keyof V | "form", string>>;
  /** what the server says to keep in the fields after a refusal */
  values?: Partial<V>;
};

/**
 * Posts a form to the backend: 201 means done, 422 hands back a message per field, anything else is the generic failure.
 * A 401 means the session ended, so the person goes to /login. The page's data is reloaded after a success.
 */
export function useSubmit<V extends Record<string, string>, S = unknown>(path: string, failure: string) {
  const navigate = useNavigate();
  const { revalidate } = useRevalidator();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<SubmitState<V>["errors"]>({});

  async function submit(body: unknown): Promise<{ ok: true; result: S } | { ok: false; values?: Partial<V> }> {
    if (pending) return { ok: false };
    setPending(true);
    setErrors({});
    try {
      const reply = await send("POST", path, body);
      if (reply.status === 401) {
        navigate("/login");
        return { ok: false };
      }
      if (reply.status === 201) {
        revalidate();
        return { ok: true, result: (reply.body as Record<string, S>).submitted ?? (reply.body as Record<string, S>).logged };
      }
      if (reply.status === 422) {
        setErrors((reply.body?.errors as SubmitState<V>["errors"]) ?? {});
        return { ok: false, values: reply.body?.values as Partial<V> | undefined };
      }
      setErrors({ form: typeof reply.body?.error === "string" ? reply.body.error : failure } as SubmitState<V>["errors"]);
    } catch {
      setErrors({ form: failure } as SubmitState<V>["errors"]);
    } finally {
      setPending(false);
    }
    return { ok: false };
  }

  return { submit, pending, errors };
}
