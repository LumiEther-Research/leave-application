package app.lumiether.db;

import app.lumiether.auth.Token.Role;
import app.lumiether.domain.Types.*;
import java.util.List;
import java.util.Optional;

/**
 * All data access, in Postgres (schema: db/migrations, unchanged). Every method runs plain SQL through {@link Db},
 * copied from the Node app's store.ts, so nothing is kept in memory between requests.
 */
public final class Store {
  private final Db db;

  public Store(Db db) {
    this.db = db;
  }

  public Db db() {
    return db;
  }

  // ---------------------------------------------------------------- employees

  // An employee's leave days come from their category's row in leave_categories.
  private static final String EMPLOYEE_SELECT =
      "select e.id, e.name, e.email, e.category, c.days_per_year as \"leaveAllowance\", "
          + "e.joining_date::text as \"joiningDate\" from employees e join leave_categories c on c.category = e.category";

  private static Employee toEmployee(Row r) {
    return new Employee(r.str("id"), r.str("name"), r.str("email"), r.str("category"), r.integer("leaveAllowance"), r.str("joiningDate"));
  }

  public List<Employee> getEmployees() {
    return db.query(EMPLOYEE_SELECT + " order by e.created_at, e.name").stream().map(Store::toEmployee).toList();
  }

  public Optional<StoredEmployee> findEmployeeByEmail(String email) {
    return db.query(
            "select s.*, e2.password_hash as \"passwordHash\" from (" + EMPLOYEE_SELECT + ") s join employees e2 on e2.id = s.id "
                + "where lower(s.email) = lower($1)",
            email.strip())
        .stream()
        .findFirst()
        .map(r -> new StoredEmployee(toEmployee(r), r.str("passwordHash")));
  }

  public Optional<StoredEmployee> findEmployeeById(String id) {
    if (!Db.isUuid(id)) return Optional.empty();
    return db.query(
            "select s.*, e2.password_hash as \"passwordHash\" from (" + EMPLOYEE_SELECT + ") s join employees e2 on e2.id = s.id "
                + "where s.id = $1",
            id)
        .stream()
        .findFirst()
        .map(r -> new StoredEmployee(toEmployee(r), r.str("passwordHash")));
  }

  /** Callers validate first and pass an already-hashed password. */
  public record NewEmployee(
      String name, String email, String joiningDate, String passwordHash, String category, String monthlySalary, String designation) {
    public static NewEmployee of(String name, String email, String joiningDate, String passwordHash) {
      return new NewEmployee(name, email, joiningDate, passwordHash, null, null, null);
    }
  }

  public Employee createEmployee(NewEmployee input) {
    Row row = db.query(
            "insert into employees (name, email, password_hash, joining_date, category, monthly_salary, designation) "
                + "values ($1, $2, $3, $4, $5, $6, $7) returning id",
            input.name(), input.email().toLowerCase(java.util.Locale.ROOT), input.passwordHash(), input.joiningDate(),
            input.category() == null ? "employee" : input.category(), input.monthlySalary(), input.designation())
        .get(0);
    return getEmployees().stream().filter(e -> e.id().equals(row.str("id"))).findFirst().orElseThrow();
  }

  public boolean setEmployeePasswordHash(String id, String hash) {
    if (!Db.isUuid(id)) return false;
    return !db.query("update employees set password_hash = $2 where id = $1 returning id", id, hash).isEmpty();
  }

  // ------------------------------------------------------------------- admins

  private static StoredAdmin toStoredAdmin(Row r) {
    return new StoredAdmin(r.str("id"), r.str("name"), r.str("email"), r.str("passwordHash"));
  }

  public Optional<StoredAdmin> findAdminByEmail(String email) {
    return db.query("select id, name, email, password_hash as \"passwordHash\" from admins where lower(email) = lower($1)", email.strip())
        .stream().findFirst().map(Store::toStoredAdmin);
  }

  public Optional<StoredAdmin> findAdminById(String id) {
    if (!Db.isUuid(id)) return Optional.empty();
    return db.query("select id, name, email, password_hash as \"passwordHash\" from admins where id = $1", id)
        .stream().findFirst().map(Store::toStoredAdmin);
  }

  public List<Admin> listAdmins() {
    return db.query("select id, name, email from admins order by created_at, name").stream()
        .map(r -> new Admin(r.str("id"), r.str("name"), r.str("email"))).toList();
  }

  public int countAdmins() {
    return db.query("select count(*)::int as n from admins").get(0).integer("n");
  }

  /** Callers validate first and pass an already-hashed password. */
  public Admin createAdmin(String name, String email, String passwordHash) {
    Row r = db.query("insert into admins (name, email, password_hash) values ($1, $2, $3) returning id, name, email",
        name, email.toLowerCase(java.util.Locale.ROOT), passwordHash).get(0);
    return new Admin(r.str("id"), r.str("name"), r.str("email"));
  }

  public boolean setAdminPasswordHash(String id, String hash) {
    if (!Db.isUuid(id)) return false;
    return !db.query("update admins set password_hash = $2 where id = $1 returning id", id, hash).isEmpty();
  }

  public record Result(boolean ok, String error) {
    public static final Result OK = new Result(true, null);

    public static Result fail(String error) {
      return new Result(false, error);
    }
  }

  /**
   * Deletes an admin. Two rules are enforced here, and the second also in the database itself (the keep_one_admin
   * trigger), so two admins removing each other at once can't empty the table: nobody can remove themselves, and
   * the last admin can't be removed.
   */
  public Result deleteAdmin(String actorId, String targetId) {
    if (actorId.equals(targetId)) return Result.fail("You can't remove your own admin account.");
    if (!Db.isUuid(targetId)) return Result.fail("That admin no longer exists.");
    try {
      List<Row> rows = db.query("delete from admins where id = $1 and id <> $2 returning id", targetId, actorId);
      return rows.isEmpty() ? Result.fail("That admin no longer exists.") : Result.OK;
    } catch (DbException e) {
      if (e.getMessage() != null && e.getMessage().contains("last_admin")) return Result.fail("There has to be at least one admin.");
      throw e;
    }
  }

  /** Is this email already an admin's or an employee's? Compared without regard to case. */
  public boolean isEmailTaken(String email) {
    return !db.query(
            "select 1 from admins where lower(email) = lower($1) "
                + "union all select 1 from employees where lower(email) = lower($1) limit 1",
            email.strip())
        .isEmpty();
  }

  // ----------------------------------------------------------------- holidays

  public List<Holiday> getHolidays() {
    return db.query("select name, month, day from holidays order by month, day").stream()
        .map(r -> new Holiday(r.str("name"), r.integer("month"), r.integer("day"))).toList();
  }

  /** The signed-in user for a token's subject and role, or empty if that account is gone. */
  public Optional<SessionUser> sessionUser(String id, Role role) {
    if (role == Role.admin) return findAdminById(id).map(a -> new SessionUser(a.id(), a.name(), a.email(), Role.admin));
    return findEmployeeById(id).map(e -> new SessionUser(e.employee().id(), e.employee().name(), e.employee().email(), Role.employee));
  }
}
