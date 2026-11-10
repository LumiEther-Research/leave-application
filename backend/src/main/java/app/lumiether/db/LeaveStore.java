package app.lumiether.db;

import app.lumiether.domain.Dates;
import app.lumiether.domain.Leave;
import app.lumiether.domain.Leave.Request;
import app.lumiether.domain.Requests;
import app.lumiether.domain.Requests.CompOffInput;
import app.lumiether.domain.Requests.LeaveInput;
import app.lumiether.domain.Requests.Permission;
import app.lumiether.domain.Requests.PermissionInput;
import app.lumiether.domain.Types;
import app.lumiether.domain.Types.Employee;
import app.lumiether.domain.Types.Holiday;
import app.lumiether.domain.Types.LeaveCategory;
import app.lumiether.domain.Validated;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

/** Leave requests, comp-off claims, permissions and the category days, in Postgres (port of the second half of store.ts). */
public final class LeaveStore {
  private final Db db;
  private final Store store;

  public LeaveStore(Store store) {
    this.store = store;
    this.db = store.db();
  }

  // Leave and comp-off claims live in separate tables, but the rest of the app works with one list of requests,
  // where a claim is a "Comp-off" request on the day worked.
  private static final String LEAVE_COLUMNS = "id, employee_id as \"employeeId\", type, status, from_date::text as \"from\", to_date::text as \"to\", "
      + "applied_on::text as \"appliedOn\", half_day as \"halfDay\", cancel_requested as \"cancelRequested\", "
      + "cancel_requested_on::text as \"cancelRequestedOn\", created_at::text as \"createdAt\"";
  private static final String CLAIM_COLUMNS = "id, employee_id as \"employeeId\", worked_on::text as \"workedOn\", half_day as \"halfDay\", status, "
      + "applied_on::text as \"appliedOn\", created_at::text as \"createdAt\"";

  private record Dated(String createdAt, Request request) {}

  /** Everyone's leave requests and comp-off claims, oldest first. Pass an employee id for just theirs. */
  public List<Request> getRequests(String employeeId) {
    if (employeeId != null && !Db.isUuid(employeeId)) return List.of();
    String where = employeeId == null ? "" : "where employee_id = $1";
    Object[] params = employeeId == null ? new Object[0] : new Object[] {employeeId};
    List<Dated> all = new ArrayList<>();
    for (Row r : db.query("select " + LEAVE_COLUMNS + " from leave_requests " + where, params)) {
      all.add(new Dated(r.str("createdAt"), new Request(r.str("id"), r.str("employeeId"), r.str("type"), r.str("status"), r.str("from"),
          r.str("to"), r.str("appliedOn"), r.bool("halfDay"), r.bool("cancelRequested"), r.str("cancelRequestedOn"))));
    }
    for (Row r : db.query("select " + CLAIM_COLUMNS + " from comp_off_claims " + where, params)) {
      all.add(new Dated(r.str("createdAt"), new Request(r.str("id"), r.str("employeeId"), "Comp-off", r.str("status"), r.str("workedOn"),
          r.str("workedOn"), r.str("appliedOn"), r.bool("halfDay"), false, null)));
    }
    all.sort(Comparator.comparing(Dated::createdAt));
    return all.stream().map(Dated::request).toList();
  }

  /** The result of adding something: its id, or a message per bad field ("form" for a problem with the request as a whole). */
  public record Submit(boolean ok, String id, Map<String, String> errors) {
    static Submit ok(String id) {
      return new Submit(true, id, Map.of());
    }

    static Submit failed(Map<String, String> errors) {
      return new Submit(false, null, errors);
    }
  }

  private Employee employee(String id) {
    return store.getEmployees().stream().filter(e -> e.id().equals(id)).findFirst().orElse(null);
  }

  /** Adds a pending leave request, unless the dates are invalid, overlap their other leave, or would take the balance below zero. */
  public Submit addLeaveRequest(String employeeId, LeaveInput input, LocalDate today) {
    Employee employee = employee(employeeId);
    if (employee == null) return Submit.failed(Map.of("form", "Your account no longer exists."));
    List<Holiday> holidays = store.getHolidays();
    List<Request> mine = getRequests(employeeId);

    Validated<Requests.LeaveValue> valid = Requests.validateLeaveInput(input, today, holidays, mine);
    if (!valid.ok()) return Submit.failed(valid.errors());

    Requests.LeaveValue v = valid.value();
    Request candidate = new Request("new", employeeId, v.type(), "pending", v.from(), v.to(), today.toString()).withHalfDay(v.halfDay());
    Leave.LeaveCheck check = Leave.checkLeaveRequest(candidate, List.of(employee), mine, Map.of(), holidays, today);
    if (!check.ok()) return Submit.failed(Map.of("form", check.message()));

    Row row = db.query(
        "insert into leave_requests (employee_id, type, status, from_date, to_date, half_day, applied_on) "
            + "values ($1, $2, 'pending', $3, $4, $5, $6) returning id",
        employeeId, v.type(), v.from(), v.to(), v.halfDay(), today.toString()).get(0);
    return Submit.ok(row.str("id"));
  }

  /** Adds a pending comp-off claim. It only counts toward the balance once an admin approves it. */
  public Submit addCompOffClaim(String employeeId, CompOffInput input, LocalDate today) {
    Employee employee = employee(employeeId);
    if (employee == null) return Submit.failed(Map.of("form", "Your account no longer exists."));
    List<Request> mine = getRequests(employeeId);

    Validated<Requests.CompOffValue> valid = Requests.validateCompOffInput(input, today, store.getHolidays(), mine, employee);
    if (!valid.ok()) return Submit.failed(valid.errors());

    try {
      Row row = db.query(
          "insert into comp_off_claims (employee_id, worked_on, half_day, status, applied_on) values ($1, $2, $3, 'pending', $4) returning id",
          employeeId, valid.value().workedOn(), valid.value().halfDay(), today.toString()).get(0);
      return Submit.ok(row.str("id"));
    } catch (RuntimeException e) {
      // Two submissions for the same day at once: the unique index lets only one through.
      if (Db.isUniqueViolation(e)) return Submit.failed(Map.of("workedOn", "You've already claimed comp-off for that day."));
      throw e;
    }
  }

  public record CancelResult(boolean ok, String action, String error) {}

  /** An employee cancelling their own leave. See {@link Requests#planCancellation} for the rules. */
  public CancelResult cancelLeaveRequest(String employeeId, String id, LocalDate today) {
    CancelResult notFound = new CancelResult(false, null, "We couldn't find that request.");
    if (!Db.isUuid(employeeId) || !Db.isUuid(id)) return notFound;
    Request request = getRequests(employeeId).stream().filter(r -> r.id().equals(id)).findFirst().orElse(null);
    if (request == null) return notFound;

    Requests.CancelPlan plan = Requests.planCancellation(request, today);
    if (!plan.ok()) return new CancelResult(false, null, plan.error());

    List<Row> updated = plan.action().equals("withdraw")
        ? db.query("update leave_requests set status = 'cancelled' where id = $1 and employee_id = $2 and status = 'pending' returning id", id, employeeId)
        : db.query("update leave_requests set cancel_requested = true, cancel_requested_on = $3 "
            + "where id = $1 and employee_id = $2 and status = 'approved' and not cancel_requested returning id", id, employeeId, today.toString());
    // Someone else changed it between the read and the write.
    return updated.isEmpty() ? new CancelResult(false, null, "That request just changed. Refresh and try again.") : new CancelResult(true, plan.action(), null);
  }

  /**
   * An admin's decision on something waiting for them. For a pending request, approve or reject it. For a cancellation
   * request on approved leave, approving cancels the leave (its days return) and rejecting keeps the leave as it was.
   * False if nothing was waiting on that id.
   */
  public boolean resolveRequest(String id, String decision) {
    if (!Db.isUuid(id) || !(decision.equals("approved") || decision.equals("rejected"))) return false;
    List<Row> leave = db.query(
        "update leave_requests set "
            + "status = case when cancel_requested then (case when $2::text = 'approved' then 'cancelled' else 'approved' end) else $2::text end, "
            + "cancel_requested = false, cancel_requested_on = null "
            + "where id = $1 and (status = 'pending' or (status = 'approved' and cancel_requested)) returning id",
        id, decision);
    if (!leave.isEmpty()) return true;
    return !db.query("update comp_off_claims set status = $2::text where id = $1 and status = 'pending' returning id", id, decision).isEmpty();
  }

  // -------------------------------------------------------------- permissions

  private static final String PERMISSION_COLUMNS = "p.id, p.employee_id as \"employeeId\", p.permission_date::text as date, "
      + "to_char(p.start_time, 'HH24:MI') as \"from\", to_char(p.end_time, 'HH24:MI') as \"to\", "
      + "(extract(epoch from (p.end_time - p.start_time)) / 60)::int as minutes, p.reason";

  public record PermissionWithName(Permission permission, String employeeName) {}

  /** Permissions, newest day first. Pass an employee id for just theirs. */
  public List<PermissionWithName> getPermissions(String employeeId) {
    if (employeeId != null && !Db.isUuid(employeeId)) return List.of();
    String where = employeeId == null ? "" : "where p.employee_id = $1";
    return db.query("select " + PERMISSION_COLUMNS + ", e.name as \"employeeName\" from permissions p join employees e on e.id = p.employee_id "
            + where + " order by p.permission_date desc, p.start_time desc", employeeId == null ? new Object[0] : new Object[] {employeeId})
        .stream()
        .map(r -> new PermissionWithName(new Permission(r.str("id"), r.str("employeeId"), r.str("date"), r.str("from"), r.str("to"),
            r.integer("minutes"), r.str("reason")), r.str("employeeName")))
        .toList();
  }

  /** Notes a permission for an employee. Nothing is deducted from their leave. */
  public Submit addPermission(String employeeId, PermissionInput input, LocalDate today) {
    if (employee(employeeId) == null) return Submit.failed(Map.of("form", "Your account no longer exists."));
    Validated<Requests.PermissionValue> valid = Requests.validatePermissionInput(input, today, store.getHolidays(), getRequests(employeeId),
        getPermissions(employeeId).stream().map(PermissionWithName::permission).toList());
    if (!valid.ok()) return Submit.failed(valid.errors());
    Requests.PermissionValue v = valid.value();
    Row row = db.query("insert into permissions (employee_id, permission_date, start_time, end_time, reason) values ($1, $2, $3, $4, $5) returning id",
        employeeId, v.date(), v.from(), v.to(), v.reason()).get(0);
    return Submit.ok(row.str("id"));
  }

  // -------------------------------------------------------- leave categories

  /** The yearly leave days of each category, in the fixed order contractor, employee, intern, student. */
  public List<LeaveCategory> getLeaveCategories() {
    List<Row> rows = db.query("select category, days_per_year as \"daysPerYear\" from leave_categories");
    List<LeaveCategory> out = new ArrayList<>();
    for (String c : Types.CATEGORIES) {
      rows.stream().filter(r -> r.str("category").equals(c)).findFirst().ifPresent(r -> out.add(new LeaveCategory(c, r.integer("daysPerYear"))));
    }
    return out;
  }

  /** Admin only (the caller checks). Changes apply to everyone in the category straight away. */
  public boolean setLeaveCategoryDays(String category, int daysPerYear) {
    if (!Types.CATEGORIES.contains(category) || daysPerYear < 0 || daysPerYear > 366) return false;
    return !db.query("update leave_categories set days_per_year = $2 where category = $1 returning category", category, daysPerYear).isEmpty();
  }
}
