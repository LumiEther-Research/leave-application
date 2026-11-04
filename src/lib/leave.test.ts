// Run with `npm test`. Covers the leave policy: one balance of 24 days plus
// approved comp-off, weekends and national holidays not deducted, comp-off
// expiry and deduction order, and blocking requests that overdraw the balance.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  appliedLeaveDays,
  checkLeaveRequest,
  leaveDays,
  compOffDaysFor,
  compOffExpiry,
  getAwaitingDecision,
  getCompOffLots,
  getLeaveBalances,
  getLeaveEntries,
  getOutOn,
  isCancelRequest,
  summariseCompOff,
  type CompOffLot,
} from "./leave";
import { parseISO } from "./dates";
import { defaultHolidays, type Employee, type LeaveRequest, type LeaveType } from "./types";

const TODAY = "2026-11-04";
const today = parseISO(TODAY);

// Joined 10 Mar 2024, so comp-off expires on 10 March.
const me: Employee = {
  id: "x",
  name: "Test Person",
  email: "test.person@gmail.com",
  role: "employee",
  category: "employee",
  leaveAllowance: 24,
  joiningDate: "2024-03-10",
};

const request = (
  type: LeaveType,
  status: LeaveRequest["status"],
  from: string,
  to = from,
  halfDay?: boolean,
): LeaveRequest => ({
  id: `${type}-${from}-${status}`,
  employeeId: me.id,
  type,
  status,
  from,
  to,
  appliedOn: "2026-01-01",
  halfDay,
});

/** A comp-off claim for working `workedOn`. */
const claim = (status: LeaveRequest["status"], workedOn: string, halfDay?: boolean) =>
  request("Comp-off", status, workedOn, workedOn, halfDay);

const balanceOf = (requests: LeaveRequest[], past = {}) => {
  const entries = getLeaveEntries(requests, past, defaultHolidays, 2026);
  return getLeaveBalances([me], entries, requests, defaultHolidays, 2026, today)[0];
};

/** A lot with an explicit expiry, to test ordering independent of the joining date. */
/** Full days of leave on these dates. */
const full = (...dates: string[]) => dates.map((date) => ({ date, days: 1 }));

const lot = (id: string, workedOn: string, expiresOn: string, days = 1): CompOffLot => ({
  id,
  employeeId: me.id,
  workedOn,
  days,
  expiresOn,
  status: "approved",
});

describe("24-day leave quota", () => {
  test("sick leave counts toward the 24, same as casual", () => {
    const leave = balanceOf([
      request("Casual leave", "approved", "2026-03-02", "2026-03-04"), // 3
      request("Sick leave", "approved", "2026-04-06", "2026-04-07"), // 2
    ]);
    assert.equal(leave.casual, 3);
    assert.equal(leave.sick, 2);
    assert.equal(leave.used, 5);
    assert.equal(leave.remaining, 19);
  });

  test("pending and rejected requests don't reduce the remaining days", () => {
    const leave = balanceOf([
      request("Casual leave", "pending", "2026-03-02", "2026-03-04"),
      request("Sick leave", "rejected", "2026-04-06"),
    ]);
    assert.equal(leave.used, 0);
    assert.equal(leave.remaining, 24);
  });

  test("a national holiday inside a request isn't deducted", () => {
    // Tue 29 Sep to Fri 2 Oct 2026 includes Gandhi Jayanti (2 Oct): 3 days count.
    const leave = balanceOf([request("Casual leave", "approved", "2026-09-29", "2026-10-02")]);
    assert.equal(leave.used, 3);
  });

  test("weekends aren't deducted: Fri 13 to Mon 16 Nov is 2 days", () => {
    const leave = balanceOf([request("Casual leave", "approved", "2026-11-13", "2026-11-16")]);
    assert.equal(leave.used, 2);
  });
});

describe("earning comp-off", () => {
  test("a Saturday, a Sunday and a national holiday each earn 1 day", () => {
    assert.equal(compOffDaysFor("2026-10-31", false, defaultHolidays), 1); // Sat
    assert.equal(compOffDaysFor("2026-11-01", false, defaultHolidays), 1); // Sun
    assert.equal(compOffDaysFor("2026-10-02", false, defaultHolidays), 1); // Gandhi Jayanti, a Friday
  });

  test("a half day worked earns 0.5", () => {
    assert.equal(compOffDaysFor("2026-10-31", true, defaultHolidays), 0.5);
  });

  test("an ordinary working day earns nothing", () => {
    assert.equal(compOffDaysFor("2026-11-04", false, defaultHolidays), 0);
  });
});

describe("comp-off expiry", () => {
  test("expires on the first joining anniversary after the day it was earned", () => {
    // Joined 10 Mar 2024.
    assert.equal(compOffExpiry("2024-03-10", "2026-01-26"), "2026-03-10"); // before this year's anniversary
    assert.equal(compOffExpiry("2024-03-10", "2026-03-14"), "2027-03-10"); // after it
    assert.equal(compOffExpiry("2024-03-10", "2026-12-31"), "2027-03-10");
  });

  test("earned on the anniversary itself, it lasts until the next one", () => {
    assert.equal(compOffExpiry("2024-03-10", "2026-03-10"), "2027-03-10");
  });

  test("a 29 Feb joiner's anniversary is 28 Feb in a non-leap year", () => {
    assert.equal(compOffExpiry("2024-02-29", "2026-01-03"), "2026-02-28");
    assert.equal(compOffExpiry("2024-02-29", "2027-03-01"), "2028-02-29");
  });

  test("each entry carries its expiry, taken from the employee's joining date", () => {
    const [entry] = getCompOffLots([claim("approved", "2026-08-15")], [me], defaultHolidays);
    assert.equal(entry.expiresOn, "2027-03-10");
  });

  test("usable up to the day before the anniversary, not on it", () => {
    // Earned Sat 7 Feb 2026, expires 10 Mar 2026. Leave on Mon 9 Mar uses it; Tue 10 Mar can't.
    const lots = getCompOffLots([claim("approved", "2026-02-07")], [me], defaultHolidays);
    const before = summariseCompOff(lots, full("2026-03-09"), "2026-03-09");
    assert.equal(before.available, 0); // spent on the 9th
    const onDay = summariseCompOff(lots, full("2026-03-10"), "2026-03-10");
    assert.deepEqual(onDay, { granted: 0, available: 0, expired: 1 }); // the 10th falls to the regular 24
  });

  test("unused comp-off drops out of the balance once it expires", () => {
    const before = balanceOf([claim("approved", "2026-01-26")]); // expires 10 Mar 2026, today is 4 Nov
    assert.equal(before.total, 24);
    assert.equal(before.compOffExpired, 1);
  });

  test("regular leave does not expire: an unused day is still there in November", () => {
    const b = balanceOf([request("Casual leave", "approved", "2026-02-02")]);
    assert.equal(b.remaining, 23); // still there in November
  });
});

describe("half-day leave", () => {
  const halfDay = (status: LeaveRequest["status"], day: string, type: LeaveType = "Casual leave") =>
    request(type, status, day, day, true);

  test("counts as 0.5 day", () => {
    assert.equal(leaveDays(halfDay("approved", "2026-11-16"), defaultHolidays), 0.5);
    assert.equal(leaveDays(request("Casual leave", "approved", "2026-11-16"), defaultHolidays), 1);
  });

  test("takes 0.5 from the balance, casual and sick alike", () => {
    const b = balanceOf([halfDay("approved", "2026-11-16"), halfDay("approved", "2026-11-17", "Sick leave")]);
    assert.deepEqual([b.casual, b.sick, b.used, b.remaining], [0.5, 0.5, 1, 23]);
  });

  test("pending and rejected half days don't reduce the balance", () => {
    const b = balanceOf([halfDay("pending", "2026-11-16"), halfDay("rejected", "2026-11-17")]);
    assert.equal(b.remaining, 24);
  });

  test("a half day uses comp-off first, same as a full day", () => {
    const b = balanceOf([claim("approved", "2026-10-31"), halfDay("approved", "2026-11-05")]);
    assert.equal(b.total, 25);
    assert.equal(b.remaining, 24.5);
    assert.equal(b.compOffAvailable, 0.5); // half the comp-off day is still there
  });

  test("a half-day comp-off lot covers a half day exactly", () => {
    const b = balanceOf([claim("approved", "2026-10-31", true), halfDay("approved", "2026-11-05")]);
    assert.deepEqual([b.total, b.remaining, b.compOffAvailable], [24.5, 24, 0]);
  });

  test("two half days on one comp-off day use all of it, and a third half day falls to the regular 24", () => {
    const b = balanceOf([
      claim("approved", "2026-10-31"),
      halfDay("approved", "2026-11-05"),
      halfDay("approved", "2026-11-06"),
      halfDay("approved", "2026-11-09"),
    ]);
    assert.deepEqual([b.used, b.compOffAvailable, b.remaining], [1.5, 0, 23.5]);
  });

  test("shows up in the monthly chart as half a day", () => {
    const entries = getLeaveEntries([halfDay("approved", "2026-11-16")], {}, defaultHolidays, 2026);
    assert.deepEqual(
      entries.map((e) => [e.month, e.days]),
      [[10, 0.5]],
    );
  });
});

describe("cancelled leave", () => {
  test("cancelled leave takes nothing from the balance", () => {
    const b = balanceOf([request("Casual leave", "cancelled", "2026-11-16", "2026-11-18")]);
    assert.deepEqual([b.used, b.remaining], [0, 24]);
  });

  test("the days of cancelled leave return, including to the chart", () => {
    const entries = getLeaveEntries([request("Casual leave", "cancelled", "2026-11-16")], {}, defaultHolidays, 2026);
    assert.deepEqual(entries, []);
  });

  test("leave with a cancellation still waiting keeps counting, and the person stays out, until it's approved", () => {
    const waiting = { ...request("Casual leave", "approved", "2026-11-16"), cancelRequested: true };
    assert.equal(balanceOf([waiting]).used, 1);
    assert.equal(getOutOn([waiting], parseISO("2026-11-16")).length, 1);
    assert.equal(isCancelRequest(waiting), true);
    assert.equal(isCancelRequest(request("Casual leave", "approved", "2026-11-16")), false);
  });

  test("comp-off used by cancelled leave is available again", () => {
    const used = balanceOf([claim("approved", "2026-10-31"), request("Casual leave", "approved", "2026-11-05")]);
    assert.equal(used.compOffAvailable, 0);
    const cancelled = balanceOf([claim("approved", "2026-10-31"), request("Casual leave", "cancelled", "2026-11-05")]);
    assert.deepEqual([cancelled.compOffAvailable, cancelled.remaining], [1, 25]);
  });

  test("everything waiting on an admin: pending requests plus cancellation requests", () => {
    const waiting = { ...request("Casual leave", "approved", "2026-11-16"), cancelRequested: true };
    const all = [
      request("Casual leave", "pending", "2026-11-17"),
      request("Casual leave", "approved", "2026-11-18"),
      request("Casual leave", "cancelled", "2026-11-19"),
      request("Casual leave", "rejected", "2026-11-20"),
      waiting,
    ];
    assert.deepEqual(
      getAwaitingDecision(all).map((r) => r.from),
      ["2026-11-17", "2026-11-16"],
    );
  });
});

describe("one balance with comp-off in it", () => {
  test("approved comp-off adds to the total and the remaining days", () => {
    const b = balanceOf([claim("approved", "2026-10-31"), claim("approved", "2026-09-19", true)]);
    assert.equal(b.total, 25.5);
    assert.equal(b.remaining, 25.5);
    assert.equal(b.compOffAvailable, 1.5);
  });

  test("taking leave reduces the same balance, and the comp-off part shrinks first", () => {
    const b = balanceOf([claim("approved", "2026-10-31"), request("Casual leave", "approved", "2026-11-05")]);
    assert.equal(b.total, 25);
    assert.equal(b.used, 1);
    assert.equal(b.remaining, 24);
    assert.equal(b.compOffAvailable, 0); // the day came out of comp-off
  });
});

describe("deduction order", () => {
  const lots = [lot("later", "2026-01-03", "2026-12-01"), lot("sooner", "2026-01-10", "2026-09-01")];

  test("leave comes out of the comp-off that expires soonest", () => {
    // One leave day on 1 Jun: it takes "sooner" even though "later" was earned first.
    const one = summariseCompOff(lots, full("2026-06-01"), "2026-06-02");
    assert.equal(one.available, 1);
    // Let "sooner" lapse unused vs used: today after 1 Sep, the day used on "sooner" is granted, "later" remains.
    const afterSooner = summariseCompOff(lots, full("2026-06-01"), "2026-10-01");
    assert.deepEqual(afterSooner, { granted: 2, available: 1, expired: 0 });
  });

  test("when two lots expire together, the one earned first goes first", () => {
    const a = lot("a", "2026-01-03", "2026-12-01");
    const b = lot("b", "2026-01-10", "2026-12-01");
    const r = summariseCompOff([b, a], full("2026-06-01"), "2026-11-04");
    assert.equal(r.available, 1);
    // "b" is the one left: a day dated before it was earned can't use it.
    assert.equal(summariseCompOff([b, a], full("2026-01-05", "2026-01-06"), "2026-11-04").available, 1);
  });

  test("once comp-off runs out, leave falls to the regular 24", () => {
    const b = balanceOf([
      claim("approved", "2026-10-31"),
      request("Casual leave", "approved", "2026-11-05", "2026-11-06"),
    ]);
    assert.equal(b.used, 2);
    assert.equal(b.total, 25);
    assert.equal(b.remaining, 23);
    assert.equal(b.compOffAvailable, 0);
  });

  test("a half-day lot covers half a leave day, the rest comes from the next source", () => {
    const r = summariseCompOff([lot("h", "2026-01-03", "2026-12-01", 0.5)], full("2026-06-01"), "2026-11-04");
    assert.deepEqual(r, { granted: 0.5, available: 0, expired: 0 });
  });

  test("comp-off can't cover a day before it was earned", () => {
    const r = summariseCompOff([lot("n", "2026-10-31", "2027-03-10")], full("2026-10-30"), "2026-11-04");
    assert.equal(r.available, 1);
  });
});

describe("pending comp-off", () => {
  test("a pending claim doesn't count toward the balance", () => {
    const b = balanceOf([claim("pending", "2026-10-31")]);
    assert.equal(b.total, 24);
    assert.equal(b.remaining, 24);
    assert.equal(b.compOffAvailable, 0);
  });

  test("it counts once approved, and a rejected claim never does", () => {
    assert.equal(balanceOf([claim("approved", "2026-10-31")]).total, 25);
    assert.equal(balanceOf([claim("rejected", "2026-10-31")]).total, 24);
  });

  test("leave can't draw on a pending claim", () => {
    const b = balanceOf([claim("pending", "2026-10-31"), request("Casual leave", "approved", "2026-11-05")]);
    assert.equal(b.remaining, 23);
  });
});

describe("blocking leave that overdraws the balance", () => {
  // 24 days taken Jan to Aug, none left.
  const allUsed = { x: { casual: [3, 3, 3, 3, 3, 3, 3, 3, 0, 0], sick: Array(10).fill(0) } };
  const ctx = (requests: LeaveRequest[], past = allUsed) => ({
    employees: [me],
    requests,
    past,
    holidays: defaultHolidays,
    today,
  });
  const ask = (from: string, to = from) => request("Casual leave", "pending", from, to);

  test("blocked when the balance is empty", () => {
    const result = checkLeaveRequest(ask("2026-11-09"), ctx([]));
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.shortfall, 1);
  });

  test("allowed when exactly enough is left, blocked one day beyond", () => {
    const past = { x: { casual: [3, 3, 3, 3, 3, 3, 3, 2, 0, 0], sick: Array(10).fill(0) } }; // 23 used
    assert.equal(checkLeaveRequest(ask("2026-11-09"), ctx([], past)).ok, true);
    const two = checkLeaveRequest(ask("2026-11-09", "2026-11-10"), ctx([], past));
    assert.equal(two.ok, false);
    assert.equal(!two.ok && two.shortfall, 1);
  });

  test("pending requests already on the books are reserved", () => {
    const past = { x: { casual: [3, 3, 3, 3, 3, 3, 3, 2, 0, 0], sick: Array(10).fill(0) } };
    const result = checkLeaveRequest(ask("2026-11-10"), ctx([ask("2026-11-09")], past));
    assert.equal(result.ok, false);
  });

  test("approved comp-off makes room", () => {
    const withComp = [claim("approved", "2026-10-31")];
    assert.equal(checkLeaveRequest(ask("2026-11-09"), ctx(withComp)).ok, true);
    assert.equal(checkLeaveRequest(ask("2026-11-09", "2026-11-10"), ctx(withComp)).ok, false);
  });

  test("pending or expired comp-off doesn't", () => {
    assert.equal(checkLeaveRequest(ask("2026-11-09"), ctx([claim("pending", "2026-10-31")])).ok, false);
    assert.equal(checkLeaveRequest(ask("2026-11-09"), ctx([claim("approved", "2026-01-26")])).ok, false); // expired 10 Mar
  });

  test("with half a day left a half day is allowed and a full day is blocked; with none left both are", () => {
    const past = { x: { casual: [3, 3, 3, 3, 3, 3, 3, 2.5, 0, 0], sick: Array(10).fill(0) } }; // 23.5 used
    const half = request("Casual leave", "pending", "2026-11-09", "2026-11-09", true);
    assert.equal(checkLeaveRequest(half, ctx([], past)).ok, true);
    assert.equal(checkLeaveRequest(ask("2026-11-09"), ctx([], past)).ok, false);
    assert.equal(checkLeaveRequest(half, ctx([])).ok, false); // 24 used (allUsed)
  });

  test("a request that only covers a weekend takes 0 days, so it isn't blocked", () => {
    assert.equal(checkLeaveRequest(ask("2026-11-14", "2026-11-15"), ctx([])).ok, true);
  });

  test("comp-off claims are never blocked", () => {
    assert.equal(checkLeaveRequest(claim("pending", "2026-10-31"), ctx([])).ok, true);
  });
});

describe("the app starts empty", () => {
  test("there is no seeded leave, comp-off or employee data to derive anything from", () => {
    const entries = getLeaveEntries([], {}, defaultHolidays, 2026);
    assert.deepEqual(entries, []);
    assert.deepEqual(getLeaveBalances([], entries, [], defaultHolidays, 2026, today), []);
    assert.deepEqual(getCompOffLots([], [], defaultHolidays), []);
  });

  test("the four national holidays are kept", () => {
    assert.deepEqual(
      defaultHolidays.map((h) => `${h.name} ${h.day}/${h.month}`),
      ["Republic Day 26/1", "Labour Day 1/5", "Independence Day 15/8", "Gandhi Jayanti 2/10"],
    );
  });

  test("a new employee with no leave has the full 24 days", () => {
    const b = balanceOf([]);
    assert.equal(b.total, 24);
    assert.equal(b.remaining, 24);
  });
});

describe("what an employee sees instead of their allowance", () => {
  const applied = (requests: LeaveRequest[]) => appliedLeaveDays(requests, defaultHolidays, 2026);

  test("days applied for, split into approved and waiting, with half days counted as half", () => {
    const r = applied([
      request("Casual leave", "approved", "2026-11-16", "2026-11-18"), // 3
      request("Sick leave", "pending", "2026-11-19", "2026-11-19", true), // 0.5
      request("Casual leave", "pending", "2026-12-01", "2026-12-02"), // 2
    ]);
    assert.deepEqual(r, { approved: 3, pending: 2.5, total: 5.5 });
  });

  test("rejected and cancelled leave, and comp-off claims, don't count", () => {
    const r = applied([
      request("Casual leave", "rejected", "2026-11-16"),
      request("Casual leave", "cancelled", "2026-11-17"),
      request("Comp-off", "approved", "2026-10-31"),
    ]);
    assert.deepEqual(r, { approved: 0, pending: 0, total: 0 });
  });

  test("weekends and national holidays aren't counted, and only days in the year are", () => {
    assert.equal(applied([request("Casual leave", "approved", "2026-11-13", "2026-11-16")]).total, 2); // Fri to Mon
    assert.equal(applied([request("Casual leave", "approved", "2026-12-30", "2027-01-04")]).total, 2); // 30, 31 Dec only
  });

  test("leave with a cancellation waiting still counts as applied until it's approved", () => {
    const waiting = { ...request("Casual leave", "approved", "2026-11-16"), cancelRequested: true };
    assert.equal(applied([waiting]).approved, 1);
  });

  test("a refused request never says by how much the balance was short", () => {
    const past = { x: { casual: [3, 3, 3, 3, 3, 3, 3, 3, 0, 0], sick: Array(10).fill(0) } }; // all 24 used
    const result = checkLeaveRequest(request("Casual leave", "pending", "2026-11-09"), {
      employees: [me],
      requests: [],
      past,
      holidays: defaultHolidays,
      today,
    });
    assert.equal(!result.ok && /enough leave/.test(result.message), true);
    assert.equal(!result.ok && /\d/.test(result.message), false, "no numbers in the message");
  });

  test("a category with fewer days blocks sooner", () => {
    const intern = { ...me, category: "intern" as const, leaveAllowance: 2 };
    const ctx = {
      employees: [intern],
      requests: [request("Casual leave", "approved", "2026-11-09")],
      past: {},
      holidays: defaultHolidays,
      today,
    };
    assert.equal(checkLeaveRequest(request("Casual leave", "pending", "2026-11-10"), ctx).ok, true); // 2 days in all
    assert.equal(checkLeaveRequest(request("Casual leave", "pending", "2026-11-10", "2026-11-11"), ctx).ok, false); // 3 days
  });
});
