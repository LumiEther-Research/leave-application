package app.lumiether.payslip;

import app.lumiether.db.Db;
import app.lumiether.db.Row;
import app.lumiether.domain.Money;
import java.util.List;

/** Payslip data access, in Postgres (port of payslip/store.ts). Amounts are paise. */
public final class PayslipStore {
  private final Db db;

  public PayslipStore(Db db) {
    this.db = db;
  }

  /** {@code monthlySalary} in paise, or null if none is set. */
  public record PayslipEmployee(String id, String name, String employeeCode, String designation, Long monthlySalary) {}

  /** {@code generatedOn} is the IST calendar day, "2026-11-04". {@code published} is false for a draft only the admin sees. */
  public record PayslipSummary(String id, String employeeId, String employeeName, String employeeCode, String periodMonth,
      long basic, long deduction, long net, String generatedOn, boolean published) {}

  private static PayslipEmployee toEmployee(Row r) {
    return new PayslipEmployee(r.str("id"), r.str("name"), r.str("employeeCode"), r.str("designation"),
        r.str("monthlySalary") == null ? null : Money.parseAmount(r.str("monthlySalary")));
  }

  public List<PayslipEmployee> getPayslipEmployees() {
    return db.query("select id, name, employee_code as \"employeeCode\", designation, monthly_salary::text as \"monthlySalary\" from employees order by employee_code")
        .stream().map(PayslipStore::toEmployee).toList();
  }

  public PayslipEmployee findPayslipEmployee(String id) {
    if (!Db.isUuid(id)) return null;
    return getPayslipEmployees().stream().filter(e -> e.id().equals(id)).findFirst().orElse(null);
  }

  // The pdf column is left out on purpose: lists must not drag every PDF out of the database.
  private static final String SUMMARY_SELECT = "select p.id, p.employee_id as \"employeeId\", e.name as \"employeeName\", e.employee_code as \"employeeCode\", "
      + "p.period_month::text as \"periodMonth\", p.basic::text as basic, p.deduction::text as deduction, p.net::text as net, "
      + "to_char(p.generated_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as \"generatedOn\", p.published "
      + "from payslips p join employees e on e.id = p.employee_id";

  private static PayslipSummary toSummary(Row r) {
    return new PayslipSummary(r.str("id"), r.str("employeeId"), r.str("employeeName"), r.str("employeeCode"), r.str("periodMonth"),
        Money.parseAmount(r.str("basic")), Money.parseAmount(r.str("deduction")), Money.parseAmount(r.str("net")), r.str("generatedOn"), r.bool("published"));
  }

  public List<PayslipSummary> listPayslipsForMonth(String periodMonth) {
    return db.query(SUMMARY_SELECT + " where p.period_month = $1 order by e.employee_code", periodMonth).stream().map(PayslipStore::toSummary).toList();
  }

  /** An employee sees only their own published payslips, newest first. */
  public List<PayslipSummary> listPayslipsForEmployee(String employeeId) {
    if (!Db.isUuid(employeeId)) return List.of();
    return db.query(SUMMARY_SELECT + " where p.employee_id = $1 and p.published order by p.period_month desc", employeeId).stream().map(PayslipStore::toSummary).toList();
  }

  /** "none", "draft" or "published": whether that employee has a payslip for the month, and whether it is still a draft. */
  public String payslipState(String employeeId, String periodMonth) {
    List<Row> rows = db.query("select published from payslips where employee_id = $1 and period_month = $2", employeeId, periodMonth);
    return rows.isEmpty() ? "none" : rows.get(0).bool("published") ? "published" : "draft";
  }

  /** Admin only (the caller checks). Makes a draft visible to the employee. False if there is no such draft. */
  public boolean publishPayslip(String id) {
    if (!Db.isUuid(id)) return false;
    return !db.query("update payslips set published = true where id = $1 and not published returning id", id).isEmpty();
  }

  /** Employees with a salary who had joined by the end of the month and have no payslip for it yet. */
  public List<PayslipEmployee> listEmployeesNeedingPayslip(String periodMonth) {
    return db.query("select e.id, e.name, e.employee_code as \"employeeCode\", e.designation, e.monthly_salary::text as \"monthlySalary\" from employees e "
            + "where e.monthly_salary is not null and e.monthly_salary > 0 and e.joining_date < ($1::date + interval '1 month') "
            + "and not exists (select 1 from payslips p where p.employee_id = e.id and p.period_month = $1) order by e.employee_code", periodMonth)
        .stream().map(PayslipStore::toEmployee).toList();
  }

  public record SaveInput(String employeeId, String periodMonth, long basic, long deduction, long net, byte[] pdf) {}

  /**
   * Stores a payslip. With {@code replace} an existing row for that employee and month is overwritten, otherwise an
   * existing row is left alone and "exists" comes back, so nothing is replaced without the admin's go-ahead.
   * Returns "saved", "replaced" or "exists".
   */
  public String savePayslip(SaveInput in, boolean replace, boolean published) {
    Object[] params = {in.employeeId(), in.periodMonth(), Money.toPlain(in.basic()), Money.toPlain(in.deduction()), Money.toPlain(in.net()),
        Money.amountInWords(in.net()), in.pdf(), published};
    String insert = "insert into payslips (employee_id, period_month, basic, deduction, net, amount_in_words, pdf, published) values ($1, $2, $3, $4, $5, $6, $7, $8)";
    if (!replace) {
      try {
        db.query(insert, params);
        return "saved";
      } catch (RuntimeException e) {
        if (Db.isUniqueViolation(e)) return "exists";
        throw e;
      }
    }
    // xmax is 0 for a row that was just inserted, so it tells an insert from an overwrite.
    Row row = db.query(insert + " on conflict (employee_id, period_month) do update set basic = excluded.basic, deduction = excluded.deduction, "
        + "net = excluded.net, amount_in_words = excluded.amount_in_words, pdf = excluded.pdf, published = excluded.published, generated_at = now() "
        + "returning (xmax <> 0) as replaced", params).get(0);
    return row.bool("replaced") ? "replaced" : "saved";
  }

  public record PayslipFile(byte[] pdf, String filename) {}

  /** The PDF of a payslip if this person may have it: the admin any, an employee only their own published one. Otherwise null. */
  public PayslipFile getPayslipFileFor(String userId, boolean admin, String payslipId) {
    if (!Db.isUuid(payslipId)) return null;
    List<Row> rows = db.query("select p.pdf, p.published, p.employee_id as \"employeeId\", e.employee_code as \"employeeCode\", "
        + "to_char(p.period_month, 'YYYY-MM') as \"periodMonth\" from payslips p join employees e on e.id = p.employee_id where p.id = $1", payslipId);
    if (rows.isEmpty()) return null;
    Row row = rows.get(0);
    // An employee gets only their own, and only once it is published. A draft is the admin's alone.
    if (!admin && (!row.str("employeeId").equals(userId) || !row.bool("published"))) return null;
    return new PayslipFile(row.bytes("pdf"), "Payslip_" + row.str("employeeCode") + "_" + row.str("periodMonth") + ".pdf");
  }
}
