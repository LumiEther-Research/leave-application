// Who can sign in, and checking a password. No cookies here, so it can be tested.
import { nameFromEmail } from "../employees";
import {
  countAdmins,
  createAdmin,
  deleteAdmin,
  findAdminByEmail,
  findAdminById,
  findEmployeeByEmail,
  findEmployeeById,
  isEmailTaken,
  listAdmins,
  type Admin,
} from "../store";
import { isUniqueViolation } from "../db";
import { DUMMY_HASH, isPasswordHash, verifyPassword } from "./password";
import type { Role } from "./token";

export type SessionUser = { id: string; name: string; email: string; role: Role };

export type { Admin };
export { listAdmins };

const adminUser = (a: Admin): SessionUser => ({ id: a.id, name: a.name, email: a.email, role: "admin" });

/** The stored password hash for a signed-in user, or "" if there isn't one. */
export async function credentialHashFor(user: SessionUser): Promise<string> {
  const account = user.role === "admin" ? await findAdminById(user.id) : await findEmployeeById(user.id);
  return account?.passwordHash ?? "";
}

/**
 * Why a sign-in failed. For server logs only: the browser always gets the same
 * generic message, so none of these may be shown to the user.
 */
export type AuthFailure =
  | "unknown-email"
  | "admin-not-configured"
  | "bootstrap-closed"
  | "missing-admin-hash"
  | "malformed-admin-hash"
  | "wrong-password";

export type AuthResult = { ok: true; user: SessionUser } | { ok: false; reason: AuthFailure };

/**
 * ADMIN_EMAIL and ADMIN_PASSWORD_HASH are only a bootstrap: while the database has no admins at
 * all, they let the first admin sign in, and that admin is then saved as an ordinary admin row.
 * Once any admin exists they're ignored, so removing or changing admins in the app is final.
 */
async function bootstrapAdmin(email: string, password: string): Promise<AuthResult> {
  const envEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!envEmail) return { ok: false, reason: "admin-not-configured" };
  if (email !== envEmail) return { ok: false, reason: "unknown-email" };
  if ((await countAdmins()) > 0) return { ok: false, reason: "bootstrap-closed" };

  const hash = process.env.ADMIN_PASSWORD_HASH;
  const ok = await verifyPassword(password, hash || DUMMY_HASH);
  if (!hash) return { ok: false, reason: "missing-admin-hash" };
  if (!isPasswordHash(hash)) return { ok: false, reason: "malformed-admin-hash" };
  if (!ok) return { ok: false, reason: "wrong-password" };

  try {
    return { ok: true, user: adminUser(await createAdmin({ name: nameFromEmail(email), email, passwordHash: hash })) };
  } catch (error) {
    // Two first sign-ins at the same moment: the other one created the row.
    if (!isUniqueViolation(error)) throw error;
    const existing = await findAdminByEmail(email);
    return existing ? { ok: true, user: adminUser(existing) } : { ok: false, reason: "unknown-email" };
  }
}

/** Every path does one password check, so timing doesn't reveal which emails exist. */
export async function authenticate(email: string, password: string): Promise<AuthResult> {
  const normalized = email.trim().toLowerCase();

  const admin = await findAdminByEmail(normalized);
  if (admin) {
    const ok = await verifyPassword(password, admin.passwordHash);
    return ok ? { ok: true, user: adminUser(admin) } : { ok: false, reason: "wrong-password" };
  }

  const employee = await findEmployeeByEmail(normalized);
  const ok = await verifyPassword(password, employee?.passwordHash ?? DUMMY_HASH);
  if (employee) {
    if (!ok) return { ok: false, reason: "wrong-password" };
    return { ok: true, user: { id: employee.id, name: employee.name, email: employee.email, role: "employee" } };
  }
  return bootstrapAdmin(normalized, password);
}

/** True if this email is an admin's or an employee's, or is the bootstrap ADMIN_EMAIL. */
export async function isEmailInUse(email: string): Promise<boolean> {
  const envEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  return email.trim().toLowerCase() === envEmail || (await isEmailTaken(email));
}

/**
 * Removes an admin. They're signed out straight away, because a session is looked up on every
 * request. Nobody can remove themselves, and the last admin can't be removed.
 */
export async function removeAdmin(
  actor: SessionUser,
  targetId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (actor.id === targetId) return { ok: false, error: "You can't remove your own admin account." };
  const admins = await listAdmins();
  if (!admins.some((a) => a.id === targetId)) return { ok: false, error: "That admin no longer exists." };
  if (admins.length <= 1) return { ok: false, error: "There has to be at least one admin." };
  return deleteAdmin(actor.id, targetId); // the database enforces the last-admin rule again
}
