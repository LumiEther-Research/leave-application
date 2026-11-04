// Run with `npm test`. Everything here talks to a real Neon test branch (DATABASE_URL_TEST): the
// store's SQL, sign-in, the admin rules and the leave and comp-off flows. See ./test-db.ts.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { changePassword } from "./auth/change-password";
import { hashPassword } from "./auth/password";
import { passwordFingerprint } from "./auth/token";
import { authenticate, credentialHashFor, isEmailInUse, removeAdmin } from "./auth/users";
import { isUuid, query } from "./db";
import { getLeaveBalances, getLeaveEntries } from "./leave";
import {
  addCompOffClaim,
  addLeaveRequest,
  addPermission,
  cancelLeaveRequest,
  countAdmins,
  createAdmin,
  createEmployee,
  deleteAdmin,
  findAdminByEmail,
  findAdminById,
  findEmployeeByEmail,
  getDashboardData,
  getEmployees,
  getHolidays,
  getLeaveCategories,
  getPermissions,
  isEmailTaken,
  listAdmins,
  resolveRequest,
  setEmployeeCategory,
  setLeaveCategoryDays,
} from "./store";
import { DB_TEST_SKIP, resetDb } from "./test-db";
import { defaultHolidays } from "./types";

const year = new Date().getFullYear();
const today = new Date(year, 0, 2); // a fixed "today" early in the year, for cancellation tests

const admin = async (name: string, password = "admin-pass-1") =>
  createAdmin({ name, email: `${name.toLowerCase()}@example.com`, passwordHash: await hashPassword(password) });
const employee = async (name: string, password = "temp-pass-1", joiningDate = "2000-01-01") =>
  createEmployee({
    name,
    email: `${name.toLowerCase()}@gmail.com`,
    joiningDate,
    passwordHash: await hashPassword(password),
  });

/** A working day in late December: never a weekend. */
const lateDecemberWorkingDay = (() => {
  let d = new Date(year, 11, 28);
  while (d.getDay() === 0 || d.getDay() === 6) d = new Date(year, 11, d.getDate() + 1);
  return `${year}-12-${String(d.getDate()).padStart(2, "0")}`;
})();
const firstSaturday = (() => {
  let d = new Date(year, 0, 1);
  while (d.getDay() !== 6) d = new Date(year, 0, d.getDate() + 1);
  return `${year}-01-${String(d.getDate()).padStart(2, "0")}`;
})();

const findRequest = async (id: string) => (await getDashboardData()).requests.find((r) => r.id === id)!;

describe("employees and holidays", { skip: DB_TEST_SKIP }, () => {
  beforeEach(resetDb);

  test("the four national holidays are in the table", async () => {
    assert.deepEqual(
      await getHolidays(),
      [...defaultHolidays].sort((a, b) => a.month - b.month || a.day - b.day),
    );
  });

  test("an employee is saved with a uuid id and found by email in any case, without exposing the hash in the list", async () => {
    const e = await employee("Priya");
    assert.equal(isUuid(e.id), true);
    const found = await findEmployeeByEmail("PRIYA@Gmail.com");
    assert.deepEqual(
      [found?.id, found?.name, found?.joiningDate, found?.leaveAllowance],
      [e.id, "Priya", "2000-01-01", 24],
    );
    assert.equal("passwordHash" in (await getEmployees())[0], false);
  });

  test("the same email can't be used twice, whatever its case", async () => {
    await employee("Priya");
    await assert.rejects(
      createEmployee({ name: "Again", email: "PRIYA@gmail.com", joiningDate: "2026-01-01", passwordHash: "x" }),
    );
  });

  test("an email counts as taken if an admin or an employee has it", async () => {
    await employee("Priya");
    await admin("Boss");
    assert.equal(await isEmailTaken("priya@gmail.com"), true);
    assert.equal(await isEmailTaken("BOSS@example.com"), true);
    assert.equal(await isEmailTaken("nobody@gmail.com"), false);
  });

  test("a made-up id never reaches the database as a uuid", async () => {
    assert.equal(await findAdminById("not-a-uuid"), undefined);
    assert.deepEqual(await getDashboardData().then((d) => d.requests), []);
  });
});

describe("signing in", { skip: DB_TEST_SKIP }, () => {
  const original = { email: process.env.ADMIN_EMAIL, hash: process.env.ADMIN_PASSWORD_HASH };
  beforeEach(resetDb);
  afterEach(() => {
    for (const [key, value] of [
      ["ADMIN_EMAIL", original.email],
      ["ADMIN_PASSWORD_HASH", original.hash],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test("an employee signs in with their temporary password; a wrong one or an unknown email fails", async () => {
    await employee("Priya");
    const ok = await authenticate("Priya@Gmail.com", "temp-pass-1");
    assert.equal(ok.ok && ok.user.role, "employee");
    assert.deepEqual(await authenticate("priya@gmail.com", "nope"), { ok: false, reason: "wrong-password" });
    assert.equal((await authenticate("stranger@gmail.com", "x")).ok, false);
  });

  test("an admin in the table signs in as an admin", async () => {
    await admin("Boss");
    const result = await authenticate("boss@example.com", "admin-pass-1");
    assert.equal(result.ok && result.user.role, "admin");
    assert.deepEqual(await authenticate("boss@example.com", "nope"), { ok: false, reason: "wrong-password" });
  });

  test("bootstrap: with no admins, ADMIN_EMAIL and ADMIN_PASSWORD_HASH let the first admin in and are saved as a normal admin", async () => {
    process.env.ADMIN_EMAIL = "Boss@Example.com";
    process.env.ADMIN_PASSWORD_HASH = await hashPassword("env-password-1");
    assert.equal(await countAdmins(), 0);

    const first = await authenticate("boss@example.com", "env-password-1");
    assert.equal(first.ok && first.user.role, "admin");
    assert.equal(await countAdmins(), 1);

    // From now on they're an ordinary admin: the environment is no longer consulted.
    process.env.ADMIN_PASSWORD_HASH = await hashPassword("something-else-1");
    assert.equal((await authenticate("boss@example.com", "env-password-1")).ok, true);
    assert.equal((await authenticate("boss@example.com", "something-else-1")).ok, false);
  });

  test("bootstrap is closed once any admin exists, even for the ADMIN_EMAIL address", async () => {
    await admin("Other");
    process.env.ADMIN_EMAIL = "boss@example.com";
    process.env.ADMIN_PASSWORD_HASH = await hashPassword("env-password-1");
    assert.deepEqual(await authenticate("boss@example.com", "env-password-1"), {
      ok: false,
      reason: "bootstrap-closed",
    });
    assert.equal(await findAdminByEmail("boss@example.com"), undefined);
  });

  test("bootstrap failures: wrong password, missing hash, malformed hash, no ADMIN_EMAIL", async () => {
    process.env.ADMIN_EMAIL = "boss@example.com";
    process.env.ADMIN_PASSWORD_HASH = await hashPassword("env-password-1");
    assert.deepEqual(await authenticate("boss@example.com", "nope"), { ok: false, reason: "wrong-password" });

    process.env.ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH.replace(/^scrypt:/, ""); // prefix lost in copy/paste
    assert.deepEqual(await authenticate("boss@example.com", "env-password-1"), {
      ok: false,
      reason: "malformed-admin-hash",
    });

    delete process.env.ADMIN_PASSWORD_HASH;
    assert.deepEqual(await authenticate("boss@example.com", "env-password-1"), {
      ok: false,
      reason: "missing-admin-hash",
    });

    delete process.env.ADMIN_EMAIL;
    assert.deepEqual(await authenticate("boss@example.com", "x"), { ok: false, reason: "admin-not-configured" });
    assert.equal(await countAdmins(), 0);
  });

  test("an email is in use if it's an admin's, an employee's, or the bootstrap ADMIN_EMAIL", async () => {
    process.env.ADMIN_EMAIL = "boss@example.com";
    await employee("Priya");
    assert.equal(await isEmailInUse("BOSS@example.com"), true);
    assert.equal(await isEmailInUse("priya@gmail.com"), true);
    assert.equal(await isEmailInUse("new@example.com"), false);
  });
});

describe("changing a password", { skip: DB_TEST_SKIP }, () => {
  beforeEach(resetDb);
  const asUser = (a: { id: string; name: string; email: string }, role: "admin" | "employee") => ({ ...a, role });

  test("an employee's new password works and the old one stops", async () => {
    const e = await employee("Priya");
    const result = await changePassword(asUser(e, "employee"), {
      current: "temp-pass-1",
      next: "my-own-pass-9",
      confirm: "my-own-pass-9",
    });
    assert.equal(result.ok, true);
    assert.equal((await authenticate(e.email, "my-own-pass-9")).ok, true);
    assert.deepEqual(await authenticate(e.email, "temp-pass-1"), { ok: false, reason: "wrong-password" });
  });

  test("a wrong current password is refused and nothing changes", async () => {
    const e = await employee("Priya");
    const result = await changePassword(asUser(e, "employee"), {
      current: "not-it",
      next: "my-own-pass-9",
      confirm: "my-own-pass-9",
    });
    assert.equal(!result.ok && !!result.errors.current, true);
    assert.equal((await authenticate(e.email, "temp-pass-1")).ok, true);
  });

  test("an admin changes only their own password, and the session fingerprint changes so old sessions stop working", async () => {
    const a = await admin("Boss");
    const other = await admin("Other");
    const user = asUser(a, "admin");
    const before = passwordFingerprint(await credentialHashFor(user));

    const result = await changePassword(user, {
      current: "admin-pass-1",
      next: "chosen-by-them-1",
      confirm: "chosen-by-them-1",
    });
    assert.equal(result.ok, true);
    assert.equal((await authenticate(a.email, "chosen-by-them-1")).ok, true);
    assert.equal((await authenticate(a.email, "admin-pass-1")).ok, false);
    assert.notEqual(before, passwordFingerprint(await credentialHashFor(user)));
    assert.equal((await authenticate(other.email, "admin-pass-1")).ok, true); // untouched
  });
});

describe("admins", { skip: DB_TEST_SKIP }, () => {
  beforeEach(resetDb);
  const asUser = (a: { id: string; name: string; email: string }) => ({ ...a, role: "admin" as const });

  test("admins are listed without their password hashes", async () => {
    await admin("Boss");
    assert.deepEqual(Object.keys((await listAdmins())[0]).sort(), ["email", "id", "name"]);
  });

  test("the same admin email can't be added twice, whatever its case", async () => {
    await admin("Boss");
    await assert.rejects(createAdmin({ name: "Again", email: "BOSS@example.com", passwordHash: "x" }));
  });

  test("an admin can remove another admin, who then can't sign in and has no account for a session to find", async () => {
    const a = await admin("Boss");
    const b = await admin("Second");
    assert.deepEqual(await removeAdmin(asUser(a), b.id), { ok: true });
    assert.equal(await findAdminById(b.id), undefined);
    assert.equal((await authenticate(b.email, "admin-pass-1")).ok, false);
    assert.equal((await listAdmins()).length, 1);
  });

  test("nobody can remove themselves", async () => {
    const a = await admin("Boss");
    await admin("Second");
    const result = await removeAdmin(asUser(a), a.id);
    assert.equal(!result.ok && /own admin account/.test(result.error), true);
    assert.equal((await listAdmins()).length, 2);
  });

  test("the last admin can't be removed, by the app or by the database itself", async () => {
    const a = await admin("Boss");
    const stranger = {
      id: "00000000-0000-4000-8000-000000000000",
      name: "Gone",
      email: "gone@x.com",
      role: "admin" as const,
    };

    const viaApp = await removeAdmin(stranger, a.id);
    assert.equal(!viaApp.ok && /at least one admin/.test(viaApp.error), true);

    const viaStore = await deleteAdmin(stranger.id, a.id); // skips the app's own count check
    assert.equal(!viaStore.ok && /at least one admin/.test(viaStore.error), true);

    await assert.rejects(query("delete from admins"), /last_admin/); // raw SQL can't empty the table either
    assert.equal(await countAdmins(), 1);
  });

  test("two admins removing each other at the same moment can't leave zero admins", async () => {
    const a = await admin("Boss");
    const b = await admin("Second");
    const results = await Promise.all([removeAdmin(asUser(a), b.id), removeAdmin(asUser(b), a.id)]);
    assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
    assert.equal(await countAdmins(), 1);
  });

  test("removing an admin that doesn't exist says so, and other admins keep their access", async () => {
    const a = await admin("Boss");
    const other = await admin("Other");
    const missing = await removeAdmin(asUser(a), "00000000-0000-4000-8000-000000000001");
    assert.equal(!missing.ok && /no longer exists/.test(missing.error), true);
    assert.equal((await authenticate(other.email, "admin-pass-1")).ok, true);
  });
});

describe("leave requests", { skip: DB_TEST_SKIP }, () => {
  beforeEach(resetDb);
  const full = (from: string, to = from) => ({ type: "Casual leave", from, to, dayLength: "full" });

  test("a valid request is saved as pending for that employee only", async () => {
    const e = await employee("One");
    const other = await employee("Two");
    const r = await addLeaveRequest(e.id, full(`${year}-02-02`, `${year}-02-03`));
    assert.equal(r.ok, true);
    const mine = (await getDashboardData()).requests.filter((x) => x.employeeId === e.id);
    assert.deepEqual(
      mine.map((x) => [x.type, x.status, x.from, x.to]),
      [["Casual leave", "pending", `${year}-02-02`, `${year}-02-03`]],
    );
    assert.equal((await getDashboardData()).requests.filter((x) => x.employeeId === other.id).length, 0);
  });

  test("a half day is saved on one day and flagged", async () => {
    const e = await employee("One");
    await addLeaveRequest(e.id, { type: "Sick leave", from: `${year}-02-03`, to: "", dayLength: "half" });
    const [saved] = (await getDashboardData()).requests;
    assert.deepEqual([saved.from, saved.to, saved.halfDay], [`${year}-02-03`, `${year}-02-03`, true]);
  });

  test("invalid or overlapping requests are refused and not saved", async () => {
    const e = await employee("One");
    await addLeaveRequest(e.id, full(`${year}-02-02`, `${year}-02-04`));
    const overlap = await addLeaveRequest(e.id, full(`${year}-02-04`, `${year}-02-05`));
    assert.equal(!overlap.ok && !!overlap.errors.form, true);
    const bad = await addLeaveRequest(e.id, full("", ""));
    assert.equal(!bad.ok, true);
    assert.equal((await getDashboardData()).requests.length, 1);
  });

  test("leave that would take the balance below zero is blocked and not saved", async () => {
    const e = await employee("One");
    const r = await addLeaveRequest(e.id, full(`${year}-01-01`, `${year}-03-31`)); // about 60 working days
    assert.equal(!r.ok && /enough leave/.test(r.errors.form ?? ""), true);
    assert.equal((await getDashboardData()).requests.length, 0);
  });

  test("approving leave takes it from the balance; rejecting doesn't", async () => {
    const e = await employee("One");
    const a = await addLeaveRequest(e.id, full(`${year}-02-02`, `${year}-02-03`));
    const b = await addLeaveRequest(e.id, full(`${year}-03-02`));
    assert.equal(a.ok && b.ok, true);
    assert.equal(await resolveRequest(a.ok ? a.id : "", "approved"), true);
    assert.equal(await resolveRequest(b.ok ? b.id : "", "rejected"), true);
    assert.equal(await resolveRequest(a.ok ? a.id : "", "approved"), false); // already decided

    const data = await getDashboardData();
    const entries = getLeaveEntries(data.requests, data.pastLeaveDays, data.holidays, year);
    const [balance] = getLeaveBalances(
      data.employees,
      entries,
      data.requests,
      data.holidays,
      year,
      new Date(year, 5, 1),
    );
    assert.deepEqual([balance.used, balance.remaining], [2, 22]);
  });
});

describe("cancelling leave", { skip: DB_TEST_SKIP }, () => {
  beforeEach(resetDb);
  const apply = async (employeeId: string) => {
    const r = await addLeaveRequest(employeeId, {
      type: "Casual leave",
      from: lateDecemberWorkingDay,
      to: lateDecemberWorkingDay,
      dayLength: "full",
    });
    assert.equal(r.ok, true);
    return r.ok ? r.id : "";
  };

  test("pending leave is withdrawn straight away and becomes cancelled", async () => {
    const e = await employee("One");
    const id = await apply(e.id);
    assert.deepEqual(await cancelLeaveRequest(e.id, id, today), { ok: true, action: "withdraw" });
    assert.equal((await findRequest(id)).status, "cancelled");
  });

  test("approved leave only gets a cancellation request, and can't be asked twice", async () => {
    const e = await employee("One");
    const id = await apply(e.id);
    await resolveRequest(id, "approved");
    assert.deepEqual(await cancelLeaveRequest(e.id, id, today), { ok: true, action: "request" });
    const waiting = await findRequest(id);
    assert.deepEqual([waiting.status, waiting.cancelRequested], ["approved", true]);
    assert.equal((await cancelLeaveRequest(e.id, id, today)).ok, false);
  });

  test("the admin approving the cancellation cancels the leave", async () => {
    const e = await employee("One");
    const id = await apply(e.id);
    await resolveRequest(id, "approved");
    await cancelLeaveRequest(e.id, id, today);
    assert.equal(await resolveRequest(id, "approved"), true);
    const done = await findRequest(id);
    assert.deepEqual([done.status, done.cancelRequested], ["cancelled", undefined]);
  });

  test("the admin rejecting the cancellation keeps the leave, and they may ask again later", async () => {
    const e = await employee("One");
    const id = await apply(e.id);
    await resolveRequest(id, "approved");
    await cancelLeaveRequest(e.id, id, today);
    assert.equal(await resolveRequest(id, "rejected"), true);
    const kept = await findRequest(id);
    assert.deepEqual([kept.status, kept.cancelRequested], ["approved", undefined]);
    assert.equal((await cancelLeaveRequest(e.id, id, today)).ok, true);
  });

  test("an employee can't cancel someone else's leave, and an admin decision only applies to things waiting on them", async () => {
    const owner = await employee("Owner");
    const other = await employee("Other");
    const id = await apply(owner.id);
    assert.equal((await cancelLeaveRequest(other.id, id, today)).ok, false);
    assert.equal((await findRequest(id)).status, "pending");

    await resolveRequest(id, "approved");
    assert.equal(await resolveRequest(id, "approved"), false); // approved leave with no cancellation request
  });
});

describe("comp-off claims", { skip: DB_TEST_SKIP }, () => {
  beforeEach(resetDb);

  test("a claim is saved pending in its own table and shows up as a Comp-off request on the day worked", async () => {
    const e = await employee("One");
    const r = await addCompOffClaim(e.id, { workedOn: firstSaturday, dayLength: "half" });
    assert.equal(r.ok, true);
    assert.equal((await query("select count(*)::int as n from comp_off_claims"))[0].n, 1);
    assert.equal((await query("select count(*)::int as n from leave_requests"))[0].n, 0);

    const [claim] = (await getDashboardData()).requests;
    assert.deepEqual(
      [claim.type, claim.status, claim.from, claim.to, claim.halfDay],
      ["Comp-off", "pending", firstSaturday, firstSaturday, true],
    );
  });

  test("the same day can't be claimed twice, but can be again after a rejection", async () => {
    const e = await employee("One");
    const first = await addCompOffClaim(e.id, { workedOn: firstSaturday, dayLength: "full" });
    const again = await addCompOffClaim(e.id, { workedOn: firstSaturday, dayLength: "full" });
    assert.equal(!again.ok && !!again.errors.workedOn, true);

    await resolveRequest(first.ok ? first.id : "", "rejected");
    assert.equal((await addCompOffClaim(e.id, { workedOn: firstSaturday, dayLength: "full" })).ok, true);
  });

  test("a claim for a working day is refused", async () => {
    const e = await employee("One");
    const monday = new Date(year, 0, 1);
    while (monday.getDay() !== 1) monday.setDate(monday.getDate() + 1);
    const iso = `${year}-01-${String(monday.getDate()).padStart(2, "0")}`;
    assert.equal((await addCompOffClaim(e.id, { workedOn: iso, dayLength: "full" })).ok, false);
  });

  test("a pending claim adds nothing to the balance; approving it adds a day, and leave uses it first", async () => {
    const e = await employee("One");
    const claim = await addCompOffClaim(e.id, { workedOn: firstSaturday, dayLength: "full" });
    const balanceOf = async () => {
      const d = await getDashboardData();
      const entries = getLeaveEntries(d.requests, d.pastLeaveDays, d.holidays, year);
      return getLeaveBalances(d.employees, entries, d.requests, d.holidays, year, new Date(year, 5, 1))[0];
    };
    assert.equal((await balanceOf()).total, 24);

    await resolveRequest(claim.ok ? claim.id : "", "approved");
    assert.deepEqual([(await balanceOf()).total, (await balanceOf()).compOffAvailable], [25, 1]);
  });

  test("deleting an employee removes their requests and claims", async () => {
    const e = await employee("One");
    await addLeaveRequest(e.id, {
      type: "Casual leave",
      from: `${year}-02-02`,
      to: `${year}-02-02`,
      dayLength: "full",
    });
    await addCompOffClaim(e.id, { workedOn: firstSaturday, dayLength: "full" });
    await query("delete from employees where id = $1", [e.id]);
    assert.deepEqual((await getDashboardData()).requests, []);
  });
});

describe("leave categories", { skip: DB_TEST_SKIP }, () => {
  beforeEach(async () => {
    await resetDb();
    for (const c of ["contractor", "employee", "intern", "student"] as const) await setLeaveCategoryDays(c, 24); // back to the seed
  });

  test("the four categories exist, in order, each starting at 24 days", async () => {
    assert.deepEqual(await getLeaveCategories(), [
      { category: "contractor", daysPerYear: 24 },
      { category: "employee", daysPerYear: 24 },
      { category: "intern", daysPerYear: 24 },
      { category: "student", daysPerYear: 24 },
    ]);
  });

  test("a new employee defaults to the employee category, or gets the one chosen, with that category's days", async () => {
    const plain = await employee("Plain");
    assert.deepEqual([plain.category, plain.leaveAllowance], ["employee", 24]);
    await setLeaveCategoryDays("intern", 10);
    const intern = await createEmployee({
      name: "Intern",
      email: "intern@gmail.com",
      joiningDate: "2026-01-05",
      passwordHash: "x",
      category: "intern",
    });
    assert.deepEqual([intern.category, intern.leaveAllowance], ["intern", 10]);
  });

  test("changing a category's days changes everyone in it straight away, and nobody else", async () => {
    const a = await createEmployee({
      name: "A",
      email: "a@gmail.com",
      joiningDate: "2026-01-05",
      passwordHash: "x",
      category: "student",
    });
    const b = await createEmployee({
      name: "B",
      email: "b@gmail.com",
      joiningDate: "2026-01-05",
      passwordHash: "x",
      category: "contractor",
    });
    assert.equal(await setLeaveCategoryDays("student", 6), true);
    const byName = Object.fromEntries((await getEmployees()).map((e) => [e.name, e.leaveAllowance]));
    assert.deepEqual([byName.A, byName.B], [6, 24]);
    assert.ok(a && b);
  });

  test("days must be a whole number from 0 to 366, and the category has to exist", async () => {
    assert.equal(await setLeaveCategoryDays("intern", 0), true); // zero is allowed
    assert.equal(await setLeaveCategoryDays("intern", 366), true);
    for (const days of [-1, 367, 1.5, Number.NaN])
      assert.equal(await setLeaveCategoryDays("intern", days), false, String(days));
    assert.equal(await setLeaveCategoryDays("manager" as never, 5), false);
    assert.equal((await getLeaveCategories()).find((c) => c.category === "intern")?.daysPerYear, 366);
  });

  test("moving an employee to another category changes their days; a made-up category or id changes nothing", async () => {
    await setLeaveCategoryDays("student", 6);
    const e = await employee("Mover");
    assert.equal(await setEmployeeCategory(e.id, "student"), true);
    assert.deepEqual([(await getEmployees())[0].category, (await getEmployees())[0].leaveAllowance], ["student", 6]);
    assert.equal(await setEmployeeCategory(e.id, "manager" as never), false);
    assert.equal(await setEmployeeCategory("not-a-uuid", "intern"), false);
    assert.equal((await getEmployees())[0].category, "student");
  });

  test("the category's days are what limit leave: a student with 3 days can take 3 but not 4", async () => {
    await setLeaveCategoryDays("student", 3);
    const s = await createEmployee({
      name: "Stu",
      email: "stu@gmail.com",
      joiningDate: "2000-01-01",
      passwordHash: "x",
      category: "student",
    });
    const apply = (from: string, to: string) =>
      addLeaveRequest(s.id, { type: "Casual leave", from, to, dayLength: "full" });
    // Mon 2 Feb to Thu 5 Feb is 4 working days when it starts on a Monday; find one that does.
    let monday = new Date(year, 1, 1);
    while (monday.getDay() !== 1) monday = new Date(year, 1, monday.getDate() + 1);
    const iso = (offset: number) => {
      const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + offset);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    const tooMany = await apply(iso(0), iso(3)); // 4 working days
    assert.equal(!tooMany.ok && /enough leave/.test(tooMany.errors.form ?? ""), true);
    assert.equal(!tooMany.ok && /\d/.test(tooMany.errors.form ?? ""), false, "doesn't say by how much");
    assert.equal((await apply(iso(0), iso(2))).ok, true); // 3 working days
  });

  test("raising the days lets someone who was blocked apply", async () => {
    await setLeaveCategoryDays("intern", 1);
    const i = await createEmployee({
      name: "Ina",
      email: "ina@gmail.com",
      joiningDate: "2000-01-01",
      passwordHash: "x",
      category: "intern",
    });
    const from = `${year}-02-02`;
    let day = new Date(year, 1, 2);
    while (day.getDay() === 0 || day.getDay() === 6) day = new Date(year, 1, day.getDate() + 1);
    const d1 = `${year}-02-${String(day.getDate()).padStart(2, "0")}`;
    const next = new Date(year, 1, day.getDate() + (day.getDay() === 5 ? 3 : 1));
    const d2 = `${year}-02-${String(next.getDate()).padStart(2, "0")}`;
    assert.ok(from);
    assert.equal(
      (await addLeaveRequest(i.id, { type: "Casual leave", from: d1, to: d2, dayLength: "full" })).ok,
      false,
    );
    await setLeaveCategoryDays("intern", 5);
    assert.equal((await addLeaveRequest(i.id, { type: "Casual leave", from: d1, to: d2, dayLength: "full" })).ok, true);
  });
});

describe("permissions", { skip: DB_TEST_SKIP }, () => {
  beforeEach(resetDb);
  // A Thursday in November of this year is always a working day unless it's a holiday; pick one that is neither.
  const workingDay = (() => {
    let d = new Date(year, 5, 1);
    while (d.getDay() === 0 || d.getDay() === 6) d = new Date(year, 5, d.getDate() + 1);
    return `${year}-06-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const log = (employeeId: string, from = "10:00", to = "11:00", reason = "") =>
    addPermission(employeeId, { date: workingDay, from, to, reason });

  test("a permission is saved with its length and shows up for that employee, newest first", async () => {
    const e = await employee("One");
    const other = await employee("Two");
    assert.equal((await log(e.id, "10:00", "11:00", "Bank work")).ok, true);
    assert.equal((await log(e.id, "15:00", "15:45")).ok, true);
    await log(other.id);

    const mine = await getPermissions(e.id);
    assert.deepEqual(
      mine.map((p) => [p.from, p.to, p.minutes, p.reason]),
      [
        ["15:00", "15:45", 45, ""],
        ["10:00", "11:00", 60, "Bank work"],
      ],
    );
    assert.equal((await getPermissions()).length, 3);
    assert.equal((await getPermissions())[0].employeeName.length > 0, true);
  });

  test("a bad permission is refused and not saved; an overlapping one too", async () => {
    const e = await employee("One");
    assert.equal((await log(e.id, "11:00", "10:00")).ok, false);
    await log(e.id, "10:00", "11:00");
    const overlap = await log(e.id, "10:30", "11:30");
    assert.equal(!overlap.ok && !!overlap.errors.form, true);
    assert.equal((await getPermissions(e.id)).length, 1);
  });

  test("it can't be noted on a day with approved or pending leave", async () => {
    const e = await employee("One");
    await addLeaveRequest(e.id, { type: "Casual leave", from: workingDay, to: workingDay, dayLength: "full" });
    const r = await log(e.id);
    assert.equal(!r.ok && /leave on that day/.test(r.errors.form ?? ""), true);
  });

  test("a permission takes nothing from the leave balance", async () => {
    const e = await employee("One");
    await log(e.id, "09:00", "17:00");
    const d = await getDashboardData();
    const entries = getLeaveEntries(d.requests, d.pastLeaveDays, d.holidays, year);
    const [balance] = getLeaveBalances(d.employees, entries, d.requests, d.holidays, year, new Date(year, 11, 1));
    assert.deepEqual([balance.used, balance.remaining], [0, 24]);
  });

  test("the database refuses an end before the start, a day longer than 8 hours, and a too-long reason", async () => {
    const e = await employee("One");
    const insert = (from: string, to: string, reason = "") =>
      query(
        "insert into permissions (employee_id, permission_date, start_time, end_time, reason) values ($1, $2, $3, $4, $5)",
        [e.id, workingDay, from, to, reason],
      );
    await assert.rejects(insert("11:00", "10:00"));
    await assert.rejects(insert("08:00", "17:00"));
    await assert.rejects(insert("10:00", "11:00", "x".repeat(201)));
  });

  test("deleting an employee removes their permissions", async () => {
    const e = await employee("One");
    await log(e.id);
    await query("delete from employees where id = $1", [e.id]);
    assert.deepEqual(await getPermissions(), []);
  });
});
