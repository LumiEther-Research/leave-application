import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, LogIn } from "lucide-react";
import { RunnerLoader } from "@/components/layout/runner-loader";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { homeFor, send, type SessionUser } from "@/lib/api";

/** The only thing the browser ever hears about a failed sign-in: wrong password, unknown email, server down, anything. */
export const FAILED = "Incorrect email or password.";

export function LoginForm() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const password = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setFailed(false);
    let user: SessionUser | undefined;
    try {
      const reply = await send("POST", "/api/auth/login", { email, password: password.current?.value ?? "" });
      user = reply.status === 200 ? (reply.body as { user?: SessionUser } | null)?.user : undefined;
    } catch {
      user = undefined; // network failure: same message
    }
    if (!user) {
      // The email stays as typed; the password field is emptied, as in the current app.
      if (password.current) password.current.value = "";
      setFailed(true);
      setPending(false);
      return;
    }
    // The server set the HttpOnly cookie. Nothing is read or kept here; the next page asks /api/auth/me.
    navigate(homeFor(user.role), { replace: true });
  }

  return (
    <>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {failed && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <AlertDescription>{FAILED}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
            autoFocus
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" ref={password} autoComplete="current-password" required />
        </div>
        <Button type="submit" size="lg" disabled={pending}>
          <LogIn aria-hidden />
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      {pending && (
        <div className="fixed inset-0 z-50">
          <RunnerLoader />
        </div>
      )}
    </>
  );
}
