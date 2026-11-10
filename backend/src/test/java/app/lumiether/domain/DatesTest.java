package app.lumiether.domain;

import static org.junit.jupiter.api.Assertions.*;

import app.lumiether.domain.Leave.Request;
import app.lumiether.domain.Types.Holiday;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Port of dates.test.ts: ranges across month and year boundaries, leap years, weekends, holidays, single days. */
class DatesTest {
  static final List<Holiday> HOLIDAYS = List.of(
      new Holiday("Republic Day", 1, 26), new Holiday("Labour Day", 5, 1),
      new Holiday("Independence Day", 8, 15), new Holiday("Gandhi Jayanti", 10, 2));

  static Request request(String from, String to) {
    return new Request("t", "e1", "Casual leave", "approved", from, to, "2026-01-01");
  }

  static double leaveDays(Request r) {
    return Leave.leaveDays(r, HOLIDAYS);
  }

  static List<String> isoDays(String from, String to) {
    List<String> days = new ArrayList<>();
    for (LocalDate d = LocalDate.parse(from); !d.isAfter(LocalDate.parse(to)); d = d.plusDays(1)) days.add(d.toString());
    return days;
  }

  /** Days that count against the quota, as month indexes (0 = Jan). */
  static List<Integer> countedMonths(String from, String to, int year) {
    return Leave.balanceDays(request(from, to), HOLIDAYS, year).stream().map(Leave.Day::month).toList();
  }

  @Test
  void fri30OctToMon2NovIs2WorkingDaysTheWeekendIsSkipped1InEachMonth() {
    assertEquals(2, leaveDays(request("2026-10-30", "2026-11-02")));
    assertEquals(List.of("2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"), isoDays("2026-10-30", "2026-11-02"));
    assertEquals(List.of(9, 10), countedMonths("2026-10-30", "2026-11-02", 2026));
  }

  @Test
  void formatsRanges() {
    assertEquals("30 Oct – 2 Nov", Dates.formatRange("2026-10-30", "2026-11-02"));
    assertEquals("16–18 Nov", Dates.formatRange("2026-11-16", "2026-11-18"));
    assertEquals("13 Nov", Dates.formatRange("2026-11-13", "2026-11-13"));
  }

  @Test
  void acrossAYearBoundaryOnlyDaysInTheRequestedYearCount() {
    assertEquals(3, leaveDays(request("2026-12-30", "2027-01-02"))); // Wed, Thu | Fri, Sat (skipped)
    assertEquals(2, countedMonths("2026-12-30", "2027-01-02", 2026).size());
    assertEquals(1, countedMonths("2026-12-30", "2027-01-02", 2027).size());
  }

  @Test
  void sun27FebToWed1Mar2028Includes29FebThreeWorkingDays() {
    assertEquals(List.of("2028-02-27", "2028-02-28", "2028-02-29", "2028-03-01"), isoDays("2028-02-27", "2028-03-01"));
    assertEquals(3, leaveDays(request("2028-02-27", "2028-03-01")));
    assertEquals(List.of(1, 1, 2), countedMonths("2028-02-27", "2028-03-01", 2028));
  }

  @Test
  void theSameDatesInANonLeapYearAreSatToMonOneWorkingDay() {
    assertEquals(List.of("2027-02-27", "2027-02-28", "2027-03-01"), isoDays("2027-02-27", "2027-03-01"));
    assertEquals(1, leaveDays(request("2027-02-27", "2027-03-01")));
  }

  @Test
  void feb28ToMar1IsTwoCalendarDaysApartIn2028AndOneIn2027() {
    assertEquals(2, ChronoUnit.DAYS.between(LocalDate.parse("2028-02-28"), LocalDate.parse("2028-03-01")));
    assertEquals(1, ChronoUnit.DAYS.between(LocalDate.parse("2027-02-28"), LocalDate.parse("2027-03-01")));
  }

  @Test
  void mon28FebToWed1Mar2028IsThreeWorkingDays() {
    assertEquals(3, leaveDays(request("2028-02-28", "2028-03-01")));
  }

  @Test
  void fri13ToMon16NovIsTwoDaysNotFourSaturdayAndSundayAreNotDeducted() {
    List<Integer> weekdays = isoDays("2026-11-13", "2026-11-16").stream().map(d -> LocalDate.parse(d).getDayOfWeek().getValue() % 7).toList();
    assertEquals(List.of(5, 6, 0, 1), weekdays); // Fri, Sat, Sun, Mon
    assertEquals(2, leaveDays(request("2026-11-13", "2026-11-16")));
    assertEquals(List.of(10, 10), countedMonths("2026-11-13", "2026-11-16", 2026));
  }

  @Test
  void aRequestThatIsOnlyAWeekendCountsForZeroDaysAndAFullWeekCountsFive() {
    assertEquals(0, leaveDays(request("2026-11-14", "2026-11-15")));
    assertEquals(5, leaveDays(request("2026-11-09", "2026-11-15")));
  }

  @Test
  void aNationalHolidayInsideARangeDoesNotCount() {
    assertEquals(3, leaveDays(request("2026-09-29", "2026-10-02"))); // 4 weekdays, 2 Oct is Gandhi Jayanti
    assertEquals(3, countedMonths("2026-09-29", "2026-10-02", 2026).size());
  }

  @Test
  void aHolidayOnAWeekendIsNotDoubleRemoved() {
    assertEquals(2, leaveDays(request("2026-08-14", "2026-08-17"))); // 15 Aug 2026 is a Saturday: Fri and Mon count
  }

  @Test
  void aRequestThatIsOnlyTheHolidayCountsForZeroDays() {
    assertEquals(0, countedMonths("2026-10-02", "2026-10-02", 2026).size());
  }

  @Test
  void holidaysRepeatEveryYear() {
    assertEquals(2, countedMonths("2027-01-25", "2027-01-27", 2027).size());
  }

  @Test
  void eachOfTheFourNationalHolidaysIsExcluded() {
    for (String date : List.of("2026-01-26", "2026-05-01", "2026-08-15", "2026-10-02")) {
      assertEquals(0, countedMonths(date, date, 2026).size(), date + " should not count");
    }
  }

  @Test
  void aSingleDayRequestCountsAsOneDay() {
    assertEquals(1, leaveDays(request("2026-11-13", "2026-11-13")));
    assertEquals(List.of("2026-11-13"), isoDays("2026-11-13", "2026-11-13"));
    assertEquals(List.of(10), countedMonths("2026-11-13", "2026-11-13", 2026));
  }

  @Test
  void aNewEmployeeWhoJoinedOn29FebHasTheirAnniversaryOn28FebInANonLeapYear() {
    assertEquals(LocalDate.parse("2026-02-28"), Dates.anniversaryIn("2024-02-29", 2026));
    assertEquals(LocalDate.parse("2028-02-29"), Dates.anniversaryIn("2024-02-29", 2028));
  }

  @Test
  void theWeekRunsMondayToSunday() {
    assertEquals(LocalDate.parse("2026-11-02"), Dates.startOfWeek(LocalDate.parse("2026-11-08"))); // a Sunday
    assertEquals(LocalDate.parse("2026-11-08"), Dates.endOfWeek(LocalDate.parse("2026-11-02")));
  }
}
