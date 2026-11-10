package app.lumiether.domain;

import static org.junit.jupiter.api.Assertions.*;

import app.lumiether.domain.Leave.*;
import app.lumiether.domain.Types.Employee;
import app.lumiether.domain.Types.Holiday;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * Port of leave.test.ts: the leave policy. One balance of the category's days plus approved comp-off, weekends and
 * national holidays not deducted, comp-off expiry and deduction order, and blocking requests that overdraw the balance.
 */
class LeaveEngineTest {
  static final String TODAY = "2026-11-04";
  static final LocalDate today = LocalDate.parse(TODAY);
  static final List<Holiday> H = DatesTest.HOLIDAYS;

  // Joined 10 Mar 2024, so comp-off expires on 10 March.
  static final Employee me = new Employee("x", "Test Person", "test.person@gmail.com", "employee", 24, "2024-03-10");

  static Request request(String type, String status, String from) {
    return request(type, status, from, from, false);
  }

  static Request request(String type, String status, String from, String to) {
    return request(type, status, from, to, false);
  }

  static Request request(String type, String status, String from, String to, boolean halfDay) {
    return new Request(type + "-" + from + "-" + status, me.id(), type, status, from, to, "2026-01-01").withHalfDay(halfDay);
  }

  /** A comp-off claim for working {@code workedOn}. */
  static Request claim(String status, String workedOn) {
    return request("Comp-off", status, workedOn);
  }

  static Request claim(String status, String workedOn, boolean half) {
    return request("Comp-off", status, workedOn, workedOn, half);
  }

  static LeaveBalance balanceOf(List<Request> requests) {
    var entries = Leave.getLeaveEntries(requests, Map.of(), H, 2026);
    return Leave.getLeaveBalances(List.of(me), entries, requests, H, 2026, today).get(0);
  }

  static List<LeaveDay> full(String... dates) {
    return java.util.Arrays.stream(dates).map(d -> new LeaveDay(d, 1)).toList();
  }

  static CompOffLot lot(String id, String workedOn, String expiresOn) {
    return lot(id, workedOn, expiresOn, 1);
  }

  static CompOffLot lot(String id, String workedOn, String expiresOn, double days) {
    return new CompOffLot(id, me.id(), workedOn, days, expiresOn, "approved");
  }

  static Request halfDay(String status, String day) {
    return request("Casual leave", status, day, day, true);
  }

  static Request halfDay(String status, String day, String type) {
    return request(type, status, day, day, true);
  }

  @Nested
  class Quota {
    @Test
    void sickLeaveCountsTowardTheYearlyDaysSameAsCasual() {
      var leave = balanceOf(List.of(request("Casual leave", "approved", "2026-03-02", "2026-03-04"), request("Sick leave", "approved", "2026-04-06", "2026-04-07")));
      assertEquals(3, leave.casual());
      assertEquals(2, leave.sick());
      assertEquals(5, leave.used());
      assertEquals(19, leave.remaining());
    }

    @Test
    void pendingAndRejectedRequestsDontReduceTheRemainingDays() {
      var leave = balanceOf(List.of(request("Casual leave", "pending", "2026-03-02", "2026-03-04"), request("Sick leave", "rejected", "2026-04-06")));
      assertEquals(0, leave.used());
      assertEquals(24, leave.remaining());
    }

    @Test
    void aNationalHolidayInsideARequestIsntDeducted() {
      assertEquals(3, balanceOf(List.of(request("Casual leave", "approved", "2026-09-29", "2026-10-02"))).used());
    }

    @Test
    void weekendsArentDeductedFri13ToMon16NovIs2Days() {
      assertEquals(2, balanceOf(List.of(request("Casual leave", "approved", "2026-11-13", "2026-11-16"))).used());
    }

    @Test
    void aNewEmployeeWithNoLeaveHasTheFull24Days() {
      var b = balanceOf(List.of());
      assertEquals(24, b.total());
      assertEquals(24, b.remaining());
    }

    @Test
    void theDaysComeFromTheCategoryNotAFixed24() {
      Employee intern = new Employee("x", "T", "t@gmail.com", "intern", 10, "2024-03-10");
      var b = Leave.getLeaveBalances(List.of(intern), List.of(), List.of(), H, 2026, today).get(0);
      assertEquals(10, b.total());
    }
  }

  @Nested
  class EarningCompOff {
    @Test
    void aSaturdayASundayAndANationalHolidayEachEarn1Day() {
      assertEquals(1, Leave.compOffDaysFor("2026-10-31", false, H)); // Sat
      assertEquals(1, Leave.compOffDaysFor("2026-11-01", false, H)); // Sun
      assertEquals(1, Leave.compOffDaysFor("2026-10-02", false, H)); // Gandhi Jayanti, a Friday
    }

    @Test
    void aHalfDayWorkedEarnsHalf() {
      assertEquals(0.5, Leave.compOffDaysFor("2026-10-31", true, H));
    }

    @Test
    void anOrdinaryWorkingDayEarnsNothing() {
      assertEquals(0, Leave.compOffDaysFor("2026-11-04", false, H));
    }
  }

  @Nested
  class Expiry {
    @Test
    void expiresOnTheFirstJoiningAnniversaryAfterTheDayItWasEarned() {
      assertEquals("2026-03-10", Leave.compOffExpiry("2024-03-10", "2026-01-26")); // before this year's anniversary
      assertEquals("2027-03-10", Leave.compOffExpiry("2024-03-10", "2026-03-14")); // after it
      assertEquals("2027-03-10", Leave.compOffExpiry("2024-03-10", "2026-12-31"));
    }

    @Test
    void earnedOnTheAnniversaryItselfItLastsUntilTheNextOne() {
      assertEquals("2027-03-10", Leave.compOffExpiry("2024-03-10", "2026-03-10"));
    }

    @Test
    void a29FebJoinersAnniversaryIs28FebInANonLeapYear() {
      assertEquals("2026-02-28", Leave.compOffExpiry("2024-02-29", "2026-01-03"));
      assertEquals("2028-02-29", Leave.compOffExpiry("2024-02-29", "2027-03-01"));
    }

    @Test
    void eachEntryCarriesItsExpiryTakenFromTheEmployeesJoiningDate() {
      var entry = Leave.getCompOffLots(List.of(claim("approved", "2026-08-15")), List.of(me), H).get(0);
      assertEquals("2027-03-10", entry.expiresOn());
    }

    @Test
    void usableUpToTheDayBeforeTheAnniversaryNotOnIt() {
      var lots = Leave.getCompOffLots(List.of(claim("approved", "2026-02-07")), List.of(me), H); // expires 10 Mar 2026
      assertEquals(0, Leave.summariseCompOff(lots, full("2026-03-09"), "2026-03-09").available()); // spent on the 9th
      assertEquals(new CompOffSummary(0, 0, 1), Leave.summariseCompOff(lots, full("2026-03-10"), "2026-03-10")); // the 10th falls to the regular days
    }

    @Test
    void unusedCompOffDropsOutOfTheBalanceOnceItExpires() {
      var before = balanceOf(List.of(claim("approved", "2026-01-26"))); // expires 10 Mar 2026, today is 4 Nov
      assertEquals(24, before.total());
      assertEquals(1, before.compOffExpired());
    }

    @Test
    void regularLeaveDoesNotExpire() {
      assertEquals(23, balanceOf(List.of(request("Casual leave", "approved", "2026-02-02"))).remaining());
    }
  }

  @Nested
  class HalfDay {
    @Test
    void countsAsHalfADay() {
      assertEquals(0.5, Leave.leaveDays(halfDay("approved", "2026-11-16"), H));
      assertEquals(1, Leave.leaveDays(request("Casual leave", "approved", "2026-11-16"), H));
    }

    @Test
    void takesHalfFromTheBalanceCasualAndSickAlike() {
      var b = balanceOf(List.of(halfDay("approved", "2026-11-16"), halfDay("approved", "2026-11-17", "Sick leave")));
      assertEquals(List.of(0.5, 0.5, 1.0, 23.0), List.of(b.casual(), b.sick(), b.used(), b.remaining()));
    }

    @Test
    void pendingAndRejectedHalfDaysDontReduceTheBalance() {
      assertEquals(24, balanceOf(List.of(halfDay("pending", "2026-11-16"), halfDay("rejected", "2026-11-17"))).remaining());
    }

    @Test
    void aHalfDayUsesCompOffFirstSameAsAFullDay() {
      var b = balanceOf(List.of(claim("approved", "2026-10-31"), halfDay("approved", "2026-11-05")));
      assertEquals(25, b.total());
      assertEquals(24.5, b.remaining());
      assertEquals(0.5, b.compOffAvailable());
    }

    @Test
    void aHalfDayCompOffLotCoversAHalfDayExactly() {
      var b = balanceOf(List.of(claim("approved", "2026-10-31", true), halfDay("approved", "2026-11-05")));
      assertEquals(List.of(24.5, 24.0, 0.0), List.of(b.total(), b.remaining(), b.compOffAvailable()));
    }

    @Test
    void twoHalfDaysOnOneCompOffDayUseAllOfItAndAThirdFallsToTheRegularDays() {
      var b = balanceOf(List.of(claim("approved", "2026-10-31"), halfDay("approved", "2026-11-05"), halfDay("approved", "2026-11-06"), halfDay("approved", "2026-11-09")));
      assertEquals(List.of(1.5, 0.0, 23.5), List.of(b.used(), b.compOffAvailable(), b.remaining()));
    }

    @Test
    void showsUpInTheMonthlyChartAsHalfADay() {
      var entries = Leave.getLeaveEntries(List.of(halfDay("approved", "2026-11-16")), Map.of(), H, 2026);
      assertEquals(1, entries.size());
      assertEquals(10, entries.get(0).month());
      assertEquals(0.5, entries.get(0).days());
    }
  }

  @Nested
  class Cancelled {
    @Test
    void cancelledLeaveTakesNothingFromTheBalance() {
      var b = balanceOf(List.of(request("Casual leave", "cancelled", "2026-11-16", "2026-11-18")));
      assertEquals(List.of(0.0, 24.0), List.of(b.used(), b.remaining()));
    }

    @Test
    void theDaysOfCancelledLeaveReturnIncludingToTheChart() {
      assertEquals(List.of(), Leave.getLeaveEntries(List.of(request("Casual leave", "cancelled", "2026-11-16")), Map.of(), H, 2026));
    }

    @Test
    void leaveWithACancellationStillWaitingKeepsCountingAndThePersonStaysOutUntilItsApproved() {
      Request waiting = request("Casual leave", "approved", "2026-11-16").withCancelRequested();
      assertEquals(1, balanceOf(List.of(waiting)).used());
      assertEquals(1, Leave.getOutOn(List.of(waiting), LocalDate.parse("2026-11-16")).size());
      assertTrue(Leave.isCancelRequest(waiting));
      assertFalse(Leave.isCancelRequest(request("Casual leave", "approved", "2026-11-16")));
    }

    @Test
    void compOffUsedByCancelledLeaveIsAvailableAgain() {
      var used = balanceOf(List.of(claim("approved", "2026-10-31"), request("Casual leave", "approved", "2026-11-05")));
      assertEquals(0, used.compOffAvailable());
      var cancelled = balanceOf(List.of(claim("approved", "2026-10-31"), request("Casual leave", "cancelled", "2026-11-05")));
      assertEquals(List.of(1.0, 25.0), List.of(cancelled.compOffAvailable(), cancelled.remaining()));
    }

    @Test
    void everythingWaitingOnAnAdminPendingRequestsPlusCancellationRequests() {
      Request waiting = request("Casual leave", "approved", "2026-11-16").withCancelRequested();
      var all = List.of(request("Casual leave", "pending", "2026-11-17"), request("Casual leave", "approved", "2026-11-18"),
          request("Casual leave", "cancelled", "2026-11-19"), request("Casual leave", "rejected", "2026-11-20"), waiting);
      assertEquals(List.of("2026-11-17", "2026-11-16"), Leave.getAwaitingDecision(all).stream().map(Request::from).toList());
    }
  }

  @Nested
  class OneBalanceWithCompOff {
    @Test
    void approvedCompOffAddsToTheTotalAndTheRemainingDays() {
      var b = balanceOf(List.of(claim("approved", "2026-10-31"), claim("approved", "2026-09-19", true)));
      assertEquals(25.5, b.total());
      assertEquals(25.5, b.remaining());
      assertEquals(1.5, b.compOffAvailable());
    }

    @Test
    void takingLeaveReducesTheSameBalanceAndTheCompOffPartShrinksFirst() {
      var b = balanceOf(List.of(claim("approved", "2026-10-31"), request("Casual leave", "approved", "2026-11-05")));
      assertEquals(List.of(25.0, 1.0, 24.0, 0.0), List.of(b.total(), b.used(), b.remaining(), b.compOffAvailable()));
    }
  }

  @Nested
  class DeductionOrder {
    final List<CompOffLot> lots = List.of(lot("later", "2026-01-03", "2026-12-01"), lot("sooner", "2026-01-10", "2026-09-01"));

    @Test
    void leaveComesOutOfTheCompOffThatExpiresSoonest() {
      assertEquals(1, Leave.summariseCompOff(lots, full("2026-06-01"), "2026-06-02").available());
      assertEquals(new CompOffSummary(2, 1, 0), Leave.summariseCompOff(lots, full("2026-06-01"), "2026-10-01"));
    }

    @Test
    void whenTwoLotsExpireTogetherTheOneEarnedFirstGoesFirst() {
      var a = lot("a", "2026-01-03", "2026-12-01");
      var b = lot("b", "2026-01-10", "2026-12-01");
      assertEquals(1, Leave.summariseCompOff(List.of(b, a), full("2026-06-01"), "2026-11-04").available());
      assertEquals(1, Leave.summariseCompOff(List.of(b, a), full("2026-01-05", "2026-01-06"), "2026-11-04").available()); // b can't cover days before it was earned
    }

    @Test
    void onceCompOffRunsOutLeaveFallsToTheRegularDays() {
      var b = balanceOf(List.of(claim("approved", "2026-10-31"), request("Casual leave", "approved", "2026-11-05", "2026-11-06")));
      assertEquals(List.of(2.0, 25.0, 23.0, 0.0), List.of(b.used(), b.total(), b.remaining(), b.compOffAvailable()));
    }

    @Test
    void aHalfDayLotCoversHalfALeaveDayTheRestComesFromTheNextSource() {
      assertEquals(new CompOffSummary(0.5, 0, 0), Leave.summariseCompOff(List.of(lot("h", "2026-01-03", "2026-12-01", 0.5)), full("2026-06-01"), "2026-11-04"));
    }

    @Test
    void compOffCantCoverADayBeforeItWasEarned() {
      assertEquals(1, Leave.summariseCompOff(List.of(lot("n", "2026-10-31", "2027-03-10")), full("2026-10-30"), "2026-11-04").available());
    }
  }

  @Nested
  class PendingCompOff {
    @Test
    void aPendingClaimDoesntCountTowardTheBalance() {
      var b = balanceOf(List.of(claim("pending", "2026-10-31")));
      assertEquals(List.of(24.0, 24.0, 0.0), List.of(b.total(), b.remaining(), b.compOffAvailable()));
    }

    @Test
    void itCountsOnceApprovedAndARejectedClaimNeverDoes() {
      assertEquals(25, balanceOf(List.of(claim("approved", "2026-10-31"))).total());
      assertEquals(24, balanceOf(List.of(claim("rejected", "2026-10-31"))).total());
    }

    @Test
    void leaveCantDrawOnAPendingClaim() {
      assertEquals(23, balanceOf(List.of(claim("pending", "2026-10-31"), request("Casual leave", "approved", "2026-11-05"))).remaining());
    }
  }

  @Nested
  class Blocking {
    // 24 days taken Jan to Aug, none left.
    static Map<String, PastLeave> past(double... casual) {
      return Map.of("x", new PastLeave(casual, new double[10]));
    }

    static final Map<String, PastLeave> ALL_USED = past(3, 3, 3, 3, 3, 3, 3, 3, 0, 0);

    LeaveCheck check(Request candidate, List<Request> requests, Map<String, PastLeave> past) {
      return Leave.checkLeaveRequest(candidate, List.of(me), requests, past, H, today);
    }

    Request ask(String from) {
      return request("Casual leave", "pending", from);
    }

    Request ask(String from, String to) {
      return request("Casual leave", "pending", from, to);
    }

    @Test
    void blockedWhenTheBalanceIsEmpty() {
      var r = check(ask("2026-11-09"), List.of(), ALL_USED);
      assertFalse(r.ok());
      assertEquals(1, r.shortfall());
    }

    @Test
    void allowedWhenExactlyEnoughIsLeftBlockedOneDayBeyond() {
      var past = past(3, 3, 3, 3, 3, 3, 3, 2, 0, 0); // 23 used
      assertTrue(check(ask("2026-11-09"), List.of(), past).ok());
      var two = check(ask("2026-11-09", "2026-11-10"), List.of(), past);
      assertFalse(two.ok());
      assertEquals(1, two.shortfall());
    }

    @Test
    void pendingRequestsAlreadyOnTheBooksAreReserved() {
      var past = past(3, 3, 3, 3, 3, 3, 3, 2, 0, 0);
      assertFalse(check(ask("2026-11-10"), List.of(ask("2026-11-09")), past).ok());
    }

    @Test
    void approvedCompOffMakesRoom() {
      var withComp = List.of(claim("approved", "2026-10-31"));
      assertTrue(check(ask("2026-11-09"), withComp, ALL_USED).ok());
      assertFalse(check(ask("2026-11-09", "2026-11-10"), withComp, ALL_USED).ok());
    }

    @Test
    void pendingOrExpiredCompOffDoesnt() {
      assertFalse(check(ask("2026-11-09"), List.of(claim("pending", "2026-10-31")), ALL_USED).ok());
      assertFalse(check(ask("2026-11-09"), List.of(claim("approved", "2026-01-26")), ALL_USED).ok()); // expired 10 Mar
    }

    @Test
    void withHalfADayLeftAHalfDayIsAllowedAndAFullDayIsBlockedWithNoneLeftBothAre() {
      var past = past(3, 3, 3, 3, 3, 3, 3, 2.5, 0, 0); // 23.5 used
      var half = request("Casual leave", "pending", "2026-11-09", "2026-11-09", true);
      assertTrue(check(half, List.of(), past).ok());
      assertFalse(check(ask("2026-11-09"), List.of(), past).ok());
      assertFalse(check(half, List.of(), ALL_USED).ok());
    }

    @Test
    void aRequestThatOnlyCoversAWeekendTakesZeroDaysSoItIsntBlocked() {
      assertTrue(check(ask("2026-11-14", "2026-11-15"), List.of(), ALL_USED).ok());
    }

    @Test
    void compOffClaimsAreNeverBlocked() {
      assertTrue(check(claim("pending", "2026-10-31"), List.of(), ALL_USED).ok());
    }

    @Test
    void aRefusedRequestNeverSaysByHowMuchTheBalanceWasShort() {
      var r = check(request("Casual leave", "pending", "2026-11-09"), List.of(), ALL_USED);
      assertFalse(r.ok());
      assertTrue(r.message().matches(".*enough leave.*"));
      assertFalse(r.message().matches(".*\\d.*"), "no numbers in the message");
    }

    @Test
    void aCategoryWithFewerDaysBlocksSooner() {
      Employee intern = new Employee("x", "Test Person", "test.person@gmail.com", "intern", 2, "2024-03-10");
      var ctxRequests = List.of(request("Casual leave", "approved", "2026-11-09"));
      assertTrue(Leave.checkLeaveRequest(request("Casual leave", "pending", "2026-11-10"), List.of(intern), ctxRequests, Map.of(), H, today).ok()); // 2 days in all
      assertFalse(Leave.checkLeaveRequest(request("Casual leave", "pending", "2026-11-10", "2026-11-11"), List.of(intern), ctxRequests, Map.of(), H, today).ok()); // 3 days
    }
  }

  @Nested
  class StartsEmpty {
    @Test
    void thereIsNoSeededLeaveCompOffOrEmployeeDataToDeriveAnythingFrom() {
      var entries = Leave.getLeaveEntries(List.of(), Map.of(), H, 2026);
      assertEquals(List.of(), entries);
      assertEquals(List.of(), Leave.getLeaveBalances(List.of(), entries, List.of(), H, 2026, today));
      assertEquals(List.of(), Leave.getCompOffLots(List.of(), List.of(), H));
    }

    @Test
    void theFourNationalHolidaysAreKept() {
      assertEquals(List.of("Republic Day 26/1", "Labour Day 1/5", "Independence Day 15/8", "Gandhi Jayanti 2/10"),
          H.stream().map(h -> h.name() + " " + h.day() + "/" + h.month()).toList());
    }
  }

  @Nested
  class WhatAnEmployeeSees {
    Applied applied(List<Request> requests) {
      return Leave.appliedLeaveDays(requests, H, 2026);
    }

    @Test
    void daysAppliedForSplitIntoApprovedAndWaitingWithHalfDaysCountedAsHalf() {
      var r = applied(List.of(request("Casual leave", "approved", "2026-11-16", "2026-11-18"), // 3
          request("Sick leave", "pending", "2026-11-19", "2026-11-19", true), // 0.5
          request("Casual leave", "pending", "2026-12-01", "2026-12-02"))); // 2
      assertEquals(new Applied(3, 2.5, 5.5), r);
    }

    @Test
    void rejectedAndCancelledLeaveAndCompOffClaimsDontCount() {
      assertEquals(new Applied(0, 0, 0), applied(List.of(request("Casual leave", "rejected", "2026-11-16"),
          request("Casual leave", "cancelled", "2026-11-17"), request("Comp-off", "approved", "2026-10-31"))));
    }

    @Test
    void weekendsAndNationalHolidaysArentCountedAndOnlyDaysInTheYearAre() {
      assertEquals(2, applied(List.of(request("Casual leave", "approved", "2026-11-13", "2026-11-16"))).total()); // Fri to Mon
      assertEquals(2, applied(List.of(request("Casual leave", "approved", "2026-12-30", "2027-01-04"))).total()); // 30, 31 Dec only
    }

    @Test
    void leaveWithACancellationWaitingStillCountsAsAppliedUntilItsApproved() {
      assertEquals(1, applied(List.of(request("Casual leave", "approved", "2026-11-16").withCancelRequested())).approved());
    }
  }

  @Test
  void whoIsOutThisWeekIsMondayToSundayApprovedLeaveEarliestFirst() {
    var list = new ArrayList<>(List.of(request("Casual leave", "approved", "2026-11-05"), request("Casual leave", "approved", "2026-11-02"),
        request("Casual leave", "pending", "2026-11-03"), request("Casual leave", "approved", "2026-11-09"), claim("approved", "2026-11-07")));
    assertEquals(List.of("2026-11-02", "2026-11-05"), Leave.getOutThisWeek(list, today).stream().map(Request::from).toList());
  }

  @Test
  void theMonthlyChartTotalsMatchTheBalanceTable() {
    var requests = List.of(request("Casual leave", "approved", "2026-03-02", "2026-03-04"), request("Sick leave", "pending", "2026-03-09"));
    var entries = Leave.getLeaveEntries(requests, Map.of(), H, 2026);
    var march = Leave.getMonthlyLeave(entries).get(2);
    assertEquals(3, march.approved());
    assertEquals(1, march.pending());
  }
}
