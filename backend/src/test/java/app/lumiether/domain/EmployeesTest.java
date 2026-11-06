package app.lumiether.domain;

import static org.junit.jupiter.api.Assertions.*;

import app.lumiether.auth.ChangePassword;
import app.lumiether.domain.Employees.*;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import org.junit.jupiter.api.Test;

/** Port of "creating an employee", "validating a new admin" and "validating a password change" (auth.test.ts). */
class EmployeesTest {
  private static final List<String> NONE = List.of();

  private static NewEmployeeInput ok() {
    return NewEmployeeInput.of("Priya.Sharma@Gmail.com", "2026-03-02", "temp-pass-1", "intern");
  }

  private static NewEmployeeInput with(NewEmployeeInput i, String email, String joining, String password, String category) {
    return new NewEmployeeInput(email == null ? i.email() : email, joining == null ? i.joiningDate() : joining,
        password == null ? i.password() : password, category == null ? i.category() : category, "", "");
  }

  @Test
  void acceptsAGmailAddressARealDateAndALongEnoughPasswordAndLowercasesTheEmail() {
    var r = Employees.validateNewEmployee(ok(), NONE);
    assertTrue(r.ok());
    assertEquals("priya.sharma@gmail.com", r.value().email());
  }

  @Test
  void rejectsNonGmailAddresses() {
    for (String email : new String[] {"a@yahoo.com", "a@googlemail.com", "a@gmail.co", "@gmail.com", "a b@gmail.com", "gmail.com", ""}) {
      var r = Employees.validateNewEmployee(with(ok(), email, null, null, null), NONE);
      assertTrue(r.errors().containsKey("email"), email);
    }
  }

  @Test
  void rejectsAnEmailThatIsAlreadyTakenIgnoringCase() {
    var r = Employees.validateNewEmployee(ok(), List.of("priya.sharma@gmail.com"));
    assertEquals("Someone already uses this email.", r.errors().get("email"));
  }

  @Test
  void rejectsAMissingImpossibleOrAncientJoiningDate() {
    for (String d : new String[] {"", "2026-02-30", "2026-13-01", "02/03/2026", "1999-12-31"}) {
      assertTrue(Employees.validateNewEmployee(with(ok(), null, d, null, null), NONE).errors().containsKey("joiningDate"), d);
    }
    assertTrue(Employees.validateNewEmployee(with(ok(), null, "2028-02-29", null, null), NONE).ok()); // leap day
  }

  @Test
  void theCategoryHasToBeOneOfTheFourAndIsPassedThrough() {
    for (String c : new String[] {"contractor", "employee", "intern", "student"}) {
      assertEquals(c, Employees.validateNewEmployee(with(ok(), null, null, null, c), NONE).value().category());
    }
    for (String c : new String[] {"", "manager", "Employee", "INTERN"}) {
      assertEquals("Choose a category.", Employees.validateNewEmployee(with(ok(), null, null, null, c), NONE).errors().get("category"), c);
    }
  }

  @Test
  void rejectsAShortPassword() {
    assertTrue(Employees.validateNewEmployee(with(ok(), null, null, "short", null), NONE).errors().containsKey("password"));
  }

  @Test
  void reportsEveryProblemAtOnce() {
    var r = Employees.validateNewEmployee(NewEmployeeInput.of("x", "", "", ""), NONE);
    assertEquals(new TreeSet<>(List.of("category", "email", "joiningDate", "password")), new TreeSet<>(r.errors().keySet()));
  }

  @Test
  void theDisplayNameComesFromTheEmail() {
    assertEquals("Priya Sharma", Employees.nameFromEmail("priya.sharma@gmail.com"));
    assertEquals("Rahul Verma", Employees.nameFromEmail("rahul_verma99@gmail.com"));
    assertEquals("Ananya", Employees.nameFromEmail("ananya@gmail.com"));
    assertEquals("12345@x.com", Employees.nameFromEmail("12345@x.com")); // no words left: the email itself
  }

  @Test
  void passwordLengthLimits() {
    assertTrue(Employees.validateNewEmployee(with(ok(), null, null, "x".repeat(129), null), NONE).errors().containsKey("password"));
    assertTrue(Employees.validateNewEmployee(with(ok(), null, null, "x".repeat(128), null), NONE).ok());
  }

  // ---------------------------------------------------------------- new admin

  @Test
  void anyWellFormedEmailWorksForAnAdminLowercasedAndThePasswordNeedsEightCharacters() {
    var ok = Employees.validateNewAdmin(new NewAdminInput("Second.Admin@Company.co.in", "temp-pass-1"), NONE);
    assertEquals("second.admin@company.co.in", ok.value().email());
    for (String email : new String[] {"", "nope", "a@b", "a b@c.com", "@c.com"}) {
      assertTrue(Employees.validateNewAdmin(new NewAdminInput(email, "temp-pass-1"), NONE).errors().containsKey("email"), email);
    }
    assertFalse(Employees.validateNewAdmin(new NewAdminInput("a@b.com", "short"), NONE).ok());
  }

  @Test
  void anAdminEmailAlreadyInUseIsRefusedIgnoringCase() {
    var r = Employees.validateNewAdmin(new NewAdminInput("TAKEN@x.com", "temp-pass-1"), List.of("taken@x.com"));
    assertEquals("Someone already uses this email.", r.errors().get("email"));
  }

  // -------------------------------------------------------- password change

  @Test
  void theNewPasswordNeedsTheRightLengthMustDifferAndMustBeTypedTwice() {
    var ok = new ChangePassword.Input("old-password", "new-password", "new-password");
    assertEquals(Map.of(), ChangePassword.validate(ok));
    assertTrue(ChangePassword.validate(new ChangePassword.Input("", "new-password", "new-password")).containsKey("current"));
    assertTrue(ChangePassword.validate(new ChangePassword.Input("old-password", "short", "short")).containsKey("next"));
    String long129 = "x".repeat(129);
    assertTrue(ChangePassword.validate(new ChangePassword.Input("old-password", long129, long129)).containsKey("next"));
    assertTrue(ChangePassword.validate(new ChangePassword.Input("old-password", "old-password", "old-password")).containsKey("next"));
    assertTrue(ChangePassword.validate(new ChangePassword.Input("old-password", "new-password", "different-one")).containsKey("confirm"));
  }

  // ------------------------------------------------------------------ payroll

  @Test
  void aSalaryIsAPositiveAmountWithAtMostTwoDecimalsBothFieldsOptional() {
    var r = Employees.validatePayroll(new PayrollInput("16,500.5", "  Engineer "));
    assertEquals("16500.50", r.value().monthlySalary());
    assertEquals("Engineer", r.value().designation());
    for (String bad : new String[] {"0", "-5", "abc", "1.234", "99999999999"}) {
      assertTrue(Employees.validatePayroll(new PayrollInput(bad, "")).errors().containsKey("monthlySalary"), bad);
    }
    var none = Employees.validatePayroll(new PayrollInput("", ""));
    assertNull(none.value().monthlySalary());
    assertNull(none.value().designation());
    assertTrue(Employees.validatePayroll(new PayrollInput("", "x".repeat(101))).errors().containsKey("designation"));
  }
}
