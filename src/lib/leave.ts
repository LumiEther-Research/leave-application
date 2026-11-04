import {
  anniversaryIn,
  eachDayOfInterval,
  endOfWeek,
  isWeekend,
  isWithinInterval,
  parseISO,
  startOfWeek,
  toISODate,
} from "./dates";
import { PAST_LEAVE_YEAR, type Employee, type Holiday, type LeaveRequest, type PastLeave } from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type MonthlyLeave = { month: string; approved: number; pending: number };

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

/** Working days in a request (0.5 for a half day): weekends and national holidays are not counted. */
export function leaveDays(r: LeaveRequest, holidays: Holiday[]): number {
  return sum(requestDays(r, holidays).map((d) => d.weight));
}

export const getPending = (requests: LeaveRequest[]) => requests.filter((r) => r.status === "pending");

/** Approved leave the employee has asked to cancel. */
export const isCancelRequest = (r: LeaveRequest) => r.status === "approved" && !!r.cancelRequested;

/** Everything waiting on an admin: pending requests and cancellation requests. */
export const getAwaitingDecision = (requests: LeaveRequest[]) =>
  requests.filter((r) => r.status === "pending" || isCancelRequest(r));

export function getOutOn(requests: LeaveRequest[], day: Date) {
  return requests.filter(
    (r) =>
      drawsOnBalance(r) &&
      r.status === "approved" &&
      isWithinInterval(day, { start: parseISO(r.from), end: parseISO(r.to) }),
  );
}

/** Approved leave overlapping the Monday to Sunday week of `today`, earliest first. */
export function getOutThisWeek(requests: LeaveRequest[], today: Date) {
  const weekStart = startOfWeek(today);
  const weekEnd = endOfWeek(today);
  return requests
    .filter(
      (r) => drawsOnBalance(r) && r.status === "approved" && parseISO(r.from) <= weekEnd && parseISO(r.to) >= weekStart,
    )
    .sort((a, b) => a.from.localeCompare(b.from));
}

/** A "Comp-off" request earns days instead of taking them, so it is never time off. */
export const drawsOnBalance = (r: LeaveRequest) => r.type !== "Comp-off";

const isHoliday = (day: Date, holidays: Holiday[]) =>
  holidays.some((h) => h.month === day.getMonth() + 1 && h.day === day.getDate());

/** One working day of a request. `weight` is 1, or 0.5 for a half-day leave request. */
type RequestDay = { month: number; date: string; weight: number };

/**
 * Working days in a request (optionally only those in `year`): Saturdays,
 * Sundays and national holidays are skipped.
 */
function requestDays(r: LeaveRequest, holidays: Holiday[], year?: number): RequestDay[] {
  const weight = r.halfDay && drawsOnBalance(r) ? 0.5 : 1;
  return eachDayOfInterval({ start: parseISO(r.from), end: parseISO(r.to) })
    .filter((d) => (year === undefined || d.getFullYear() === year) && !isWeekend(d) && !isHoliday(d, holidays))
    .map((d) => ({ month: d.getMonth(), date: toISODate(d), weight }));
}

/** Days a leave request takes from the balance in `year`. Comp-off requests take none. */
export function balanceDays(r: LeaveRequest, holidays: Holiday[], year: number): RequestDay[] {
  return drawsOnBalance(r) ? requestDays(r, holidays, year) : [];
}

/** One comp-off claim, with the date it stops being usable. */
export type CompOffLot = {
  id: string;
  employeeId: string;
  workedOn: string; // ISO date
  /** 1, 0.5 for a half day, or 0 if the day worked wasn't a holiday or weekend */
  days: number;
  /** ISO date. Usable on days before this one. */
  expiresOn: string;
  status: LeaveRequest["status"];
};

/** Days earned for working `workedOn`: 1 (0.5 for a half day) on a weekend or national holiday, else 0. */
export function compOffDaysFor(workedOn: string, halfDay: boolean | undefined, holidays: Holiday[]): number {
  const day = parseISO(workedOn);
  if (!isWeekend(day) && !isHoliday(day, holidays)) return 0;
  return halfDay ? 0.5 : 1;
}

/** Comp-off expires on the first joining anniversary after the day it was earned. */
export function compOffExpiry(joiningDate: string, workedOn: string): string {
  const worked = parseISO(workedOn);
  const thisYear = anniversaryIn(joiningDate, worked.getFullYear());
  return toISODate(thisYear > worked ? thisYear : anniversaryIn(joiningDate, worked.getFullYear() + 1));
}

/** Every comp-off claim, whatever its status. Only `approved` ones count toward a balance. */
export function getCompOffLots(requests: LeaveRequest[], employees: Employee[], holidays: Holiday[]): CompOffLot[] {
  return requests.flatMap((r) => {
    const employee = employees.find((e) => e.id === r.employeeId);
    if (r.type !== "Comp-off" || !employee) return [];
    return [
      {
        id: r.id,
        employeeId: r.employeeId,
        workedOn: r.from,
        days: compOffDaysFor(r.from, r.halfDay, holidays),
        expiresOn: compOffExpiry(employee.joiningDate, r.from),
        status: r.status,
      },
    ];
  });
}

export type CompOffSummary = {
  /** Comp-off added to the total: unexpired lots in full, expired lots only for what was used before they expired */
  granted: number;
  /** Still usable and not yet taken, part of the remaining balance */
  available: number;
  /** Earned, then expired before it was used */
  expired: number;
};

/** Leave taken on one date: 1 for a full day, 0.5 for a half day. */
export type LeaveDay = { date: string; days: number };

/**
 * Spends `taken` (oldest first) on approved comp-off,
 * soonest-expiring lot first. A lot can only cover days from the day it was
 * earned up to the day before it expires. Whatever a lot can't cover falls to
 * the regular 24, which the caller gets as used minus comp-off used.
 */
export function summariseCompOff(lots: CompOffLot[], taken: LeaveDay[], todayISO: string): CompOffSummary {
  const left = new Map(lots.filter((l) => l.status === "approved").map((l) => [l.id, l.days]));
  const byExpiry = lots
    .filter((l) => l.status === "approved")
    .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn) || a.workedOn.localeCompare(b.workedOn));

  for (const { date, days } of [...taken].sort((a, b) => a.date.localeCompare(b.date))) {
    let need = days;
    for (const lot of byExpiry) {
      if (need === 0) break;
      if (lot.workedOn > date || lot.expiresOn <= date) continue;
      const take = Math.min(need, left.get(lot.id)!);
      left.set(lot.id, left.get(lot.id)! - take);
      need -= take;
    }
  }

  let granted = 0;
  let available = 0;
  let expired = 0;
  for (const lot of byExpiry) {
    const unused = left.get(lot.id)!;
    if (lot.expiresOn <= todayISO) {
      granted += lot.days - unused;
      expired += unused;
    } else {
      granted += lot.days;
      available += unused;
    }
  }
  return { granted, available, expired };
}

const sum = (nums: number[]) => nums.reduce((a, b) => a + b, 0);

export type LeaveKind = "casual" | "sick";

/** Leave days of one kind, in one month, for one employee. The shared base for the chart and the table. */
export type LeaveEntry = {
  employeeId: string;
  kind: LeaveKind;
  month: number; // 0 = Jan
  status: "approved" | "pending";
  days: number;
};

/**
 * Every leave day that counts against the quota in `year`: days already taken
 * in past months, plus approved and pending requests (minus weekends and
 * national holidays). Both the chart and the balance table aggregate this one list, so
 * their totals match by construction.
 */
export function getLeaveEntries(
  requests: LeaveRequest[],
  past: Record<string, PastLeave>,
  holidays: Holiday[],
  year: number,
): LeaveEntry[] {
  const entries: LeaveEntry[] = [];

  for (const [employeeId, taken] of year === PAST_LEAVE_YEAR ? Object.entries(past) : []) {
    for (const kind of ["casual", "sick"] as const) {
      taken[kind].forEach((days, month) => {
        if (days > 0) entries.push({ employeeId, kind, month, status: "approved", days });
      });
    }
  }

  for (const r of requests) {
    if (r.status === "rejected" || r.status === "cancelled") continue;
    const byMonth = new Map<number, number>();
    for (const { month, weight } of balanceDays(r, holidays, year))
      byMonth.set(month, (byMonth.get(month) ?? 0) + weight);
    for (const [month, days] of byMonth) {
      entries.push({
        employeeId: r.employeeId,
        kind: r.type === "Sick leave" ? "sick" : "casual",
        month,
        status: r.status,
        days,
      });
    }
  }
  return entries;
}

export type LeaveBalance = {
  employee: Employee;
  /** 24 plus the comp-off added (unexpired, or used before it expired) */
  total: number;
  casual: number;
  sick: number;
  /** casual + sick, comp-off days included */
  used: number;
  /** days left in the one balance, comp-off included */
  remaining: number;
  /** the part of `remaining` that is comp-off, spent before the regular days */
  compOffAvailable: number;
  /** comp-off that expired unused */
  compOffExpired: number;
};

type Counted = ("approved" | "pending")[];

/**
 * One balance per employee: the yearly allowance plus approved comp-off, less
 * leave taken. `counted` says which request statuses use up days: just
 * approved for the dashboard, approved and pending when checking a new request.
 */
export function getLeaveBalances(
  employees: Employee[],
  entries: LeaveEntry[],
  requests: LeaveRequest[],
  holidays: Holiday[],
  year: number,
  today: Date,
  counted: Counted = ["approved"],
): LeaveBalance[] {
  const lots = getCompOffLots(requests, employees, holidays);
  return employees.map((employee) => {
    const mine = entries.filter((e) => e.employeeId === employee.id && counted.includes(e.status));
    const casual = sum(mine.filter((e) => e.kind === "casual").map((e) => e.days));
    const sick = sum(mine.filter((e) => e.kind === "sick").map((e) => e.days));
    const used = casual + sick;

    const taken: LeaveDay[] = requests
      .filter((r) => r.employeeId === employee.id && drawsOnBalance(r) && (counted as string[]).includes(r.status))
      .flatMap((r) => balanceDays(r, holidays, year).map((d) => ({ date: d.date, days: d.weight })));
    const compOff = summariseCompOff(
      lots.filter((l) => l.employeeId === employee.id),
      taken,
      toISODate(today),
    );
    const total = employee.leaveAllowance + compOff.granted;
    return {
      employee,
      total,
      casual,
      sick,
      used,
      remaining: total - used,
      compOffAvailable: compOff.available,
      compOffExpired: compOff.expired,
    };
  });
}

export type LeaveCheck = { ok: true } | { ok: false; shortfall: number; message: string };

/**
 * Whether `candidate` can be requested. It is blocked if, with it added to
 * the approved and pending leave already on the books, the balance would go
 * below zero in any year it touches. Comp-off claims add days, so never block.
 */
export function checkLeaveRequest(
  candidate: LeaveRequest,
  ctx: {
    employees: Employee[];
    requests: LeaveRequest[];
    past: Record<string, PastLeave>;
    holidays: Holiday[];
    today: Date;
  },
): LeaveCheck {
  const employee = ctx.employees.find((e) => e.id === candidate.employeeId);
  if (!employee) return { ok: false, shortfall: 0, message: "Unknown employee." };
  if (!drawsOnBalance(candidate)) return { ok: true };

  const requests = [...ctx.requests, { ...candidate, status: "pending" as const }];
  for (let year = parseISO(candidate.from).getFullYear(); year <= parseISO(candidate.to).getFullYear(); year++) {
    const entries = getLeaveEntries(requests, ctx.past, ctx.holidays, year);
    const [balance] = getLeaveBalances([employee], entries, requests, ctx.holidays, year, ctx.today, [
      "approved",
      "pending",
    ]);
    if (balance.remaining < 0) {
      const shortfall = -balance.remaining;
      return {
        ok: false,
        shortfall,
        // Employees are never told their allowance, so the message doesn't say by how much.
        message: `You don't have enough leave left for these dates. Ask your admin if you need more.`,
      };
    }
  }
  return { ok: true };
}

/**
 * Days of leave an employee has asked for in `year`: approved, and pending. Cancelled and rejected leave
 * doesn't count. This is what an employee sees instead of their allowance.
 */
export function appliedLeaveDays(requests: LeaveRequest[], holidays: Holiday[], year: number) {
  let approved = 0;
  let pending = 0;
  for (const r of requests) {
    if (!drawsOnBalance(r) || (r.status !== "approved" && r.status !== "pending")) continue;
    const days = sum(balanceDays(r, holidays, year).map((d) => d.weight));
    if (r.status === "approved") approved += days;
    else pending += days;
  }
  return { approved, pending, total: approved + pending };
}

export function getMonthlyLeave(entries: LeaveEntry[]): MonthlyLeave[] {
  const rows = MONTHS.map((month) => ({ month, approved: 0, pending: 0 }));
  for (const e of entries) rows[e.month][e.status] += e.days;
  return rows;
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}
