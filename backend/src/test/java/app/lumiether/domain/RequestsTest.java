package app.lumiether.domain;

import static org.junit.jupiter.api.Assertions.*;

import app.lumiether.domain.Leave.Request;
import app.lumiether.domain.Requests.*;
import app.lumiether.domain.Types.Employee;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Port of requests.test.ts: what an employee may submit. Leave requests, cancelling, comp-off claims, permissions. */
class RequestsTest {
  static final LocalDate today = LocalDate.parse("2026-11-04"); // a Wednesday
  static final Employee employee = new Employee("x", "Test Person", "test.person@gmail.com", "employee", 24, "2024-03-10");

  static Request existing(String type, String status, String from) {
    return existing(type, status, from, from);
  }

  static Request existing(String type, String status, String from, String to) {
    return new Request(type + "-" + from, "x", type, status, from, to, "2026-11-01");
  }

  static Validated<LeaveValue> leave(LeaveInput in, Request... mine) {
    return Requests.validateLeaveInput(in, today, DatesTest.HOLIDAYS, List.of(mine));
  }

  static Validated<CompOffValue> comp(CompOffInput in, Request... mine) {
    return Requests.validateCompOffInput(in, today, DatesTest.HOLIDAYS, List.of(mine), employee);
  }

  static LeaveInput ok(String type, String from, String to, String len) {
    return new LeaveInput(type, from, to, len);
  }

  // ------------------------------------------------------------ requesting leave

  final LeaveInput okLeave = ok("Casual leave", "2026-11-16", "2026-11-18", "full");

  @Test
  void acceptsCasualAndSickLeaveOverRealOrderedDates() {
    assertTrue(leave(okLeave).ok());
    assertTrue(leave(ok("Sick leave", "2026-11-16", "2026-11-18", "full")).ok());
  }

  @Test
  void aSingleDayIsFine() {
    assertTrue(leave(ok("Casual leave", "2026-11-16", "2026-11-16", "full")).ok());
  }

  @Test
  void compOffIsNotALeaveTypeYouCanRequest() {
    var r = leave(ok("Comp-off", "2026-11-16", "2026-11-18", "full"));
    assertEquals("Choose casual or sick leave.", r.errors().get("type"));
  }

  @Test
  void rejectsMissingAndImpossibleDates() {
    for (String from : List.of("", "2026-02-30", "16/11/2026")) {
      assertEquals("Pick a start date.", leave(ok("Casual leave", from, "2026-11-18", "full")).errors().get("from"), from);
    }
    assertFalse(leave(ok("Casual leave", "2026-11-16", "", "full")).ok());
    assertEquals("Pick an end date.", leave(ok("Casual leave", "2026-11-16", "", "full")).errors().get("to"));
  }

  @Test
  void theEndCantBeBeforeTheStart() {
    assertEquals("The end date can't be before the start date.", leave(ok("Casual leave", "2026-11-18", "2026-11-16", "full")).errors().get("to"));
  }

  @Test
  void cantStartBeforeThisYearOrEndAfterNextYear() {
    assertEquals("Leave can't start before this year.", leave(ok("Casual leave", "2025-12-31", "2026-01-02", "full")).errors().get("from"));
    assertEquals("Leave can't end after next year.", leave(ok("Casual leave", "2027-12-30", "2028-01-02", "full")).errors().get("to"));
  }

  @Test
  void aRangeIsCappedAt90Days() {
    assertTrue(leave(ok("Casual leave", "2026-11-02", "2027-01-30", "full")).ok()); // 90 days
    var tooLong = leave(ok("Casual leave", "2026-11-02", "2027-01-31", "full")); // 91
    assertEquals("A request can cover at most 90 days.", tooLong.errors().get("to"));
  }

  @Test
  void aRangeOfOnlyAWeekendOrHolidayIsRefusedSinceNothingWouldBeDeducted() {
    assertEquals("Those dates are all weekends or national holidays, so there's nothing to take off.",
        leave(ok("Casual leave", "2026-11-14", "2026-11-15", "full")).errors().get("form"));
    assertNotNull(leave(ok("Casual leave", "2026-10-02", "2026-10-02", "full")).errors().get("form"));
  }

  @Test
  void blockedIfItOverlapsPendingOrApprovedLeaveButNotRejectedLeaveOrCompOffClaims() {
    for (String status : List.of("pending", "approved")) {
      var r = leave(okLeave, existing("Casual leave", status, "2026-11-17", "2026-11-20"));
      assertEquals("You already have leave that overlaps these dates.", r.errors().get("form"), status);
    }
    assertTrue(leave(okLeave, existing("Casual leave", "rejected", "2026-11-17", "2026-11-20")).ok());
    assertTrue(leave(okLeave, existing("Comp-off", "approved", "2026-11-17")).ok());
  }

  @Test
  void backToBackLeaveDoesntCountAsOverlapping() {
    assertTrue(leave(okLeave, existing("Casual leave", "approved", "2026-11-13", "2026-11-15")).ok());
  }

  // ---------------------------------------------------------------- half days

  final LeaveInput half = ok("Casual leave", "2026-11-16", "2026-11-16", "half"); // a Monday

  @Test
  void aHalfDayIsAcceptedAndFlagged() {
    assertEquals(new LeaveValue("Casual leave", "2026-11-16", "2026-11-16", true), leave(half).value());
  }

  @Test
  void aHalfDayWorksForSickLeaveToo() {
    assertTrue(leave(ok("Sick leave", "2026-11-16", "2026-11-16", "half")).ok());
  }

  @Test
  void aHalfDayIsAlwaysASingleDayTheToDateIsIgnoredEvenIfBlankOrLater() {
    for (String to : List.of("", "2026-11-20")) {
      assertEquals("2026-11-16", leave(ok("Casual leave", "2026-11-16", to, "half")).value().to(), to);
    }
  }

  @Test
  void aWeekendOrNationalHolidayCantBeAHalfDay() {
    for (String from : List.of("2026-11-14", "2026-10-02")) {
      var r = leave(ok("Casual leave", from, from, "half"));
      assertEquals("That day is a weekend or a national holiday, so there's nothing to take off.", r.errors().get("form"), from);
    }
  }

  @Test
  void aHalfDayIsStillBlockedIfItOverlapsOtherLeaveAndTheDayLengthMustBeFullOrHalf() {
    assertFalse(leave(half, existing("Casual leave", "approved", "2026-11-16")).ok());
    assertEquals("Choose a full or half day.", leave(ok("Casual leave", "2026-11-16", "2026-11-16", "quarter")).errors().get("dayLength"));
    assertFalse(leave(ok("Casual leave", "2026-11-16", "2026-11-16", "")).ok());
  }

  @Test
  void aFullDayRequestStillNeedsAValidToDate() {
    assertFalse(leave(ok("Casual leave", "2026-11-16", "", "full")).ok());
  }

  // --------------------------------------------------------------- cancelling

  static Request mine(String status, String from) {
    return existing("Casual leave", status, from);
  }

  @Test
  void pendingLeaveIsWithdrawnStraightAwayEvenIfItHasStarted() {
    for (String from : List.of("2026-11-16", "2026-11-02")) {
      var plan = Requests.planCancellation(mine("pending", from), today);
      assertEquals(new CancelPlan(true, "withdraw", null), plan, from);
    }
  }

  @Test
  void approvedLeaveThatHasntStartedGoesToAnAdminIncludingLeaveStartingToday() {
    for (String from : List.of("2026-11-16", "2026-11-04")) {
      assertEquals(new CancelPlan(true, "request", null), Requests.planCancellation(mine("approved", from), today), from);
    }
  }

  @Test
  void approvedLeaveThatHasAlreadyStartedCantBeCancelled() {
    var plan = Requests.planCancellation(mine("approved", "2026-11-03"), today);
    assertFalse(plan.ok());
    assertEquals("This leave has already started, so it can't be cancelled.", plan.error());
  }

  @Test
  void aCancellationAlreadyRequestedOrRejectedCancelledOrCompOffRequestsCantBeCancelled() {
    assertEquals("You've already asked to cancel this leave.", Requests.planCancellation(mine("approved", "2026-11-16").withCancelRequested(), today).error());
    assertEquals("That request is already closed.", Requests.planCancellation(mine("rejected", "2026-11-16"), today).error());
    assertEquals("That request is already closed.", Requests.planCancellation(mine("cancelled", "2026-11-16"), today).error());
    assertEquals("Comp-off requests can't be cancelled here.", Requests.planCancellation(existing("Comp-off", "pending", "2026-10-31"), today).error());
  }

  @Test
  void cancelledLeaveFreesItsDatesForANewRequest() {
    assertTrue(leave(okLeave, mine("cancelled", "2026-11-17")).ok());
  }

  // ------------------------------------------------------------------ comp-off

  static CompOffInput claimOn(String day, String len) {
    return new CompOffInput(day, len);
  }

  @Test
  void acceptsAPastSaturdayAPastSundayAndAPastNationalHoliday() {
    for (String d : List.of("2026-10-31", "2026-11-01", "2026-10-02")) assertTrue(comp(claimOn(d, "full")).ok(), d);
  }

  @Test
  void aHalfDayCompOffIsAcceptedAndFlagged() {
    assertEquals(new CompOffValue("2026-10-31", true), comp(claimOn("2026-10-31", "half")).value());
  }

  @Test
  void anOrdinaryWorkingDayEarnsNothingSoItsRefused() {
    assertEquals("That was a working day, so it doesn't earn comp-off. Pick a weekend or a national holiday.",
        comp(claimOn("2026-11-03", "full")).errors().get("workedOn"));
  }

  @Test
  void cantClaimADayThatHasntHappenedYet() {
    assertEquals("That day hasn't happened yet.", comp(claimOn("2026-11-07", "full")).errors().get("workedOn"));
  }

  @Test
  void cantClaimADayBeforeThisYearOrBeforeJoining() {
    assertEquals("Comp-off can't be claimed for days before this year.", comp(claimOn("2025-12-27", "full")).errors().get("workedOn"));
    Employee lateJoiner = new Employee("x", "T", "t@gmail.com", "employee", 24, "2026-11-02");
    var r = Requests.validateCompOffInput(claimOn("2026-10-31", "full"), today, DatesTest.HOLIDAYS, List.of(), lateJoiner);
    assertEquals("That's before your joining date.", r.errors().get("workedOn"));
  }

  @Test
  void rejectsAMissingDateAndAnUnknownDayLength() {
    assertEquals("Pick the day you worked.", comp(claimOn("", "full")).errors().get("workedOn"));
    assertEquals("Choose a full or half day.", comp(claimOn("2026-10-31", "double")).errors().get("dayLength"));
  }

  @Test
  void theSameDayCantBeClaimedTwiceUnlessTheEarlierClaimWasRejected() {
    assertEquals("You've already claimed comp-off for that day.", comp(claimOn("2026-10-31", "full"), existing("Comp-off", "pending", "2026-10-31")).errors().get("workedOn"));
    assertFalse(comp(claimOn("2026-10-31", "full"), existing("Comp-off", "approved", "2026-10-31")).ok());
    assertTrue(comp(claimOn("2026-10-31", "full"), existing("Comp-off", "rejected", "2026-10-31")).ok());
  }

  // --------------------------------------------------------------- permissions

  final PermissionInput okPerm = new PermissionInput("2026-11-05", "10:00", "11:00", "Bank work"); // a Thursday

  static Validated<PermissionValue> perm(PermissionInput in, List<Request> leave, List<Permission> permissions) {
    return Requests.validatePermissionInput(in, today, DatesTest.HOLIDAYS, leave, permissions);
  }

  static Validated<PermissionValue> perm(PermissionInput in) {
    return perm(in, List.of(), List.of());
  }

  static Permission taken(String date, String from, String to) {
    return new Permission("p", "x", date, from, to, 60, "");
  }

  @Test
  void anHourOnAWorkingDayIsAcceptedWithItsLengthWorkedOut() {
    assertEquals(new PermissionValue("2026-11-05", "10:00", "11:00", 60, "Bank work"), perm(okPerm).value());
  }

  @Test
  void anyLengthUpTo8HoursWorksToTheMinuteAndTheReasonIsOptionalAndTrimmed() {
    var r = perm(new PermissionInput("2026-11-05", "09:15", "10:00", "  "));
    assertEquals(List.of(45, ""), List.of(r.value().minutes(), r.value().reason()));
    assertTrue(perm(new PermissionInput("2026-11-05", "09:00", "17:00", "")).ok()); // exactly 8 hours
    assertEquals("A permission can be at most 8 hours. Request leave for a full day.", perm(new PermissionInput("2026-11-05", "09:00", "17:01", "")).errors().get("to"));
  }

  @Test
  void theEndHasToBeAfterTheStartAndBothTimesHaveToBeReal() {
    assertEquals("The end time has to be after the start time.", perm(new PermissionInput("2026-11-05", "11:00", "10:00", "")).errors().get("to"));
    assertFalse(perm(new PermissionInput("2026-11-05", "10:00", "10:00", "")).ok());
    for (String from : List.of("", "25:00", "9:00", "10:60", "ten")) {
      assertEquals("Pick a start time.", perm(new PermissionInput("2026-11-05", from, "11:00", "")).errors().get("from"), from);
    }
    assertEquals("Pick an end time.", perm(new PermissionInput("2026-11-05", "10:00", "", "")).errors().get("to"));
  }

  @Test
  void aWeekendOrNationalHolidayDoesntNeedAPermission() {
    for (String date : List.of("2026-11-07", "2026-11-08", "2026-10-02")) {
      assertEquals("That's a weekend or a national holiday, so no permission is needed.", perm(new PermissionInput(date, "10:00", "11:00", "")).errors().get("date"), date);
    }
  }

  @Test
  void theDayHasToBeRealAndWithinThisYearToTheEndOfNext() {
    for (String date : List.of("", "2026-02-30", "2025-12-31", "2028-01-03")) assertFalse(perm(new PermissionInput(date, "10:00", "11:00", "")).ok(), date);
    assertTrue(perm(new PermissionInput("2026-01-05", "10:00", "11:00", "")).ok());
  }

  @Test
  void aLongReasonIsRefused() {
    assertTrue(perm(new PermissionInput("2026-11-05", "10:00", "11:00", "x".repeat(200))).ok());
    assertEquals("Keep it under 200 characters.", perm(new PermissionInput("2026-11-05", "10:00", "11:00", "x".repeat(201))).errors().get("reason"));
  }

  @Test
  void itCantOverlapAnotherPermissionThatDayButBackToBackOrAnotherDayIsFine() {
    var other = List.of(taken("2026-11-05", "10:30", "11:30"));
    assertEquals("You already have a permission that overlaps this time.", perm(okPerm, List.of(), other).errors().get("form"));
    assertTrue(perm(new PermissionInput("2026-11-05", "11:30", "12:30", ""), List.of(), other).ok());
    assertTrue(perm(new PermissionInput("2026-11-05", "09:30", "10:30", ""), List.of(), other).ok());
    assertTrue(perm(new PermissionInput("2026-11-06", "10:00", "11:00", ""), List.of(), other).ok());
  }

  @Test
  void itCantBeOnADayYouAlreadyHaveLeaveUnlessThatLeaveWasRejectedOrCancelled() {
    java.util.function.Function<String, List<Request>> leave = status -> List.of(existing("Casual leave", status, "2026-11-04", "2026-11-06"));
    assertEquals("You already have leave on that day.", perm(okPerm, leave.apply("approved"), List.of()).errors().get("form"));
    assertFalse(perm(okPerm, leave.apply("pending"), List.of()).ok());
    assertTrue(perm(okPerm, leave.apply("rejected"), List.of()).ok());
    assertTrue(perm(okPerm, leave.apply("cancelled"), List.of()).ok());
    assertTrue(perm(okPerm, List.of(existing("Comp-off", "approved", "2026-11-05")), List.of()).ok());
  }

  @Test
  void lengthsReadNaturally() {
    assertEquals(List.of("30 min", "1 hr", "1 hr 30 min", "2 hr", "0 min"), List.of(30, 60, 90, 120, 0).stream().map(Requests::formatMinutes).toList());
  }
}
