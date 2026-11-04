// Run with `npm test`. Pure logic, no database: password hashing, session tokens, and
// validation of new employees, new admins and password changes. The database-backed
// parts (sign-in, admins, requests) are in src/lib/store.test.ts.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { describe, test } from "node:test";
import { nameFromEmail, validateNewAdmin, validateNewEmployee } from "../employees";
import { DUMMY_HASH, hashPassword, verifyPassword } from "./password";
import { passwordFingerprint, signSession, verifySession } from "./token";
import { validatePasswordChange } from "./change-password";

describe("password hashing", () => {
  test("the right password verifies and a wrong one doesn't", async () => {
    const hash = await hashPassword("correct horse battery");
    assert.equal(await verifyPassword("correct horse battery", hash), true);
    assert.equal(await verifyPassword("correct horse batter", hash), false);
  });

  test("the same password hashes differently each time (random salt)", async () => {
    assert.notEqual(await hashPassword("same"), await hashPassword("same"));
  });

  test("the plain password is not in the stored hash", async () => {
    assert.ok(!(await hashPassword("hunter2hunter2")).includes("hunter2"));
  });

  test("hashes contain no '$', so .env files don't expand them", async () => {
    assert.ok(!(await hashPassword("x")).includes("$"));
  });

  test("garbage, empty and missing hashes never verify", async () => {
    for (const bad of ["", "nope", "scrypt:a", "scrypt:a:b", "bcrypt:a:b", "scrypt:a:b:c", undefined]) {
      assert.equal(await verifyPassword("anything", bad), false, String(bad));
    }
  });

  test("the dummy hash used for unknown emails never verifies", async () => {
    assert.equal(await verifyPassword("", DUMMY_HASH), false);
    assert.equal(await verifyPassword("password", DUMMY_HASH), false);
  });

  test("scripts/hash-password.mjs makes a hash the app accepts", async () => {
    const out = execFileSync("node", ["scripts/hash-password.mjs", "from the script"]).toString().trim();
    assert.equal(await verifyPassword("from the script", out), true);
    assert.equal(await verifyPassword("something else", out), false);
  });
});

describe("session tokens", () => {
  const secret = "a-test-secret-that-is-long-enough-32+";
  const now = 1_000_000;
  const payload = { sub: "abc", role: "employee" as const, exp: now + 60, v: "fingerprint" };

  test("a signed token verifies and returns the payload", () => {
    assert.deepEqual(verifySession(signSession(payload, secret), secret, now), payload);
  });

  test("an expired token is rejected", () => {
    assert.equal(verifySession(signSession(payload, secret), secret, now + 61), null);
  });

  test("a token signed with another secret is rejected", () => {
    assert.equal(verifySession(signSession(payload, "another-secret-another-secret-123456"), secret, now), null);
  });

  test("changing the role in the payload breaks the signature", () => {
    const [, signature] = signSession(payload, secret).split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload, role: "admin" })).toString("base64url");
    assert.equal(verifySession(`${forged}.${signature}`, secret, now), null);
  });

  test("missing, empty and malformed tokens are rejected", () => {
    for (const bad of [undefined, "", "abc", "a.b.c", "."])
      assert.equal(verifySession(bad, secret, now), null, String(bad));
  });

  test("a validly signed token with a bad role is rejected", () => {
    const token = signSession({ ...payload, role: "root" as never }, secret);
    assert.equal(verifySession(token, secret, now), null);
  });
});

describe("creating an employee", () => {
  const ok = {
    email: "Priya.Sharma@Gmail.com",
    joiningDate: "2026-03-02",
    password: "temp-pass-1",
    category: "intern",
  };
  const none = { emails: [] as string[] };

  test("accepts a Gmail address, a real date and a long enough password; lowercases the email", () => {
    const result = validateNewEmployee(ok, none);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.value.email, "priya.sharma@gmail.com");
  });

  test("rejects non-Gmail addresses", () => {
    for (const email of [
      "a@yahoo.com",
      "a@googlemail.com",
      "a@gmail.co",
      "@gmail.com",
      "a b@gmail.com",
      "gmail.com",
      "",
    ]) {
      const r = validateNewEmployee({ ...ok, email }, none);
      assert.equal(!r.ok && !!r.errors.email, true, email);
    }
  });

  test("rejects an email that is already taken, ignoring case (this includes the admin's)", () => {
    const r = validateNewEmployee(ok, { emails: ["priya.sharma@gmail.com"] });
    assert.equal(!r.ok && r.errors.email, "Someone already uses this email.");
  });

  test("rejects a missing, impossible or ancient joining date", () => {
    for (const joiningDate of ["", "2026-02-30", "2026-13-01", "02/03/2026", "1999-12-31"]) {
      const r = validateNewEmployee({ ...ok, joiningDate }, none);
      assert.equal(!r.ok && !!r.errors.joiningDate, true, joiningDate);
    }
    assert.equal(validateNewEmployee({ ...ok, joiningDate: "2028-02-29" }, none).ok, true); // leap day
  });

  test("the category has to be contractor, employee, intern or student, and is passed through", () => {
    for (const category of ["contractor", "employee", "intern", "student"]) {
      const r = validateNewEmployee({ ...ok, category }, none);
      assert.equal(r.ok && r.value.category, category);
    }
    for (const category of ["", "manager", "Employee", "INTERN"]) {
      const r = validateNewEmployee({ ...ok, category }, none);
      assert.equal(!r.ok && r.errors.category, "Choose a category.", category);
    }
  });

  test("rejects a short password", () => {
    const r = validateNewEmployee({ ...ok, password: "short" }, none);
    assert.equal(!r.ok && !!r.errors.password, true);
  });

  test("reports every problem at once", () => {
    const r = validateNewEmployee({ email: "x", joiningDate: "", password: "", category: "" }, none);
    assert.deepEqual(!r.ok && Object.keys(r.errors).sort(), ["category", "email", "joiningDate", "password"]);
  });

  test("the display name comes from the email", () => {
    assert.equal(nameFromEmail("priya.sharma@gmail.com"), "Priya Sharma");
    assert.equal(nameFromEmail("rahul_verma99@gmail.com"), "Rahul Verma");
    assert.equal(nameFromEmail("ananya@gmail.com"), "Ananya");
  });
});

describe("validating a password change", () => {
  test("the new password needs the right length, must differ, and must be typed twice", () => {
    const ok = { current: "old-password", next: "new-password", confirm: "new-password" };
    assert.deepEqual(validatePasswordChange(ok), {});
    assert.ok(validatePasswordChange({ ...ok, current: "" }).current);
    assert.ok(validatePasswordChange({ ...ok, next: "short", confirm: "short" }).next);
    assert.ok(validatePasswordChange({ ...ok, next: "x".repeat(129), confirm: "x".repeat(129) }).next);
    assert.ok(validatePasswordChange({ ...ok, next: "old-password", confirm: "old-password" }).next);
    assert.ok(validatePasswordChange({ ...ok, confirm: "different-one" }).confirm);
  });

  test("the session fingerprint is stable, differs per hash, and doesn't leak the hash", () => {
    assert.equal(passwordFingerprint("same"), passwordFingerprint("same"));
    assert.notEqual(passwordFingerprint("scrypt:a:b"), passwordFingerprint("scrypt:a:c"));
    assert.ok(!passwordFingerprint("scrypt:a:b").includes("scrypt"));
  });

  test("a session token without a fingerprint is not accepted", () => {
    const secret = "a-test-secret-that-is-long-enough-32+";
    const old = Buffer.from(JSON.stringify({ sub: "a", role: "employee", exp: 99 })).toString("base64url");
    const sig = createHmac("sha256", secret).update(old).digest("base64url");
    assert.equal(verifySession(`${old}.${sig}`, secret, 1), null);
  });
});

describe("validating a new admin", () => {
  const none = { emails: [] as string[] };

  test("any well-formed email works (not just Gmail), lowercased; the password needs 8+ characters", () => {
    const ok = validateNewAdmin({ email: "Second.Admin@Company.co.in", password: "temp-pass-1" }, none);
    assert.equal(ok.ok && ok.value.email, "second.admin@company.co.in");
    for (const email of ["", "nope", "a@b", "a b@c.com", "@c.com"]) {
      const r = validateNewAdmin({ email, password: "temp-pass-1" }, none);
      assert.equal(!r.ok && !!r.errors.email, true, email);
    }
    assert.equal(!validateNewAdmin({ email: "a@b.com", password: "short" }, none).ok, true);
  });

  test("an email already in use is refused, ignoring case", () => {
    const r = validateNewAdmin({ email: "TAKEN@x.com", password: "temp-pass-1" }, { emails: ["taken@x.com"] });
    assert.equal(!r.ok && r.errors.email, "Someone already uses this email.");
  });
});
