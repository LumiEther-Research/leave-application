// Payslip data access. Server only (talks to Postgres).
import { isUniqueViolation, isUuid, query } from "../db";
import { amountInWords, parseAmount, toPlain } from "./money";

export type PayslipEmployee = {
  id: string;
  name: string;
  employeeCode: string;
  designation: string | null;
  /** paise, or null if no salary is set */
  monthlySalary: number | null;
};

export type PayslipSummary = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  /** "2026-08-01" */
  periodMonth: string;
  basic: number;
  deduction: number;
  net: number;
  generatedAt: Date;
  /** false for a draft the monthly job made: only the admin sees it until it is published */
  published: boolean;
};

type SummaryRow = Omit<PayslipSummary, "basic" | "deduction" | "net"> & { basic: string; deduction: string; net: string };
const toSummary = (r: SummaryRow): PayslipSummary => ({
  ...r,
  basic: parseAmount(r.basic)!,
  deduction: parseAmount(r.deduction)!,
  net: parseAmount(r.net)!,
});

// The pdf column is left out on purpose: lists must not drag every PDF out of the database.
const SUMMARY_SELECT = `select p.id, p.employee_id as "employeeId", e.name as "employeeName", e.employee_code as "employeeCode",
  p.period_month::text as "periodMonth", p.basic::text as basic, p.deduction::text as deduction, p.net::text as net,
  p.generated_at as "generatedAt", p.published
  from payslips p join employees e on e.id = p.employee_id`;

export async function getPayslipEmployees(): Promise<PayslipEmployee[]> {
  const rows = await query<Omit<PayslipEmployee, "monthlySalary"> & { monthlySalary: string | null }>(
    `select id, name, employee_code as "employeeCode", designation, monthly_salary::text as "monthlySalary"
     from employees order by employee_code`,
  );
  return rows.map((r) => ({ ...r, monthlySalary: r.monthlySalary === null ? null : parseAmount(r.monthlySalary) }));
}

export async function findPayslipEmployee(id: string): Promise<PayslipEmployee | undefined> {
  if (!isUuid(id)) return undefined;
  return (await getPayslipEmployees()).find((e) => e.id === id);
}

export async function listPayslipsForMonth(periodMonth: string): Promise<PayslipSummary[]> {
  const rows = await query<SummaryRow>(`${SUMMARY_SELECT} where p.period_month = $1 order by e.employee_code`, [periodMonth]);
  return rows.map(toSummary);
}

export async function listPayslipsForEmployee(employeeId: string): Promise<PayslipSummary[]> {
  if (!isUuid(employeeId)) return [];
  const rows = await query<SummaryRow>(`${SUMMARY_SELECT} where p.employee_id = $1 and p.published order by p.period_month desc`, [employeeId]);
  return rows.map(toSummary);
}

/** Whether that employee has a payslip for the month, and if so whether it is still a draft. */
export async function payslipState(employeeId: string, periodMonth: string): Promise<"none" | "draft" | "published"> {
  const [row] = await query<{ published: boolean }>(`select published from payslips where employee_id = $1 and period_month = $2`, [
    employeeId,
    periodMonth,
  ]);
  return !row ? "none" : row.published ? "published" : "draft";
}

/** Admin only (the caller checks). Makes a draft visible to the employee. False if there is no such draft. */
export async function publishPayslip(id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  return (await query(`update payslips set published = true where id = $1 and not published returning id`, [id])).length > 0;
}

/** Employees with a salary who had joined by the end of the month and have no payslip for it yet. */
export async function listEmployeesNeedingPayslip(periodMonth: string): Promise<PayslipEmployee[]> {
  const rows = await query<Omit<PayslipEmployee, "monthlySalary"> & { monthlySalary: string }>(
    `select e.id, e.name, e.employee_code as "employeeCode", e.designation, e.monthly_salary::text as "monthlySalary"
     from employees e
     where e.monthly_salary is not null and e.monthly_salary > 0
       and e.joining_date < ($1::date + interval '1 month')
       and not exists (select 1 from payslips p where p.employee_id = e.id and p.period_month = $1)
     order by e.employee_code`,
    [periodMonth],
  );
  return rows.map((r) => ({ ...r, monthlySalary: parseAmount(r.monthlySalary)! }));
}

export type SaveInput = { employeeId: string; periodMonth: string; basic: number; deduction: number; net: number; pdf: Buffer };

/**
 * Stores a payslip. With `replace` an existing row for that employee and month is overwritten, otherwise an
 * existing row is left alone and "exists" comes back, so nothing is replaced without the admin's go-ahead.
 */
export async function savePayslip(input: SaveInput, replace: boolean, published = true): Promise<"saved" | "replaced" | "exists"> {
  const params = [
    input.employeeId,
    input.periodMonth,
    toPlain(input.basic),
    toPlain(input.deduction),
    toPlain(input.net),
    amountInWords(input.net),
    input.pdf,
    published,
  ];
  const insert = `insert into payslips (employee_id, period_month, basic, deduction, net, amount_in_words, pdf, published)
    values ($1, $2, $3, $4, $5, $6, $7, $8)`;
  if (!replace) {
    try {
      await query(insert, params);
      return "saved";
    } catch (error) {
      if (isUniqueViolation(error)) return "exists";
      throw error;
    }
  }
  // xmax is 0 for a row that was just inserted, so it tells an insert from an overwrite.
  const [row] = await query<{ replaced: boolean }>(
    `${insert} on conflict (employee_id, period_month) do update set basic = excluded.basic, deduction = excluded.deduction,
       net = excluded.net, amount_in_words = excluded.amount_in_words, pdf = excluded.pdf, published = excluded.published, generated_at = now()
     returning (xmax <> 0) as replaced`,
    params,
  );
  return row.replaced ? "replaced" : "saved";
}

export type PayslipFile = { pdf: Buffer; filename: string };

/** The PDF of a payslip if this person may have it: the admin any, an employee only their own. Otherwise null. */
export async function getPayslipFileFor(user: { id: string; role: "admin" | "employee" }, payslipId: string): Promise<PayslipFile | null> {
  if (!isUuid(payslipId)) return null;
  const [row] = await query<{ pdf: Buffer; employeeId: string; employeeCode: string; periodMonth: string; published: boolean }>(
    `select p.pdf, p.published, p.employee_id as "employeeId", e.employee_code as "employeeCode", to_char(p.period_month, 'YYYY-MM') as "periodMonth"
     from payslips p join employees e on e.id = p.employee_id where p.id = $1`,
    [payslipId],
  );
  if (!row) return null;
  // An employee gets only their own, and only once it is published. A draft is the admin's alone.
  if (user.role !== "admin" && (row.employeeId !== user.id || !row.published)) return null;
  return { pdf: row.pdf, filename: `Payslip_${row.employeeCode}_${row.periodMonth}.pdf` };
}
