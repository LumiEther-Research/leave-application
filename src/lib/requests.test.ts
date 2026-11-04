// Run with `npm test`. What an employee may submit: leave requests and comp-off claims.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseISO } from "./dates";
import { defaultHolidays, type Employee, type LeaveRequest, type Permission } from "./types";
import {
  formatMinutes,
  planCancellation,
  validateCompOffInput,
  validateLeaveInput,
  validatePermissionInput,
} from "./requests";

const today = parseISO("2026-11-04"); // a Wednesday
const employee: Employee = {
  id: "x",
  name: "Test Person",
  email: "test.person@gmail.com",
  role: "employee",
  category: "employee",
  leaveAllowance: 24,
  joiningDate: "2024-03-10",
};
const leaveCtx = (mine: LeaveRequest[] = []) => ({ today, holidays: defaultHolidays, mine });
const compCtx = (mine: LeaveRequest[] = []) => ({ today, holidays: defaultHolidays, mine, employee });

const existing = (
  type: LeaveRequest["type"],
  status: LeaveRequest["status"],
  from: string,
  to = from,
): LeaveRequest => ({
  id: `${type}-${from}`,
  employeeId: "x",
  type,
  status,
  from,
  to,
  appliedOn: "2026-11-01",
});

describe("requesting leave", () => {
  const ok = { type: "Casual leave", from: "2026-11-16", to: "2026-11-18", dayLength: "full" };

  test("accepts casual and sick leave over real, ordered dates", () => {
    assert.equal(validateLeaveInput(ok, leaveCtx()).ok, true);
    assert.equal(validateLeaveInput({ ...ok, type: "Sick leave" }, leaveCtx()).ok, true);
  });

  test("a single day is fine (to = from)", () => {
    assert.equal(validateLeaveInput({ ...ok, to: ok.from }, leaveCtx()).ok, true);
  });

  test("comp-off is not a leave type you can request", () => {
    const r = validateLeaveInput({ ...ok, type: "Comp-off" }, leaveCtx());
    assert.equal(!r.ok && !!r.errors.type, true);
  });

  test("rejects missing and impossible dates", () => {
    for (const from of ["", "2026-02-30", "16/11/2026"]) {
      const r = validateLeaveInput({ ...ok, from }, leaveCtx());
      assert.equal(!r.ok && !!r.errors.from, true, from);
    }
    assert.equal(!validateLeaveInput({ ...ok, to: "" }, leaveCtx()).ok, true);
  });

  test("the end can't be before the start", () => {
    const r = validateLeaveInput({ ...ok, from: "2026-11-18", to: "2026-11-16" }, leaveCtx());
    assert.equal(!r.ok && !!r.errors.to, true);
  });

  test("can't start before this year or end after next year", () => {
    assert.equal(!validateLeaveInput({ ...ok, from: "2025-12-31", to: "2026-01-02" }, leaveCtx()).ok, true);
    assert.equal(!validateLeaveInput({ ...ok, from: "2027-12-30", to: "2028-01-02" }, leaveCtx()).ok, true);
  });

  test("a range is capped at 90 days", () => {
    assert.equal(validateLeaveInput({ ...ok, from: "2026-11-02", to: "2027-01-30" }, leaveCtx()).ok, true); // 90 days
    assert.equal(validateLeaveInput({ ...ok, from: "2026-11-02", to: "2027-01-31" }, leaveCtx()).ok, false); // 91
  });

  test("a range of only a weekend or holiday is refused, since nothing would be deducted", () => {
    const weekend = validateLeaveInput({ ...ok, from: "2026-11-14", to: "2026-11-15" }, leaveCtx());
    assert.equal(!weekend.ok && !!weekend.errors.form, true);
    const holiday = validateLeaveInput({ ...ok, from: "2026-10-02", to: "2026-10-02" }, leaveCtx());
    assert.equal(!holiday.ok && !!holiday.errors.form, true);
  });

  test("blocked if it overlaps pending or approved leave, but not rejected leave or comp-off claims", () => {
    const overlap = (status: LeaveRequest["status"]) =>
      validateLeaveInput(ok, leaveCtx([existing("Casual leave", status, "2026-11-17", "2026-11-20")])).ok;
    assert.equal(overlap("pending"), false);
    assert.equal(overlap("approved"), false);
    assert.equal(overlap("rejected"), true);
    assert.equal(validateLeaveInput(ok, leaveCtx([existing("Comp-off", "approved", "2026-11-17")])).ok, true);
  });

  test("back-to-back leave doesn't count as overlapping", () => {
    assert.equal(
      validateLeaveInput(ok, leaveCtx([existing("Casual leave", "approved", "2026-11-13", "2026-11-15")])).ok,
      true,
    );
  });
});

describe("requesting a half day of leave", () => {
  const half = { type: "Casual leave", from: "2026-11-16", to: "2026-11-16", dayLength: "half" }; // a Monday

  test("is accepted and flagged as a half day", () => {
    const r = validateLeaveInput(half, leaveCtx());
    assert.deepEqual(r.ok && r.value, { type: "Casual leave", from: "2026-11-16", to: "2026-11-16", halfDay: true });
  });

  test("works for sick leave too", () => {
    assert.equal(validateLeaveInput({ ...half, type: "Sick leave" }, leaveCtx()).ok, true);
  });

  test("it's always a single day: the To date is ignored, even if it's blank or later", () => {
    for (const to of ["", "2026-11-20"]) {
      const r = validateLeaveInput({ ...half, to }, leaveCtx());
      assert.equal(r.ok && r.value.to, "2026-11-16", to);
    }
  });

  test("a weekend or national holiday can't be a half day", () => {
    for (const from of ["2026-11-14", "2026-10-02"]) {
      const r = validateLeaveInput({ ...half, from, to: from }, leaveCtx());
      assert.equal(!r.ok && !!r.errors.form, true, from);
    }
  });

  test("still blocked if it overlaps other leave, and the day length must be full or half", () => {
    assert.equal(validateLeaveInput(half, leaveCtx([existing("Casual leave", "approved", "2026-11-16")])).ok, false);
    assert.equal(!validateLeaveInput({ ...half, dayLength: "quarter" }, leaveCtx()).ok, true);
    assert.equal(!validateLeaveInput({ ...half, dayLength: "" }, leaveCtx()).ok, true);
  });

  test("a full-day request still needs a valid To date", () => {
    assert.equal(!validateLeaveInput({ ...half, dayLength: "full", to: "" }, leaveCtx()).ok, true);
  });
});

describe("cancelling leave", () => {
  const leave = (status: LeaveRequest["status"], from: string, extra: Partial<LeaveRequest> = {}) => ({
    ...existing("Casual leave", status, from),
    ...extra,
  });

  test("pending leave is withdrawn straight away, even if it has started", () => {
    assert.deepEqual(planCancellation(leave("pending", "2026-11-16"), today), { ok: true, action: "withdraw" });
    assert.deepEqual(planCancellation(leave("pending", "2026-11-02"), today), { ok: true, action: "withdraw" });
  });

  test("approved leave that hasn't started goes to an admin, including leave starting today", () => {
    assert.deepEqual(planCancellation(leave("approved", "2026-11-16"), today), { ok: true, action: "request" });
    assert.deepEqual(planCancellation(leave("approved", "2026-11-04"), today), { ok: true, action: "request" });
  });

  test("approved leave that has already started can't be cancelled", () => {
    assert.equal(planCancellation(leave("approved", "2026-11-03"), today).ok, false);
  });

  test("a cancellation already requested, or rejected, cancelled or comp-off requests, can't be cancelled", () => {
    assert.equal(planCancellation(leave("approved", "2026-11-16", { cancelRequested: true }), today).ok, false);
    assert.equal(planCancellation(leave("rejected", "2026-11-16"), today).ok, false);
    assert.equal(planCancellation(leave("cancelled", "2026-11-16"), today).ok, false);
    assert.equal(planCancellation(existing("Comp-off", "pending", "2026-10-31"), today).ok, false);
  });

  test("cancelled leave frees its dates for a new request", () => {
    const ok = { type: "Casual leave", from: "2026-11-16", to: "2026-11-18", dayLength: "full" };
    assert.equal(validateLeaveInput(ok, leaveCtx([leave("cancelled", "2026-11-17")])).ok, true);
  });
});

describe("claiming comp-off", () => {
  const ok = { workedOn: "2026-10-31", dayLength: "full" }; // a Saturday

  test("accepts a past Saturday, a past Sunday and a past national holiday", () => {
    for (const workedOn of ["2026-10-31", "2026-11-01", "2026-10-02"]) {
      assert.equal(validateCompOffInput({ ...ok, workedOn }, compCtx()).ok, true, workedOn);
    }
  });

  test("a half day is accepted and flagged", () => {
    const r = validateCompOffInput({ ...ok, dayLength: "half" }, compCtx());
    assert.deepEqual(r.ok && r.value, { workedOn: "2026-10-31", halfDay: true });
  });

  test("an ordinary working day earns nothing, so it's refused", () => {
    const r = validateCompOffInput({ ...ok, workedOn: "2026-11-03" }, compCtx());
    assert.equal(!r.ok && !!r.errors.workedOn, true);
  });

  test("can't claim a day that hasn't happened yet", () => {
    const r = validateCompOffInput({ ...ok, workedOn: "2026-11-07" }, compCtx()); // next Saturday
    assert.equal(!r.ok && r.errors.workedOn, "That day hasn't happened yet.");
  });

  test("can't claim a day before this year or before joining", () => {
    assert.equal(!validateCompOffInput({ ...ok, workedOn: "2025-12-27" }, compCtx()).ok, true);
    const lateJoiner = { ...employee, joiningDate: "2026-11-02" };
    assert.equal(!validateCompOffInput(ok, { ...compCtx(), employee: lateJoiner }).ok, true);
  });

  test("rejects a missing date and an unknown day length", () => {
    assert.equal(!validateCompOffInput({ ...ok, workedOn: "" }, compCtx()).ok, true);
    assert.equal(!validateCompOffInput({ ...ok, dayLength: "double" }, compCtx()).ok, true);
  });

  test("the same day can't be claimed twice, unless the earlier claim was rejected", () => {
    const again = (status: LeaveRequest["status"]) =>
      validateCompOffInput(ok, compCtx([existing("Comp-off", status, "2026-10-31")])).ok;
    assert.equal(again("pending"), false);
    assert.equal(again("approved"), false);
    assert.equal(again("rejected"), true);
  });
});

describe("noting a permission", () => {
  const ok = { date: "2026-11-05", from: "10:00", to: "11:00", reason: "Bank work" }; // a Thursday
  const ctx = (leave: LeaveRequest[] = [], permissions: Permission[] = []) => ({
    today,
    holidays: defaultHolidays,
    leave,
    permissions,
  });
  const taken = (date: string, from: string, to: string): Permission => ({
    id: "p",
    employeeId: "x",
    date,
    from,
    to,
    minutes: 60,
    reason: "",
  });

  test("an hour on a working day is accepted, with its length worked out", () => {
    const r = validatePermissionInput(ok, ctx());
    assert.deepEqual(r.ok && r.value, {
      date: "2026-11-05",
      from: "10:00",
      to: "11:00",
      minutes: 60,
      reason: "Bank work",
    });
  });

  test("any length up to 8 hours works, to the minute, and the reason is optional and trimmed", () => {
    const r = validatePermissionInput({ ...ok, from: "09:15", to: "10:00", reason: "  " }, ctx());
    assert.deepEqual(r.ok && [r.value.minutes, r.value.reason], [45, ""]);
    assert.equal(validatePermissionInput({ ...ok, from: "09:00", to: "17:00" }, ctx()).ok, true); // exactly 8 hours
    assert.equal(validatePermissionInput({ ...ok, from: "09:00", to: "17:01" }, ctx()).ok, false);
  });

  test("the end has to be after the start, and both times have to be real", () => {
    assert.equal(!validatePermissionInput({ ...ok, from: "11:00", to: "10:00" }, ctx()).ok, true);
    assert.equal(!validatePermissionInput({ ...ok, from: "10:00", to: "10:00" }, ctx()).ok, true);
    for (const from of ["", "25:00", "9:00", "10:60", "ten"]) {
      const r = validatePermissionInput({ ...ok, from }, ctx());
      assert.equal(!r.ok && !!r.errors.from, true, from);
    }
    assert.equal(!validatePermissionInput({ ...ok, to: "" }, ctx()).ok, true);
  });

  test("a weekend or national holiday doesn't need a permission", () => {
    for (const date of ["2026-11-07", "2026-11-08", "2026-10-02"]) {
      const r = validatePermissionInput({ ...ok, date }, ctx());
      assert.equal(!r.ok && !!r.errors.date, true, date);
    }
  });

  test("the day has to be real and within this year to the end of next", () => {
    for (const date of ["", "2026-02-30", "2025-12-31", "2028-01-03"]) {
      assert.equal(!validatePermissionInput({ ...ok, date }, ctx()).ok, true, date);
    }
    assert.equal(validatePermissionInput({ ...ok, date: "2026-01-05" }, ctx()).ok, true);
  });

  test("a long reason is refused", () => {
    assert.equal(validatePermissionInput({ ...ok, reason: "x".repeat(200) }, ctx()).ok, true);
    assert.equal(validatePermissionInput({ ...ok, reason: "x".repeat(201) }, ctx()).ok, false);
  });

  test("it can't overlap another permission that day, but back-to-back or another day is fine", () => {
    const other = [taken("2026-11-05", "10:30", "11:30")];
    const overlap = validatePermissionInput(ok, ctx([], other));
    assert.equal(!overlap.ok && !!overlap.errors.form, true);
    assert.equal(validatePermissionInput({ ...ok, from: "11:30", to: "12:30" }, ctx([], other)).ok, true);
    assert.equal(validatePermissionInput({ ...ok, from: "09:30", to: "10:30" }, ctx([], other)).ok, true);
    assert.equal(validatePermissionInput({ ...ok, date: "2026-11-06" }, ctx([], other)).ok, true);
  });

  test("it can't be on a day you already have leave, unless that leave was rejected or cancelled", () => {
    const leave = (status: LeaveRequest["status"]) => [existing("Casual leave", status, "2026-11-04", "2026-11-06")];
    assert.equal(validatePermissionInput(ok, ctx(leave("approved"))).ok, false);
    assert.equal(validatePermissionInput(ok, ctx(leave("pending"))).ok, false);
    assert.equal(validatePermissionInput(ok, ctx(leave("rejected"))).ok, true);
    assert.equal(validatePermissionInput(ok, ctx(leave("cancelled"))).ok, true);
    assert.equal(validatePermissionInput(ok, ctx([existing("Comp-off", "approved", "2026-11-05")])).ok, true);
  });

  test("lengths read naturally", () => {
    assert.deepEqual([30, 60, 90, 120, 0].map(formatMinutes), ["30 min", "1 hr", "1 hr 30 min", "2 hr", "0 min"]);
  });
});
