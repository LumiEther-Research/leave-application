// Types and policy constants. The data itself lives in Neon Postgres (see
// src/lib/store.ts and db/migrations); everything on the dashboards is derived
// from those records (see src/lib/leave.ts).

/**
 * Leave policy
 * - 5-day week: Saturday and Sunday are non-working days.
 * - Every employee belongs to a category (contractor, employee, intern or
 *   student). An admin sets how many leave days a year each category gets, so
 *   it isn't a fixed number. Employees are never shown that number.
 * - Weekends and the 4 national holidays are never deducted. Casual and sick
 *   leave both count toward the yearly days. Regular leave does not expire.
 * - Working a national holiday or a weekend day earns 1 comp-off day (0.5 for
 *   a half day). It is requested as a "Comp-off" request, and only counts once
 *   the admin approves it.
 * - Approved comp-off is added to the same balance. It expires on the first
 *   joining anniversary after the day it was earned.
 * - Leave draws on the soonest-expiring comp-off first, then on the regular days.
 * - A leave request that would take the balance below zero is blocked.
 * - A permission is a few hours off on one working day. It is noted for the
 *   admin and never deducted from leave.
 * - Pending leave can be withdrawn. Approved leave that hasn't started can be
 *   cancelled once an admin approves the cancellation; its days then return.
 */

export const CATEGORIES = ["contractor", "employee", "intern", "student"] as const;
export type Category = (typeof CATEGORIES)[number];
export const categoryLabel: Record<Category, string> = {
  contractor: "Contractor",
  employee: "Employee",
  intern: "Intern",
  student: "Student",
};

/** Yearly leave days for one category, set by an admin. */
export type LeaveCategory = { category: Category; daysPerYear: number };

/** A short absence (a few hours on one working day), noted for the admin. Never deducted from leave. */
export type Permission = {
  id: string;
  employeeId: string;
  date: string; // ISO date
  from: string; // "HH:MM"
  to: string; // "HH:MM"
  minutes: number;
  reason: string;
};

export type Employee = {
  id: string;
  name: string;
  role: "admin" | "employee";
  category: Category;
  /** Leave days per year: the days an admin set for this employee's category */
  leaveAllowance: number;
  /** Gmail address used to sign in */
  email: string;
  /** ISO date. Comp-off expires on the joining anniversary. */
  joiningDate: string;
};

/**
 * Casual and sick leave are taken from the balance. A "Comp-off" request is a
 * claim for working a holiday or weekend day (`from` = the day worked), which
 * adds to the balance once approved.
 */
export type LeaveType = "Casual leave" | "Sick leave" | "Comp-off";
/** "cancelled": withdrawn while pending, or cancelled after approval (see `cancelRequested`). Counts for nothing. */
export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

export type LeaveRequest = {
  id: string;
  employeeId: string;
  type: LeaveType;
  status: LeaveStatus;
  from: string; // ISO date, inclusive
  to: string; // ISO date, inclusive
  appliedOn: string;
  /** Comp-off: worked half a day, so earns 0.5. Leave: a half day off, single day only, takes 0.5. */
  halfDay?: boolean;
  /**
   * Approved leave only: the employee asked to cancel it. It keeps counting and
   * the person stays "out" until an admin approves the cancellation.
   */
  cancelRequested?: boolean;
  /** ISO date the cancellation was requested */
  cancelRequestedOn?: string;
};

export type Holiday = { name: string; month: number; day: number };

/** Days taken per month before the app tracked requests (index 0 = Jan), split by type. */
export type PastLeave = { casual: number[]; sick: number[] };

/** Year that past-leave summary covers (see getLeaveEntries). */
export const PAST_LEAVE_YEAR = 2026;

/** Earlier snapshots, used only to compute the trend lines. No history yet. */
export const previousSnapshot = {
  pendingRequests: 0, // last week
  peopleOutToday: 0, // yesterday
};

/**
 * The four national holidays as seeded by db/migrations/001_init.sql. The app
 * reads holidays from the database; this copy exists for the pure tests only.
 */
export const defaultHolidays: Holiday[] = [
  { name: "Republic Day", month: 1, day: 26 },
  { name: "Labour Day", month: 5, day: 1 },
  { name: "Independence Day", month: 8, day: 15 },
  { name: "Gandhi Jayanti", month: 10, day: 2 },
];
