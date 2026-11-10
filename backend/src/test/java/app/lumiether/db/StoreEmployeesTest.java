package app.lumiether.db;

import static org.junit.jupiter.api.Assertions.*;

import app.lumiether.auth.Password;
import app.lumiether.domain.Types.Employee;
import java.util.List;
import org.junit.jupiter.api.*;

/**
 * The Employees screen's data rules, against the real schema: what is saved on create, the HR-EMP code, the
 * category and the days it gives, payroll details (blank clears), and what removing an employee takes with them.
 * Ports the category and employee-removal cases of store.test.ts; the leave-blocking cases come with the leave code.
 */
class StoreEmployeesTest {
  Db db;
  Store store;

  @BeforeEach
  void setUp() {
    db = TestDb.reset();
    store = new Store(db);
  }

  Employee employee(String name) {
    return store.createEmployee(Store.NewEmployee.of(name, name.toLowerCase() + "@gmail.com", "2026-01-05", Password.hash("temp-pass-1")));
  }

  Employee in(String name, String category) {
    return store.createEmployee(new Store.NewEmployee(name, name.toLowerCase() + "@gmail.com", "2026-01-05", "x", category, null, null));
  }

  @Test
  void aNewEmployeeDefaultsToTheEmployeeCategoryWith24DaysAYear() {
    Employee e = employee("Plain");
    assertEquals("employee", e.category());
    assertEquals(24, e.leaveAllowance());
  }

  @Test
  void aNewEmployeeGetsTheChosenCategoryAndThatCategorysDays() {
    db.query("update leave_categories set days_per_year = 10 where category = 'intern'");
    Employee intern = in("Intern", "intern");
    assertEquals(List.of("intern", 10), List.of(intern.category(), intern.leaveAllowance()));
  }

  /** The code's number. The sequence is shared across test runs (it is never reset), so only differences are compared. */
  private int codeOf(Employee e) {
    String code = db.query("select employee_code from employees where id = $1", e.id()).get(0).str("employee_code");
    assertTrue(code.matches("HR-EMP-\\d{5}"), code);
    return Integer.parseInt(code.substring(7));
  }

  @Test
  void employeeCodesLookLikeHrEmp00001CountUpByOneAndAreNeverReused() {
    Employee a = employee("A");
    Employee b = employee("B");
    assertEquals(codeOf(a) + 1, codeOf(b));
    store.deleteEmployee(b.id());
    Employee c = employee("C");
    assertEquals(codeOf(a) + 2, codeOf(c)); // B's number is not handed out again
  }

  @Test
  void theListShowsPayrollDetailsInTheOrderTheyWereAddedAndNeverTheHash() {
    Employee first = employee("First");
    store.createEmployee(new Store.NewEmployee("Second", "second@gmail.com", "2026-02-02", "x", "student", "16500.50", "Software Engineer"));
    List<Store.EmployeeRecord> list = store.listEmployeesWithPayroll();
    assertEquals(List.of("First", "Second"), list.stream().map(Store.EmployeeRecord::name).toList());
    assertNull(list.get(0).monthlySalary());
    assertNull(list.get(0).designation());
    assertEquals(first.id(), list.get(0).id());
    assertEquals(List.of("student", "2026-02-02", "16500.50", "Software Engineer"),
        List.of(list.get(1).category(), list.get(1).joiningDate(), list.get(1).monthlySalary(), list.get(1).designation()));
    assertFalse(list.toString().contains("password"));
  }

  @Test
  void movingAnEmployeeToAnotherCategoryChangesTheirDaysAndAMadeUpCategoryOrIdChangesNothing() {
    db.query("update leave_categories set days_per_year = 6 where category = 'student'");
    Employee e = employee("Mover");
    assertTrue(store.setEmployeeCategory(e.id(), "student"));
    Employee moved = store.getEmployees().get(0);
    assertEquals(List.of("student", 6), List.of(moved.category(), moved.leaveAllowance()));
    assertFalse(store.setEmployeeCategory(e.id(), "manager"));
    assertFalse(store.setEmployeeCategory("not-a-uuid", "intern"));
    assertFalse(store.setEmployeeCategory("00000000-0000-4000-8000-000000000001", "intern"));
    assertEquals("student", store.getEmployees().get(0).category());
  }

  @Test
  void payrollDetailsAreSavedAndNullClearsThem() {
    Employee e = employee("Pay");
    assertTrue(store.setEmployeePayroll(e.id(), "16500.00", "Designer"));
    Store.EmployeeRecord saved = store.listEmployeesWithPayroll().get(0);
    assertEquals(List.of("16500.00", "Designer"), List.of(saved.monthlySalary(), saved.designation()));
    assertTrue(store.setEmployeePayroll(e.id(), null, null));
    Store.EmployeeRecord cleared = store.listEmployeesWithPayroll().get(0);
    assertNull(cleared.monthlySalary());
    assertNull(cleared.designation());
    assertFalse(store.setEmployeePayroll("not-a-uuid", "1.00", "x"));
    assertFalse(store.setEmployeePayroll("00000000-0000-4000-8000-000000000001", "1.00", "x"));
  }

  @Test
  void aNegativeSalaryIsRefusedByTheDatabaseItself() {
    Employee e = employee("Pay");
    assertThrows(DbException.class, () -> store.setEmployeePayroll(e.id(), "-1.00", null));
  }

  @Test
  void removingAnEmployeeDeletesTheirLeaveCompOffAndPermissionsAndNobodyElses() {
    Employee gone = employee("Gone");
    Employee kept = employee("Kept");
    for (Employee e : List.of(gone, kept)) {
      db.query("insert into leave_requests (employee_id, type, status, from_date, to_date, applied_on) values ($1, 'Casual leave', 'pending', '2026-03-02', '2026-03-02', '2026-03-01')", e.id());
      db.query("insert into comp_off_claims (employee_id, worked_on, status, applied_on) values ($1, '2026-03-01', 'pending', '2026-03-02')", e.id());
      db.query("insert into permissions (employee_id, permission_date, start_time, end_time) values ($1, '2026-03-03', '10:00', '11:00')", e.id());
    }
    assertTrue(store.deleteEmployee(gone.id()));
    for (String table : List.of("leave_requests", "comp_off_claims", "permissions")) {
      assertEquals(List.of(kept.id()), db.query("select employee_id from " + table).stream().map(r -> r.str("employee_id")).toList(), table);
    }
    assertTrue(store.findEmployeeById(gone.id()).isEmpty());
    assertFalse(store.deleteEmployee(gone.id())); // already gone
    assertFalse(store.deleteEmployee("not-a-uuid"));
  }
}
