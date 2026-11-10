package app.lumiether.db;

import static org.junit.jupiter.api.Assertions.*;

import app.lumiether.domain.Leave;
import app.lumiether.domain.Leave.Request;
import app.lumiether.domain.Requests.*;
import app.lumiether.domain.Types.Employee;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.*;

/**
 * Port of the "leave requests", "cancelling leave", "comp-off claims", "leave categories" and "permissions" groups of
 * store.test.ts. Dates are fixed in 2026 and "today" is passed in, so the tests don't depend on when they run.
 */
class StoreLeaveTest {
  static final int YEAR = 2026;
  static final LocalDate JUNE = LocalDate.parse("2026-06-01"); // a Monday
  static final LocalDate EARLY = LocalDate.parse("2026-01-02"); // a fixed "today" early in the year, for cancellation tests
  static final String LATE_DECEMBER_WORKING_DAY = "2026-12-29"; // a Tuesday
  static final String FIRST_SATURDAY = "2026-01-03";

  Db db;
  Store store;
  LeaveStore leave;

  @BeforeEach
  void setUp() {
    db = TestDb.reset();
    store = new Store(db);
    leave = new LeaveStore(store);
  }

  Employee employee(String name) {
    return store.createEmployee(Store.NewEmployee.of(name, name.toLowerCase() + "@gmail.com", "2000-01-01", "x"));
  }

  Employee in(String name, String category) {
    return store.createEmployee(new Store.NewEmployee(name, name.toLowerCase() + "@gmail.com", "2000-01-01", "x", category, null, null));
  }

  static LeaveInput full(String from, String to) {
    return new LeaveInput("Casual leave", from, to, "full");
  }

  static LeaveInput full(String from) {
    return full(from, from);
  }

  Leave.LeaveBalance balanceOf(LocalDate today) {
    var requests = leave.getRequests(null);
    var entries = Leave.getLeaveEntries(requests, Map.of(), store.getHolidays(), YEAR);
    return Leave.getLeaveBalances(store.getEmployees(), entries, requests, store.getHolidays(), YEAR, today).get(0);
  }

  Request find(String id) {
    return leave.getRequests(null).stream().filter(r -> r.id().equals(id)).findFirst().orElseThrow();
  }

  // ----------------------------------------------------------- leave requests

  @Test
  void aValidRequestIsSavedAsPendingForThatEmployeeOnly() {
    Employee e = employee("One");
    Employee other = employee("Two");
    assertTrue(leave.addLeaveRequest(e.id(), full("2026-02-02", "2026-02-03"), JUNE).ok());
    var mine = leave.getRequests(e.id());
    assertEquals(List.of(List.of("Casual leave", "pending", "2026-02-02", "2026-02-03")),
        mine.stream().map(x -> List.of(x.type(), x.status(), x.from(), x.to())).toList());
    assertEquals(0, leave.getRequests(other.id()).size());
  }

  @Test
  void aHalfDayIsSavedOnOneDayAndFlagged() {
    Employee e = employee("One");
    leave.addLeaveRequest(e.id(), new LeaveInput("Sick leave", "2026-02-03", "", "half"), JUNE);
    Request saved = leave.getRequests(null).get(0);
    assertEquals(List.of("2026-02-03", "2026-02-03", true), List.of(saved.from(), saved.to(), saved.halfDay()));
  }

  @Test
  void invalidOrOverlappingRequestsAreRefusedAndNotSaved() {
    Employee e = employee("One");
    leave.addLeaveRequest(e.id(), full("2026-02-02", "2026-02-04"), JUNE);
    var overlap = leave.addLeaveRequest(e.id(), full("2026-02-04", "2026-02-05"), JUNE);
    assertEquals("You already have leave that overlaps these dates.", overlap.errors().get("form"));
    assertFalse(leave.addLeaveRequest(e.id(), full("", ""), JUNE).ok());
    assertEquals(1, leave.getRequests(null).size());
  }

  @Test
  void leaveThatWouldTakeTheBalanceBelowZeroIsBlockedAndNotSaved() {
    Employee e = employee("One");
    var r = leave.addLeaveRequest(e.id(), full("2026-01-01", "2026-03-31"), LocalDate.parse("2026-01-01")); // about 60 working days
    assertTrue(r.errors().get("form").contains("enough leave"));
    assertEquals(0, leave.getRequests(null).size());
  }

  @Test
  void approvingLeaveTakesItFromTheBalanceRejectingDoesnt() {
    Employee e = employee("One");
    var a = leave.addLeaveRequest(e.id(), full("2026-02-02", "2026-02-03"), JUNE);
    var b = leave.addLeaveRequest(e.id(), full("2026-03-02"), JUNE);
    assertTrue(a.ok() && b.ok());
    assertTrue(leave.resolveRequest(a.id(), "approved"));
    assertTrue(leave.resolveRequest(b.id(), "rejected"));
    assertFalse(leave.resolveRequest(a.id(), "approved")); // already decided
    var balance = balanceOf(JUNE);
    assertEquals(List.of(2.0, 22.0), List.of(balance.used(), balance.remaining()));
  }

  @Test
  void aDecisionMustBeApprovedOrRejectedAndTheIdARealUuid() {
    Employee e = employee("One");
    var a = leave.addLeaveRequest(e.id(), full("2026-02-02"), JUNE);
    assertFalse(leave.resolveRequest(a.id(), "cancelled"));
    assertFalse(leave.resolveRequest("not-a-uuid", "approved"));
    assertEquals("pending", find(a.id()).status());
  }

  // ---------------------------------------------------------- cancelling leave

  String apply(String employeeId) {
    var r = leave.addLeaveRequest(employeeId, full(LATE_DECEMBER_WORKING_DAY), EARLY);
    assertTrue(r.ok(), String.valueOf(r.errors()));
    return r.id();
  }

  @Test
  void pendingLeaveIsWithdrawnStraightAwayAndBecomesCancelled() {
    Employee e = employee("One");
    String id = apply(e.id());
    assertEquals(new LeaveStore.CancelResult(true, "withdraw", null), leave.cancelLeaveRequest(e.id(), id, EARLY));
    assertEquals("cancelled", find(id).status());
  }

  @Test
  void approvedLeaveOnlyGetsACancellationRequestAndCantBeAskedTwice() {
    Employee e = employee("One");
    String id = apply(e.id());
    leave.resolveRequest(id, "approved");
    assertEquals(new LeaveStore.CancelResult(true, "request", null), leave.cancelLeaveRequest(e.id(), id, EARLY));
    Request waiting = find(id);
    assertEquals(List.of("approved", true), List.of(waiting.status(), waiting.cancelRequested()));
    assertEquals("You've already asked to cancel this leave.", leave.cancelLeaveRequest(e.id(), id, EARLY).error());
  }

  @Test
  void theAdminApprovingTheCancellationCancelsTheLeave() {
    Employee e = employee("One");
    String id = apply(e.id());
    leave.resolveRequest(id, "approved");
    leave.cancelLeaveRequest(e.id(), id, EARLY);
    assertTrue(leave.resolveRequest(id, "approved"));
    Request done = find(id);
    assertEquals(List.of("cancelled", false), List.of(done.status(), done.cancelRequested()));
  }

  @Test
  void theAdminRejectingTheCancellationKeepsTheLeaveAndTheyMayAskAgainLater() {
    Employee e = employee("One");
    String id = apply(e.id());
    leave.resolveRequest(id, "approved");
    leave.cancelLeaveRequest(e.id(), id, EARLY);
    assertTrue(leave.resolveRequest(id, "rejected"));
    Request kept = find(id);
    assertEquals(List.of("approved", false), List.of(kept.status(), kept.cancelRequested()));
    assertTrue(leave.cancelLeaveRequest(e.id(), id, EARLY).ok());
  }

  @Test
  void anEmployeeCantCancelSomeoneElsesLeaveAndAnAdminDecisionOnlyAppliesToThingsWaitingOnThem() {
    Employee owner = employee("Owner");
    Employee other = employee("Other");
    String id = apply(owner.id());
    assertEquals("We couldn't find that request.", leave.cancelLeaveRequest(other.id(), id, EARLY).error());
    assertEquals("pending", find(id).status());
    leave.resolveRequest(id, "approved");
    assertFalse(leave.resolveRequest(id, "approved")); // approved leave with no cancellation request
  }

  @Test
  void startedLeaveCantBeCancelled() {
    Employee e = employee("One");
    String id = apply(e.id());
    leave.resolveRequest(id, "approved");
    assertEquals("This leave has already started, so it can't be cancelled.", leave.cancelLeaveRequest(e.id(), id, LocalDate.parse("2026-12-30")).error());
  }

  // ------------------------------------------------------------ comp-off claims

  @Test
  void aClaimIsSavedPendingInItsOwnTableAndShowsUpAsACompOffRequestOnTheDayWorked() {
    Employee e = employee("One");
    assertTrue(leave.addCompOffClaim(e.id(), new CompOffInput(FIRST_SATURDAY, "half"), JUNE).ok());
    assertEquals(1, db.query("select count(*)::int as n from comp_off_claims").get(0).integer("n"));
    assertEquals(0, db.query("select count(*)::int as n from leave_requests").get(0).integer("n"));
    Request claim = leave.getRequests(null).get(0);
    assertEquals(List.of("Comp-off", "pending", FIRST_SATURDAY, FIRST_SATURDAY, true), List.of(claim.type(), claim.status(), claim.from(), claim.to(), claim.halfDay()));
  }

  @Test
  void theSameDayCantBeClaimedTwiceButCanBeAgainAfterARejection() {
    Employee e = employee("One");
    var first = leave.addCompOffClaim(e.id(), new CompOffInput(FIRST_SATURDAY, "full"), JUNE);
    assertEquals("You've already claimed comp-off for that day.", leave.addCompOffClaim(e.id(), new CompOffInput(FIRST_SATURDAY, "full"), JUNE).errors().get("workedOn"));
    leave.resolveRequest(first.id(), "rejected");
    assertTrue(leave.addCompOffClaim(e.id(), new CompOffInput(FIRST_SATURDAY, "full"), JUNE).ok());
  }

  @Test
  void theDatabaseItselfRefusesTwoLiveClaimsForOneDay() {
    Employee e = employee("One");
    leave.addCompOffClaim(e.id(), new CompOffInput(FIRST_SATURDAY, "full"), JUNE);
    var dup = assertThrows(DbException.class, () -> db.query(
        "insert into comp_off_claims (employee_id, worked_on, status, applied_on) values ($1, $2, 'pending', '2026-06-01')", e.id(), FIRST_SATURDAY));
    assertTrue(Db.isUniqueViolation(dup));
  }

  @Test
  void aClaimForAWorkingDayIsRefused() {
    Employee e = employee("One");
    assertFalse(leave.addCompOffClaim(e.id(), new CompOffInput("2026-01-05", "full"), JUNE).ok()); // a Monday
  }

  @Test
  void aPendingClaimAddsNothingToTheBalanceApprovingItAddsADayAndLeaveUsesItFirst() {
    Employee e = employee("One");
    var claim = leave.addCompOffClaim(e.id(), new CompOffInput(FIRST_SATURDAY, "full"), JUNE);
    assertEquals(24, balanceOf(JUNE).total());
    leave.resolveRequest(claim.id(), "approved");
    assertEquals(List.of(25.0, 1.0), List.of(balanceOf(JUNE).total(), balanceOf(JUNE).compOffAvailable()));
  }

  @Test
  void compOffExpiresOnTheJoiningAnniversaryItDropsOutOfTheBalanceAfterwards() {
    Employee e = employee("One"); // joined 2000-01-01, so the claim of 3 Jan 2026 expires 1 Jan 2027
    var claim = leave.addCompOffClaim(e.id(), new CompOffInput(FIRST_SATURDAY, "full"), JUNE);
    leave.resolveRequest(claim.id(), "approved");
    assertEquals(25, balanceOf(LocalDate.parse("2026-12-31")).total());
    assertEquals(24, balanceOf(LocalDate.parse("2027-01-01")).total());
  }

  @Test
  void deletingAnEmployeeRemovesTheirRequestsAndClaims() {
    Employee e = employee("One");
    leave.addLeaveRequest(e.id(), full("2026-02-02"), JUNE);
    leave.addCompOffClaim(e.id(), new CompOffInput(FIRST_SATURDAY, "full"), JUNE);
    db.query("delete from employees where id = $1", e.id());
    assertEquals(List.of(), leave.getRequests(null));
  }

  // --------------------------------------------------------- leave categories

  @Test
  void theFourCategoriesExistInOrderEachStartingAt24Days() {
    assertEquals(List.of("contractor 24", "employee 24", "intern 24", "student 24"),
        leave.getLeaveCategories().stream().map(c -> c.category() + " " + c.daysPerYear()).toList());
  }

  @Test
  void aNewEmployeeDefaultsToTheEmployeeCategoryOrGetsTheOneChosenWithThatCategorysDays() {
    Employee plain = employee("Plain");
    assertEquals(List.of("employee", 24), List.of(plain.category(), plain.leaveAllowance()));
    leave.setLeaveCategoryDays("intern", 10);
    Employee intern = in("Intern", "intern");
    assertEquals(List.of("intern", 10), List.of(intern.category(), intern.leaveAllowance()));
  }

  @Test
  void changingACategorysDaysChangesEveryoneInItStraightAwayAndNobodyElse() {
    in("A", "student");
    in("B", "contractor");
    assertTrue(leave.setLeaveCategoryDays("student", 6));
    var byName = store.getEmployees().stream().collect(java.util.stream.Collectors.toMap(Employee::name, Employee::leaveAllowance));
    assertEquals(List.of(6, 24), List.of(byName.get("A"), byName.get("B")));
  }

  @Test
  void daysMustBeAWholeNumberFrom0To366AndTheCategoryHasToExist() {
    assertTrue(leave.setLeaveCategoryDays("intern", 0)); // zero is allowed
    assertTrue(leave.setLeaveCategoryDays("intern", 366));
    for (int days : new int[] {-1, 367}) assertFalse(leave.setLeaveCategoryDays("intern", days), String.valueOf(days));
    assertFalse(leave.setLeaveCategoryDays("manager", 5));
    assertEquals(366, leave.getLeaveCategories().stream().filter(c -> c.category().equals("intern")).findFirst().orElseThrow().daysPerYear());
  }

  @Test
  void theCategorysDaysAreWhatLimitLeaveAStudentWith3DaysCanTake3ButNot4() {
    leave.setLeaveCategoryDays("student", 3);
    Employee s = in("Stu", "student");
    var tooMany = leave.addLeaveRequest(s.id(), full("2026-02-02", "2026-02-05"), JUNE); // Mon to Thu, 4 working days
    assertTrue(tooMany.errors().get("form").contains("enough leave"));
    assertFalse(tooMany.errors().get("form").matches(".*\\d.*"), "doesn't say by how much");
    assertTrue(leave.addLeaveRequest(s.id(), full("2026-02-02", "2026-02-04"), JUNE).ok()); // 3 working days
  }

  @Test
  void raisingTheDaysLetsSomeoneWhoWasBlockedApply() {
    leave.setLeaveCategoryDays("intern", 1);
    Employee i = in("Ina", "intern");
    assertFalse(leave.addLeaveRequest(i.id(), full("2026-02-02", "2026-02-03"), JUNE).ok());
    leave.setLeaveCategoryDays("intern", 5);
    assertTrue(leave.addLeaveRequest(i.id(), full("2026-02-02", "2026-02-03"), JUNE).ok());
  }

  // -------------------------------------------------------------- permissions

  static final String WORKING_DAY = "2026-06-01";

  LeaveStore.Submit log(String employeeId, String from, String to, String reason) {
    return leave.addPermission(employeeId, new PermissionInput(WORKING_DAY, from, to, reason), JUNE);
  }


  @Test
  void aPermissionIsSavedWithItsLengthAndShowsUpForThatEmployeeNewestFirst() {
    Employee e = employee("One");
    Employee other = employee("Two");
    assertTrue(log(e.id(), "10:00", "11:00", "Bank work").ok());
    assertTrue(log(e.id(), "15:00", "15:45", "").ok());
    log(other.id(), "10:00", "11:00", "");
    var mine = leave.getPermissions(e.id());
    assertEquals(List.of(List.of("15:00", "15:45", 45, ""), List.of("10:00", "11:00", 60, "Bank work")),
        mine.stream().map(p -> List.of(p.permission().from(), p.permission().to(), p.permission().minutes(), p.permission().reason())).toList());
    assertEquals(3, leave.getPermissions(null).size());
    assertFalse(leave.getPermissions(null).get(0).employeeName().isEmpty());
  }

  @Test
  void aBadPermissionIsRefusedAndNotSavedAnOverlappingOneToo() {
    Employee e = employee("One");
    assertFalse(log(e.id(), "11:00", "10:00", "").ok());
    log(e.id(), "10:00", "11:00", "");
    assertEquals("You already have a permission that overlaps this time.", log(e.id(), "10:30", "11:30", "").errors().get("form"));
    assertEquals(1, leave.getPermissions(e.id()).size());
  }

  @Test
  void itCantBeNotedOnADayWithApprovedOrPendingLeave() {
    Employee e = employee("One");
    leave.addLeaveRequest(e.id(), full(WORKING_DAY), JUNE);
    assertEquals("You already have leave on that day.", log(e.id(), "10:00", "11:00", "").errors().get("form"));
  }

  @Test
  void aPermissionTakesNothingFromTheLeaveBalance() {
    Employee e = employee("One");
    log(e.id(), "09:00", "17:00", "");
    var balance = balanceOf(LocalDate.parse("2026-12-01"));
    assertEquals(List.of(0.0, 24.0), List.of(balance.used(), balance.remaining()));
  }

  @Test
  void theDatabaseRefusesAnEndBeforeTheStartADayLongerThan8HoursAndATooLongReason() {
    Employee e = employee("One");
    for (String[] bad : new String[][] {{"11:00", "10:00", ""}, {"08:00", "17:00", ""}, {"10:00", "11:00", "x".repeat(201)}}) {
      assertThrows(DbException.class, () -> db.query(
          "insert into permissions (employee_id, permission_date, start_time, end_time, reason) values ($1, $2, $3, $4, $5)",
          e.id(), WORKING_DAY, bad[0], bad[1], bad[2]));
    }
  }

  @Test
  void deletingAnEmployeeRemovesTheirPermissions() {
    Employee e = employee("One");
    log(e.id(), "10:00", "11:00", "");
    db.query("delete from employees where id = $1", e.id());
    assertEquals(List.of(), leave.getPermissions(null));
  }
}
