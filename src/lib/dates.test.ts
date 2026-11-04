// Run with `npm test` (Node's built-in test runner, no extra packages).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { differenceInCalendarDays, eachDayOfInterval, formatRange, parseISO, toISODate } from "./dates";
import { balanceDays, leaveDays as leaveDaysIn } from "./leave";
import { defaultHolidays, type LeaveRequest } from "./types";

/** A casual-leave request over an inclusive date range. */
const request = (from: string, to: string): LeaveRequest => ({
  id: "t",
  employeeId: "e1",
  type: "Casual leave",
  status: "approved",
  from,
  to,
  appliedOn: "2026-01-01",
});

const leaveDays = (r: LeaveRequest) => leaveDaysIn(r, defaultHolidays);

const isoDays = (from: string, to: string) =>
  eachDayOfInterval({ start: parseISO(from), end: parseISO(to) }).map(toISODate);

/** Days that count against the 24-day quota, as month indexes (0 = Jan). */
const countedMonths = (from: string, to: string, year: number) =>
  balanceDays(request(from, to), defaultHolidays, year).map((d) => d.month);

describe("range across a month boundary", () => {
  test("Fri 30 Oct to Mon 2 Nov is 2 working days (the weekend is skipped), 1 in each month", () => {
    assert.equal(leaveDays(request("2026-10-30", "2026-11-02")), 2);
    assert.deepEqual(isoDays("2026-10-30", "2026-11-02"), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    assert.deepEqual(countedMonths("2026-10-30", "2026-11-02", 2026), [9, 10]);
  });

  test("formats as '30 Oct – 2 Nov', and a same-month range as '16–18 Nov'", () => {
    assert.equal(formatRange("2026-10-30", "2026-11-02"), "30 Oct – 2 Nov");
    assert.equal(formatRange("2026-11-16", "2026-11-18"), "16–18 Nov");
  });

  test("across a year boundary, only days in the requested year count", () => {
    // Wed 30 Dec, Thu 31 Dec | Fri 1 Jan, Sat 2 Jan (weekend, skipped)
    assert.equal(leaveDays(request("2026-12-30", "2027-01-02")), 3);
    assert.equal(countedMonths("2026-12-30", "2027-01-02", 2026).length, 2);
    assert.equal(countedMonths("2026-12-30", "2027-01-02", 2027).length, 1);
  });
});

describe("leap-year February", () => {
  test("Sun 27 Feb to Wed 1 Mar 2028 includes 29 Feb: 3 working days", () => {
    assert.deepEqual(isoDays("2028-02-27", "2028-03-01"), ["2028-02-27", "2028-02-28", "2028-02-29", "2028-03-01"]);
    assert.equal(leaveDays(request("2028-02-27", "2028-03-01")), 3);
    assert.deepEqual(countedMonths("2028-02-27", "2028-03-01", 2028), [1, 1, 2]);
  });

  test("the same dates in a non-leap year (2027) are Sat to Mon: 1 working day", () => {
    assert.deepEqual(isoDays("2027-02-27", "2027-03-01"), ["2027-02-27", "2027-02-28", "2027-03-01"]);
    assert.equal(leaveDays(request("2027-02-27", "2027-03-01")), 1);
  });

  test("28 Feb to 1 Mar is 2 calendar days apart in 2028, 1 in 2027", () => {
    assert.equal(differenceInCalendarDays(parseISO("2028-03-01"), parseISO("2028-02-28")), 2);
    assert.equal(differenceInCalendarDays(parseISO("2027-03-01"), parseISO("2027-02-28")), 1);
  });

  test("Mon 28 Feb to Wed 1 Mar 2028 is 3 working days, all weekdays", () => {
    assert.equal(leaveDays(request("2028-02-28", "2028-03-01")), 3);
  });
});

describe("range that includes a weekend", () => {
  // Fri 13 Nov to Mon 16 Nov 2026 covers Sat 14 and Sun 15.
  test("Fri 13 to Mon 16 Nov is 2 days, not 4: Saturday and Sunday are not deducted", () => {
    const days = eachDayOfInterval({ start: parseISO("2026-11-13"), end: parseISO("2026-11-16") });
    assert.deepEqual(
      days.map((d) => d.getDay()),
      [5, 6, 0, 1],
    ); // Fri, Sat, Sun, Mon
    assert.equal(leaveDays(request("2026-11-13", "2026-11-16")), 2);
    assert.deepEqual(countedMonths("2026-11-13", "2026-11-16", 2026), [10, 10]);
  });

  test("a request that is only a weekend counts for 0 days", () => {
    assert.equal(leaveDays(request("2026-11-14", "2026-11-15")), 0);
  });

  test("a full week Mon 9 to Sun 15 Nov counts 5 days", () => {
    assert.equal(leaveDays(request("2026-11-09", "2026-11-15")), 5);
  });
});

describe("range that includes a national holiday", () => {
  // Gandhi Jayanti is Fri 2 Oct 2026.
  test("2 Oct inside Tue 29 Sep to Fri 2 Oct does not count: 4 weekdays, 3 counted", () => {
    assert.equal(leaveDays(request("2026-09-29", "2026-10-02")), 3);
    assert.equal(countedMonths("2026-09-29", "2026-10-02", 2026).length, 3);
  });

  test("a holiday on a weekend (15 Aug 2026 is a Saturday) is not double-removed", () => {
    // Fri 14 Aug to Mon 17 Aug: Fri and Mon count.
    assert.equal(leaveDays(request("2026-08-14", "2026-08-17")), 2);
  });

  test("a request that is only the holiday counts for 0 days", () => {
    assert.equal(countedMonths("2026-10-02", "2026-10-02", 2026).length, 0);
  });

  test("holidays repeat every year: 26 Jan 2027 inside 25-27 Jan counts 2 of 3 days", () => {
    assert.equal(countedMonths("2027-01-25", "2027-01-27", 2027).length, 2);
  });

  test("each of the four national holidays is excluded", () => {
    const holidayDates = ["2026-01-26", "2026-05-01", "2026-08-15", "2026-10-02"];
    for (const date of holidayDates) {
      assert.equal(countedMonths(date, date, 2026).length, 0, `${date} should not count`);
    }
  });
});

describe("single-day request", () => {
  test("counts as 1 day", () => {
    assert.equal(leaveDays(request("2026-11-13", "2026-11-13")), 1);
    assert.deepEqual(isoDays("2026-11-13", "2026-11-13"), ["2026-11-13"]);
    assert.deepEqual(countedMonths("2026-11-13", "2026-11-13", 2026), [10]);
  });

  test("formats as '13 Nov'", () => {
    assert.equal(formatRange("2026-11-13", "2026-11-13"), "13 Nov");
  });
});
