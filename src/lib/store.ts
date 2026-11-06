// All data access, in Neon Postgres (schema: db/migrations). Call these from server
// components and server actions only. Every function is async and runs plain SQL
// through ./db, so nothing is kept in memory between requests.
import { getToday, toISODate } from "./dates";
import { isUniqueViolation, isUuid, query } from "./db";
import { checkLeaveRequest } from "./leave";
import {
  planCancellation,
  validateCompOffInput,
  validateLeaveInput,
  validatePermissionInput,
  type CompOffErrors,
  type CompOffInput,
  type LeaveErrors,
  type LeaveInput,
  type PermissionErrors,
  type PermissionInput,
} from "./requests";
import {
  CATEGORIES,
  previousSnapshot,
  type Category,
  type Employee,
  type LeaveCategory,
  type Permission,
  type Holiday,
  type LeaveRequest,
  type PastLeave,
} from "./types";

/** An employee with their sign-in hash. Only the auth code should ask for this. */
export type StoredEmployee = Employee & { passwordHash: string };
export type Admin = { id: string; name: string; email: string };
export type StoredAdmin = Admin & { passwordHash: string };

// ---------------------------------------------------------------- employees

// An employee's leave days come from their category's row in leave_categories.
const EMPLOYEE_SELECT = `select e.id, e.name, e.email, e.category, c.days_per_year as "leaveAllowance",
  e.joining_date::text as "joiningDate" from employees e join leave_categories c on c.category = e.category`;

type EmployeeRow = Omit<Employee, "role">;
const toEmployee = (row: EmployeeRow): Employee => ({ ...row, role: "employee" });

export async function getEmployees(): Promise<Employee[]> {
  const rows = await query<EmployeeRow>(`${EMPLOYEE_SELECT} order by e.created_at, e.name`);
  return rows.map(toEmployee);
}

export async function findEmployeeByEmail(email: string): Promise<StoredEmployee | undefined> {
  const [row] = await query<EmployeeRow & { passwordHash: string }>(
    `select s.*, e2.password_hash as "passwordHash" from (${EMPLOYEE_SELECT}) s join employees e2 on e2.id = s.id
     where lower(s.email) = lower($1)`,
    [email.trim()],
  );
  return row && { ...toEmployee(row), passwordHash: row.passwordHash };
}

export async function findEmployeeById(id: string): Promise<StoredEmployee | undefined> {
  if (!isUuid(id)) return undefined;
  const [row] = await query<EmployeeRow & { passwordHash: string }>(
    `select s.*, e2.password_hash as "passwordHash" from (${EMPLOYEE_SELECT}) s join employees e2 on e2.id = s.id
     where s.id = $1`,
    [id],
  );
  return row && { ...toEmployee(row), passwordHash: row.passwordHash };
}

/** Callers validate first (see validateNewEmployee) and pass an already-hashed password. */
export async function createEmployee(input: {
  name: string;
  email: string;
  joiningDate: string;
  passwordHash: string;
  category?: Category;
  /** plain "16500.00", already validated */
  monthlySalary?: string | null;
  designation?: string | null;
}): Promise<Employee> {
  const [row] = await query<{ id: string }>(
    `insert into employees (name, email, password_hash, joining_date, category, monthly_salary, designation)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [
      input.name,
      input.email.toLowerCase(),
      input.passwordHash,
      input.joiningDate,
      input.category ?? "employee",
      input.monthlySalary ?? null,
      input.designation ?? null,
    ],
  );
  return (await getEmployees()).find((e) => e.id === row.id)!;
}

export async function setEmployeePasswordHash(id: string, hash: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  return (await query(`update employees set password_hash = $2 where id = $1 returning id`, [id, hash])).length > 0;
}

/** Moves an employee to another category, which changes how many leave days they get. */
export async function setEmployeeCategory(id: string, category: Category): Promise<boolean> {
  if (!isUuid(id) || !(CATEGORIES as readonly string[]).includes(category)) return false;
  return (await query(`update employees set category = $2 where id = $1 returning id`, [id, category])).length > 0;
}

/**
 * Admin only (the caller checks). Permanently removes the employee and, with them, their leave, comp-off,
 * permissions and payslips. Their session stops working on its next request. False if they don't exist.
 */
export async function deleteEmployee(id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  return (await query(`delete from employees where id = $1 returning id`, [id])).length > 0;
}

/** Admin only (the caller checks and validates). Saves the salary and designation shown on payslips. */
export async function setEmployeePayroll(
  id: string,
  payroll: { monthlySalary: string | null; designation: string | null },
): Promise<boolean> {
  if (!isUuid(id)) return false;
  return (
    (
      await query(`update employees set monthly_salary = $2, designation = $3 where id = $1 returning id`, [
        id,
        payroll.monthlySalary,
        payroll.designation,
      ])
    ).length > 0
  );
}

// -------------------------------------------------------- leave categories

/** The yearly leave days of each category, in the fixed order contractor, employee, intern, student. */
export async function getLeaveCategories(): Promise<LeaveCategory[]> {
  const rows = await query<{ category: Category; daysPerYear: number }>(
    `select category, days_per_year as "daysPerYear" from leave_categories`,
  );
  return CATEGORIES.map((c) => rows.find((r) => r.category === c)!).filter(Boolean);
}

/** Admin only (the caller checks). Changes apply to everyone in the category straight away. */
export async function setLeaveCategoryDays(category: Category, daysPerYear: number): Promise<boolean> {
  if (!(CATEGORIES as readonly string[]).includes(category) || !Number.isInteger(daysPerYear)) return false;
  if (daysPerYear < 0 || daysPerYear > 366) return false;
  return (
    (
      await query(`update leave_categories set days_per_year = $2 where category = $1 returning category`, [
        category,
        daysPerYear,
      ])
    ).length > 0
  );
}

// ------------------------------------------------------------------- admins

export async function findAdminByEmail(email: string): Promise<StoredAdmin | undefined> {
  const [row] = await query<StoredAdmin>(
    `select id, name, email, password_hash as "passwordHash" from admins where lower(email) = lower($1)`,
    [email.trim()],
  );
  return row;
}

export async function findAdminById(id: string): Promise<StoredAdmin | undefined> {
  if (!isUuid(id)) return undefined;
  const [row] = await query<StoredAdmin>(
    `select id, name, email, password_hash as "passwordHash" from admins where id = $1`,
    [id],
  );
  return row;
}

export async function listAdmins(): Promise<Admin[]> {
  return query<Admin>(`select id, name, email from admins order by created_at, name`);
}

export async function countAdmins(): Promise<number> {
  const [row] = await query<{ n: number }>(`select count(*)::int as n from admins`);
  return row.n;
}

/** Callers validate first (see validateNewAdmin) and pass an already-hashed password. */
export async function createAdmin(input: { name: string; email: string; passwordHash: string }): Promise<Admin> {
  const [row] = await query<Admin>(
    `insert into admins (name, email, password_hash) values ($1, $2, $3) returning id, name, email`,
    [input.name, input.email.toLowerCase(), input.passwordHash],
  );
  return row;
}

export async function setAdminPasswordHash(id: string, hash: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  return (await query(`update admins set password_hash = $2 where id = $1 returning id`, [id, hash])).length > 0;
}

export type DeleteAdminResult = { ok: true } | { ok: false; error: string };

/**
 * Deletes an admin. Two rules are enforced here, and the second also in the database itself
 * (the keep_one_admin trigger), so two admins removing each other at once can't empty the table:
 * nobody can remove themselves, and the last admin can't be removed.
 */
export async function deleteAdmin(actorId: string, targetId: string): Promise<DeleteAdminResult> {
  if (actorId === targetId) return { ok: false, error: "You can't remove your own admin account." };
  if (!isUuid(targetId)) return { ok: false, error: "That admin no longer exists." };
  try {
    const rows = await query(`delete from admins where id = $1 and id <> $2 returning id`, [targetId, actorId]);
    return rows.length ? { ok: true } : { ok: false, error: "That admin no longer exists." };
  } catch (error) {
    if (error instanceof Error && error.message.includes("last_admin")) {
      return { ok: false, error: "There has to be at least one admin." };
    }
    throw error;
  }
}

/** Is this email already an admin's or an employee's? Compared without regard to case. */
export async function isEmailTaken(email: string): Promise<boolean> {
  const rows = await query(
    `select 1 from admins where lower(email) = lower($1)
     union all select 1 from employees where lower(email) = lower($1) limit 1`,
    [email.trim()],
  );
  return rows.length > 0;
}

// ----------------------------------------------------------------- holidays

export async function getHolidays(): Promise<Holiday[]> {
  return query<Holiday>(`select name, month, day from holidays order by month, day`);
}

// ----------------------------------------------------------------- requests

// Leave and comp-off claims live in separate tables, but the rest of the app works with one
// list of requests, where a claim is a "Comp-off" request on the day worked.
const LEAVE_COLUMNS = `id, employee_id as "employeeId", type, status, from_date::text as "from", to_date::text as "to",
  applied_on::text as "appliedOn", half_day as "halfDay", cancel_requested as "cancelRequested",
  cancel_requested_on::text as "cancelRequestedOn", created_at::text as "createdAt"`;
const CLAIM_COLUMNS = `id, employee_id as "employeeId", worked_on::text as "workedOn", half_day as "halfDay", status,
  applied_on::text as "appliedOn", created_at::text as "createdAt"`;

type LeaveRow = Omit<LeaveRequest, "halfDay" | "cancelRequested" | "cancelRequestedOn"> & {
  halfDay: boolean;
  cancelRequested: boolean;
  cancelRequestedOn: string | null;
  createdAt: string;
};
type ClaimRow = {
  id: string;
  employeeId: string;
  workedOn: string;
  halfDay: boolean;
  status: LeaveRequest["status"];
  appliedOn: string;
  createdAt: string;
};

function fromLeaveRow(r: LeaveRow): { createdAt: string; request: LeaveRequest } {
  return {
    createdAt: r.createdAt,
    request: {
      id: r.id,
      employeeId: r.employeeId,
      type: r.type,
      status: r.status,
      from: r.from,
      to: r.to,
      appliedOn: r.appliedOn,
      ...(r.halfDay ? { halfDay: true } : {}),
      ...(r.cancelRequested ? { cancelRequested: true, cancelRequestedOn: r.cancelRequestedOn ?? undefined } : {}),
    },
  };
}

function fromClaimRow(r: ClaimRow): { createdAt: string; request: LeaveRequest } {
  return {
    createdAt: r.createdAt,
    request: {
      id: r.id,
      employeeId: r.employeeId,
      type: "Comp-off",
      status: r.status,
      from: r.workedOn,
      to: r.workedOn,
      appliedOn: r.appliedOn,
      ...(r.halfDay ? { halfDay: true } : {}),
    },
  };
}

/** Everyone's leave requests and comp-off claims, oldest first. Pass an employee id for just theirs. */
export async function getRequests(employeeId?: string): Promise<LeaveRequest[]> {
  if (employeeId !== undefined && !isUuid(employeeId)) return [];
  const where = employeeId === undefined ? "" : "where employee_id = $1";
  const params = employeeId === undefined ? [] : [employeeId];
  const [leave, claims] = await Promise.all([
    query<LeaveRow>(`select ${LEAVE_COLUMNS} from leave_requests ${where}`, params),
    query<ClaimRow>(`select ${CLAIM_COLUMNS} from comp_off_claims ${where}`, params),
  ]);
  return [...leave.map(fromLeaveRow), ...claims.map(fromClaimRow)]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((row) => row.request);
}

const pastLeaveDays: Record<string, PastLeave> = {};

export async function getDashboardData() {
  const [requests, employees, holidays] = await Promise.all([getRequests(), getEmployees(), getHolidays()]);
  return { requests, employees, holidays, pastLeaveDays, previous: previousSnapshot };
}

/**
 * An admin's decision on something waiting for them. For a pending request, approve or reject
 * it. For a cancellation request on approved leave, approving cancels the leave (its days
 * return) and rejecting keeps the leave as it was. False if nothing was waiting on that id.
 */
export async function resolveRequest(id: string, decision: "approved" | "rejected"): Promise<boolean> {
  if (!isUuid(id)) return false;
  const leave = await query(
    `update leave_requests set
       status = case when cancel_requested then (case when $2::text = 'approved' then 'cancelled' else 'approved' end)
                else $2::text end,
       cancel_requested = false, cancel_requested_on = null
     where id = $1 and (status = 'pending' or (status = 'approved' and cancel_requested)) returning id`,
    [id, decision],
  );
  if (leave.length) return true;
  const claim = await query(
    `update comp_off_claims set status = $2::text where id = $1 and status = 'pending' returning id`,
    [id, decision],
  );
  return claim.length > 0;
}

export type CancelResult = { ok: true; action: "withdraw" | "request" } | { ok: false; error: string };

/** An employee cancelling their own leave. See planCancellation for the rules. */
export async function cancelLeaveRequest(employeeId: string, id: string, today = getToday()): Promise<CancelResult> {
  const notFound: CancelResult = { ok: false, error: "We couldn't find that request." };
  if (!isUuid(employeeId) || !isUuid(id)) return notFound;

  const mine = await getRequests(employeeId);
  const request = mine.find((r) => r.id === id);
  if (!request) return notFound;

  const plan = planCancellation(request, today);
  if (!plan.ok) return plan;

  const updated =
    plan.action === "withdraw"
      ? await query(
          `update leave_requests set status = 'cancelled' where id = $1 and employee_id = $2 and status = 'pending' returning id`,
          [id, employeeId],
        )
      : await query(
          `update leave_requests set cancel_requested = true, cancel_requested_on = $3
           where id = $1 and employee_id = $2 and status = 'approved' and not cancel_requested returning id`,
          [id, employeeId, toISODate(today)],
        );
  // Someone else changed it between the read and the write.
  return updated.length ? plan : { ok: false, error: "That request just changed. Refresh and try again." };
}

export type SubmitResult<E> = { ok: true; id: string } | { ok: false; errors: E };

/**
 * Adds a pending leave request for an employee, unless the dates are invalid,
 * overlap their other leave, or would take the balance below zero.
 */
export async function addLeaveRequest(employeeId: string, input: LeaveInput): Promise<SubmitResult<LeaveErrors>> {
  const today = getToday();
  const employee = (await getEmployees()).find((e) => e.id === employeeId);
  if (!employee) return { ok: false, errors: { form: "Your account no longer exists." } };
  const [holidays, mine] = await Promise.all([getHolidays(), getRequests(employeeId)]);

  const valid = validateLeaveInput(input, { today, holidays, mine });
  if (!valid.ok) return valid;

  const { halfDay, ...dates } = valid.value;
  const candidate: LeaveRequest = {
    ...dates,
    id: "new",
    employeeId,
    status: "pending",
    appliedOn: toISODate(today),
    ...(halfDay ? { halfDay: true } : {}),
  };
  const check = checkLeaveRequest(candidate, {
    employees: [employee],
    requests: mine,
    past: pastLeaveDays,
    holidays,
    today,
  });
  if (!check.ok) return { ok: false, errors: { form: check.message } };

  const [row] = await query<{ id: string }>(
    `insert into leave_requests (employee_id, type, status, from_date, to_date, half_day, applied_on)
     values ($1, $2, 'pending', $3, $4, $5, $6) returning id`,
    [employeeId, dates.type, dates.from, dates.to, !!halfDay, toISODate(today)],
  );
  return { ok: true, id: row.id };
}

/** Adds a pending comp-off claim. It only counts toward the balance once an admin approves it. */
export async function addCompOffClaim(employeeId: string, input: CompOffInput): Promise<SubmitResult<CompOffErrors>> {
  const today = getToday();
  const employee = (await getEmployees()).find((e) => e.id === employeeId);
  if (!employee) return { ok: false, errors: { form: "Your account no longer exists." } };
  const [holidays, mine] = await Promise.all([getHolidays(), getRequests(employeeId)]);

  const valid = validateCompOffInput(input, { today, holidays, mine, employee });
  if (!valid.ok) return valid;

  try {
    const [row] = await query<{ id: string }>(
      `insert into comp_off_claims (employee_id, worked_on, half_day, status, applied_on)
       values ($1, $2, $3, 'pending', $4) returning id`,
      [employeeId, valid.value.workedOn, valid.value.halfDay, toISODate(today)],
    );
    return { ok: true, id: row.id };
  } catch (error) {
    // Two submissions for the same day at once: the unique index lets only one through.
    if (isUniqueViolation(error)) {
      return { ok: false, errors: { workedOn: "You've already claimed comp-off for that day." } };
    }
    throw error;
  }
}

// -------------------------------------------------------------- permissions

const PERMISSION_COLUMNS = `p.id, p.employee_id as "employeeId", p.permission_date::text as date,
  to_char(p.start_time, 'HH24:MI') as "from", to_char(p.end_time, 'HH24:MI') as "to",
  (extract(epoch from (p.end_time - p.start_time)) / 60)::int as minutes, p.reason`;

export type PermissionWithName = Permission & { employeeName: string };

/** Permissions, newest day first. Pass an employee id for just theirs. */
export async function getPermissions(employeeId?: string): Promise<PermissionWithName[]> {
  if (employeeId !== undefined && !isUuid(employeeId)) return [];
  const where = employeeId === undefined ? "" : "where p.employee_id = $1";
  return query<PermissionWithName>(
    `select ${PERMISSION_COLUMNS}, e.name as "employeeName" from permissions p join employees e on e.id = p.employee_id
     ${where} order by p.permission_date desc, p.start_time desc`,
    employeeId === undefined ? [] : [employeeId],
  );
}

/** Notes a permission for an employee. Nothing is deducted from their leave. */
export async function addPermission(
  employeeId: string,
  input: PermissionInput,
): Promise<SubmitResult<PermissionErrors>> {
  const today = getToday();
  const employee = (await getEmployees()).find((e) => e.id === employeeId);
  if (!employee) return { ok: false, errors: { form: "Your account no longer exists." } };
  const [holidays, leave, permissions] = await Promise.all([
    getHolidays(),
    getRequests(employeeId),
    getPermissions(employeeId),
  ]);

  const valid = validatePermissionInput(input, { today, holidays, leave, permissions });
  if (!valid.ok) return valid;

  const { date, from, to, reason } = valid.value;
  const [row] = await query<{ id: string }>(
    `insert into permissions (employee_id, permission_date, start_time, end_time, reason) values ($1, $2, $3, $4, $5) returning id`,
    [employeeId, date, from, to, reason],
  );
  return { ok: true, id: row.id };
}
