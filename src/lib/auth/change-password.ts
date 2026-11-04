// Changing your own password. No cookies here, so it can be tested.
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "../employees";
import { setAdminPasswordHash, setEmployeePasswordHash } from "../store";
import { hashPassword, verifyPassword } from "./password";
import { credentialHashFor, type SessionUser } from "./users";

export type PasswordChangeInput = { current: string; next: string; confirm: string };
export type PasswordChangeErrors = Partial<Record<keyof PasswordChangeInput | "form", string>>;

/** Checks only what can be checked without the stored hash. */
export function validatePasswordChange(input: PasswordChangeInput): PasswordChangeErrors {
  const errors: PasswordChangeErrors = {};
  if (!input.current) errors.current = "Enter your current password.";
  if (input.next.length < MIN_PASSWORD_LENGTH) errors.next = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  else if (input.next.length > MAX_PASSWORD_LENGTH) errors.next = `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  else if (input.next === input.current) errors.next = "Choose a password you aren't already using.";
  if (!errors.next && input.confirm !== input.next) errors.confirm = "The two new passwords don't match.";
  return errors;
}

export async function changePassword(
  user: SessionUser,
  input: PasswordChangeInput,
): Promise<{ ok: true } | { ok: false; errors: PasswordChangeErrors }> {
  const errors = validatePasswordChange(input);
  // Always check the current password, so the wrong one is reported alongside other problems.
  if (input.current && !(await verifyPassword(input.current, await credentialHashFor(user)))) {
    errors.current = "That isn't your current password.";
  }
  if (Object.keys(errors).length) return { ok: false, errors };

  const hash = await hashPassword(input.next);
  const saved =
    user.role === "admin" ? await setAdminPasswordHash(user.id, hash) : await setEmployeePasswordHash(user.id, hash);
  if (!saved) {
    return { ok: false, errors: { form: "Your account no longer exists." } };
  }
  return { ok: true };
}
