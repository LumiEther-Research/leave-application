// Signed session tokens: base64url(JSON payload) + "." + HMAC-SHA256 signature.
// Only the user id and role-at-login are in the token; the server re-reads the
// user on every request, so a removed account stops working immediately.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type Role = "admin" | "employee";
/**
 * `v` fingerprints the password the session was issued under, so changing a
 * password signs out every other session. exp is unix seconds.
 */
export type SessionPayload = { sub: string; role: Role; exp: number; v: string };

/** A short, non-reversible tag for a stored password hash. Not a secret: it only has to change when the hash does. */
export const passwordFingerprint = (storedHash: string) =>
  createHash("sha256").update(storedHash).digest("hex").slice(0, 16);

const sign = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest("base64url");

export function signSession(payload: SessionPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/** The payload if the signature is valid and it hasn't expired, otherwise null. */
export function verifySession(token: string | undefined, secret: string, nowSeconds: number): SessionPayload | null {
  const [body, signature, extra] = (token ?? "").split(".");
  if (!body || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    const validRole = payload?.role === "admin" || payload?.role === "employee";
    if (
      typeof payload?.sub !== "string" ||
      !validRole ||
      typeof payload?.exp !== "number" ||
      typeof payload?.v !== "string"
    )
      return null;
    return payload.exp > nowSeconds ? (payload as SessionPayload) : null;
  } catch {
    return null;
  }
}
