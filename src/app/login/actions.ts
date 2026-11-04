"use server";

import { redirect } from "next/navigation";
import { endSession, homeFor, SessionConfigError, startSession } from "@/lib/auth/session";
import { authenticate } from "@/lib/auth/users";

export type LoginState = { error?: string; email?: string };

/** The only thing the browser ever hears about a failed sign-in. */
const FAILED = "Incorrect email or password.";

/** The real reason goes to the server log only. Never the password, never sent to the client. */
const logFailure = (reason: string) => console.warn(`[auth] sign-in failed: ${reason}`);

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  // `email` is sent back so the field keeps what was typed.
  if (!email.trim() || !password) {
    logFailure("empty-input");
    return { error: FAILED, email };
  }

  let result: Awaited<ReturnType<typeof authenticate>>;
  try {
    result = await authenticate(email, password);
  } catch (error) {
    // The database is unreachable or not configured. The browser still gets the generic message.
    logFailure(`database-error (${error instanceof Error ? error.message : "unknown"})`);
    return { error: FAILED, email };
  }
  if (!result.ok) {
    logFailure(result.reason);
    return { error: FAILED, email };
  }

  try {
    await startSession(result.user);
  } catch (error) {
    if (!(error instanceof SessionConfigError)) throw error;
    logFailure("missing-secret (SESSION_SECRET is unset or shorter than 32 characters)");
    return { error: FAILED, email };
  }
  redirect(homeFor(result.user.role));
}

export async function logout() {
  await endSession();
  redirect("/login");
}
