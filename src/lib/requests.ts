// Validation for what an employee submits: a leave request or a comp-off claim.
// Pure, so it can be tested. The store runs these before saving anything.
import { addDays, isWeekend, parseISO, toISODate } from "./dates";
import { compOffDaysFor, leaveDays } from "./leave";
import type { Employee, Holiday, LeaveRequest, Permission } from "./types";

export const LEAVE_TYPES = ["Casual leave", "Sick leave"] as const;
export type RequestableLeaveType = (typeof LEAVE_TYPES)[number];
export const MAX_LEAVE_RANGE_DAYS = 90;

/** `dayLength` is "full" or "half". A half day is a single working day, so `to` is ignored. */
export type LeaveInput = { type: string; from: string; to: string; dayLength: string };
export type LeaveErrors = Partial<Record<keyof LeaveInput | "form", string>>;

export type CompOffInput = { workedOn: string; dayLength: string };
export type CompOffErrors = Partial<Record<keyof CompOffInput | "form", string>>;

/** Not rejected and not cancelled, so it still holds its dates. */
const isLive = (r: LeaveRequest) => r.status !== "rejected" && r.status !== "cancelled";

const isRealDate = (iso: string) => /^\d{4}-\d{2}-\d{2}$/.test(iso) && toISODate(parseISO(iso)) === iso;

/** Both leave and comp-off requests start at the beginning of this year at the earliest. */
const startOfYear = (today: Date) => `${today.getFullYear()}-01-01`;

export function validateLeaveInput(
  input: LeaveInput,
  ctx: { today: Date; holidays: Holiday[]; mine: LeaveRequest[] },
):
  | { ok: true; value: { type: RequestableLeaveType; from: string; to: string; halfDay: boolean } }
  | { ok: false; errors: LeaveErrors } {
  const errors: LeaveErrors = {};
  const halfDay = input.dayLength === "half";
  const { from } = input;
  const to = halfDay ? from : input.to;
  const type = LEAVE_TYPES.find((t) => t === input.type);

  if (input.dayLength !== "full" && !halfDay) errors.dayLength = "Choose a full or half day.";

  if (!type) errors.type = "Choose casual or sick leave.";
  if (!isRealDate(from)) errors.from = "Pick a start date.";
  if (!isRealDate(to)) errors.to = "Pick an end date.";

  if (!errors.from && !errors.to) {
    const lastDay = `${ctx.today.getFullYear() + 1}-12-31`;
    if (from < startOfYear(ctx.today)) errors.from = "Leave can't start before this year.";
    else if (to < from) errors.to = "The end date can't be before the start date.";
    else if (to > lastDay) errors.to = "Leave can't end after next year.";
    else if (parseISO(to) > addDays(parseISO(from), MAX_LEAVE_RANGE_DAYS - 1))
      errors.to = `A request can cover at most ${MAX_LEAVE_RANGE_DAYS} days.`;
  }

  if (!errors.from && !errors.to && type) {
    const probe = { from, to, type, halfDay } as LeaveRequest;
    if (leaveDays(probe, ctx.holidays) === 0) {
      errors.form = halfDay
        ? "That day is a weekend or a national holiday, so there's nothing to take off."
        : "Those dates are all weekends or national holidays, so there's nothing to take off.";
    } else if (ctx.mine.some((r) => r.type !== "Comp-off" && isLive(r) && r.from <= to && r.to >= from)) {
      errors.form = "You already have leave that overlaps these dates.";
    }
  }

  return Object.keys(errors).length || !type ? { ok: false, errors } : { ok: true, value: { type, from, to, halfDay } };
}

export function validateCompOffInput(
  input: CompOffInput,
  ctx: { today: Date; holidays: Holiday[]; mine: LeaveRequest[]; employee: Employee },
): { ok: true; value: { workedOn: string; halfDay: boolean } } | { ok: false; errors: CompOffErrors } {
  const errors: CompOffErrors = {};
  const { workedOn } = input;
  const halfDay = input.dayLength === "half";

  if (input.dayLength !== "full" && input.dayLength !== "half") errors.dayLength = "Choose a full or half day.";

  if (!isRealDate(workedOn)) errors.workedOn = "Pick the day you worked.";
  else if (workedOn > toISODate(ctx.today)) errors.workedOn = "That day hasn't happened yet.";
  else if (workedOn < startOfYear(ctx.today)) errors.workedOn = "Comp-off can't be claimed for days before this year.";
  else if (workedOn < ctx.employee.joiningDate) errors.workedOn = "That's before your joining date.";
  else if (compOffDaysFor(workedOn, halfDay, ctx.holidays) === 0)
    errors.workedOn = "That was a working day, so it doesn't earn comp-off. Pick a weekend or a national holiday.";
  else if (ctx.mine.some((r) => r.type === "Comp-off" && isLive(r) && r.from === workedOn))
    errors.workedOn = "You've already claimed comp-off for that day.";

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: { workedOn, halfDay } };
}

export type CancelPlan = { ok: true; action: "withdraw" | "request" } | { ok: false; error: string };

/**
 * What cancelling a leave request does, if it can be done at all:
 * pending leave is withdrawn straight away (nothing was granted yet), and
 * approved leave that hasn't started goes to an admin as a cancellation request.
 */
export function planCancellation(r: LeaveRequest, today: Date): CancelPlan {
  if (r.type === "Comp-off") return { ok: false, error: "Comp-off requests can't be cancelled here." };
  if (r.status === "pending") return { ok: true, action: "withdraw" };
  if (r.status !== "approved") return { ok: false, error: "That request is already closed." };
  if (r.cancelRequested) return { ok: false, error: "You've already asked to cancel this leave." };
  if (r.from < toISODate(today))
    return { ok: false, error: "This leave has already started, so it can't be cancelled." };
  return { ok: true, action: "request" };
}

// ------------------------------------------------------------------ permissions

export const MAX_PERMISSION_MINUTES = 8 * 60;
export const MAX_REASON_LENGTH = 200;

export type PermissionInput = { date: string; from: string; to: string; reason: string };
export type PermissionErrors = Partial<Record<keyof PermissionInput | "form", string>>;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** "1 hr", "30 min", "1 hr 30 min". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h > 0 && `${h} hr`, m > 0 && `${m} min`].filter(Boolean).join(" ") || "0 min";
}

/**
 * A permission is a few hours off on one working day. It's noted for the admin and never deducted from
 * leave. It can't overlap another permission of yours, or a day of leave you already have.
 */
export function validatePermissionInput(
  input: PermissionInput,
  ctx: { today: Date; holidays: Holiday[]; leave: LeaveRequest[]; permissions: Permission[] },
):
  | { ok: true; value: { date: string; from: string; to: string; minutes: number; reason: string } }
  | { ok: false; errors: PermissionErrors } {
  const errors: PermissionErrors = {};
  const { date, from, to } = input;
  const reason = input.reason.trim();

  if (!isRealDate(date)) errors.date = "Pick the day.";
  else if (date < startOfYear(ctx.today)) errors.date = "That day is before this year.";
  else if (date > `${ctx.today.getFullYear() + 1}-12-31`) errors.date = "That day is too far ahead.";
  else if (
    isWeekend(parseISO(date)) ||
    ctx.holidays.some((h) => h.month === Number(date.slice(5, 7)) && h.day === Number(date.slice(8, 10)))
  ) {
    errors.date = "That's a weekend or a national holiday, so no permission is needed.";
  }

  if (!TIME.test(from)) errors.from = "Pick a start time.";
  if (!TIME.test(to)) errors.to = "Pick an end time.";
  let minutes = 0;
  if (!errors.from && !errors.to) {
    minutes = toMinutes(to) - toMinutes(from);
    if (minutes <= 0) errors.to = "The end time has to be after the start time.";
    else if (minutes > MAX_PERMISSION_MINUTES)
      errors.to = "A permission can be at most 8 hours. Request leave for a full day.";
  }
  if (reason.length > MAX_REASON_LENGTH) errors.reason = `Keep it under ${MAX_REASON_LENGTH} characters.`;

  if (!errors.date && !errors.from && !errors.to) {
    if (ctx.permissions.some((p) => p.date === date && p.from < to && p.to > from)) {
      errors.form = "You already have a permission that overlaps this time.";
    } else if (
      ctx.leave.some(
        (r) =>
          r.type !== "Comp-off" &&
          (r.status === "pending" || r.status === "approved") &&
          r.from <= date &&
          r.to >= date,
      )
    ) {
      errors.form = "You already have leave on that day.";
    }
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: { date, from, to, minutes, reason } };
}
