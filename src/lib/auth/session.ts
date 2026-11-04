// Sessions and role checks. Server only: reads and writes the session cookie.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { findAdminById, findEmployeeById } from "../store";
import { credentialHashFor, type SessionUser } from "./users";
import { passwordFingerprint, signSession, verifySession, type Role } from "./token";

export type { Role, SessionUser };

const COOKIE = "session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export const homeFor = (role: Role) => (role === "admin" ? "/admin" : "/employee");

/** Thrown when signing in is attempted without a usable SESSION_SECRET. */
export class SessionConfigError extends Error {}

/** The signing secret, or undefined if it's missing or too short. */
function getSecret(): string | undefined {
  const value = process.env.SESSION_SECRET;
  return value && value.length >= 32 ? value : undefined;
}

export async function startSession(user: SessionUser) {
  const secret = getSecret();
  if (!secret) throw new SessionConfigError("SESSION_SECRET must be set to a random string of at least 32 characters.");
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  const v = passwordFingerprint(await credentialHashFor(user));
  const token = signSession({ sub: user.id, role: user.role, exp, v }, secret);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

/**
 * The signed-in user, looked up fresh from the store, or null. The role comes
 * from the account, not the cookie. Without a SESSION_SECRET nobody can be
 * signed in, so this is null (the page redirects to /login) rather than an error.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  // The session is per request, so this must never run while prerendering (`dynamic = "force-dynamic"`
  // isn't allowed with cacheComponents). Waiting for the request first makes that explicit, keeps
  // Date.now() below request-time, and applies with or without a SESSION_SECRET at build time.
  await connection();
  const token = (await cookies()).get(COOKIE)?.value;
  const secret = getSecret();
  if (!secret) return null;
  const payload = verifySession(token, secret, Math.floor(Date.now() / 1000));
  if (!payload) return null;

  let user: SessionUser | null = null;
  if (payload.role === "admin") {
    const admin = await findAdminById(payload.sub);
    user = admin ? { id: admin.id, name: admin.name, email: admin.email, role: "admin" } : null;
  } else {
    const employee = await findEmployeeById(payload.sub);
    user = employee ? { id: employee.id, name: employee.name, email: employee.email, role: "employee" } : null;
  }
  if (!user) return null;

  // A session only lasts until its password changes.
  return payload.v === passwordFingerprint(await credentialHashFor(user)) ? user : null;
}

/**
 * Call at the top of every protected page and server action. Signed out goes to
 * /login, and the wrong role goes to their own home.
 */
export async function requireRole(role: Role): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== role) redirect(homeFor(user.role));
  return user;
}
