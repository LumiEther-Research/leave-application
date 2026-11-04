// Password hashing with Node's built-in scrypt, so no extra package is needed.
// Stored as "scrypt:<salt>:<hash>" (base64url). The separator is ":" because
// "$" gets expanded inside .env files.
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const PREFIX = "scrypt";

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `${PREFIX}:${salt.toString("base64url")}:${key.toString("base64url")}`;
}

/** Whether `stored` looks like a hash made by hashPassword ("scrypt:<salt>:<hash>"), whatever the password. */
export function isPasswordHash(stored: string | undefined): boolean {
  const [prefix, salt, key, extra] = (stored ?? "").split(":");
  return (
    prefix === PREFIX && !!salt && !!key && extra === undefined && Buffer.from(key, "base64url").length === KEY_LENGTH
  );
}

/** False for a wrong password and for anything that isn't a valid stored hash. */
export async function verifyPassword(password: string, stored: string | undefined): Promise<boolean> {
  const [prefix, saltPart, keyPart, extra] = (stored ?? "").split(":");
  if (prefix !== PREFIX || !saltPart || !keyPart || extra !== undefined) return false;
  const expected = Buffer.from(keyPart, "base64url");
  if (expected.length !== KEY_LENGTH) return false;
  const actual = await derive(password, Buffer.from(saltPart, "base64url"));
  return timingSafeEqual(actual, expected);
}

/** A valid-looking hash nobody has the password for, checked when the email is unknown so timing doesn't reveal it. */
export const DUMMY_HASH = `${PREFIX}:${Buffer.alloc(16).toString("base64url")}:${Buffer.alloc(KEY_LENGTH).toString("base64url")}`;
