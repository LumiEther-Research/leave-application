package app.lumiether.domain;

import app.lumiether.domain.Leave.Request;
import app.lumiether.domain.Types.Employee;
import app.lumiether.domain.Types.Holiday;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/** Validation for what an employee submits: a leave request, a comp-off claim or a permission (port of requests.ts). Pure. */
public final class Requests {
  private Requests() {}

  public static final List<String> LEAVE_TYPES = List.of("Casual leave", "Sick leave");
  public static final int MAX_LEAVE_RANGE_DAYS = 90;
  public static final int MAX_PERMISSION_MINUTES = 8 * 60;
  public static final int MAX_REASON_LENGTH = 200;

  /** {@code dayLength} is "full" or "half". A half day is a single working day, so {@code to} is ignored. */
  public record LeaveInput(String type, String from, String to, String dayLength) {}

  public record LeaveValue(String type, String from, String to, boolean halfDay) {}

  public record CompOffInput(String workedOn, String dayLength) {}

  public record CompOffValue(String workedOn, boolean halfDay) {}

  public record PermissionInput(String date, String from, String to, String reason) {}

  public record PermissionValue(String date, String from, String to, int minutes, String reason) {}

  /** A saved permission. Never deducted from leave. */
  public record Permission(String id, String employeeId, String date, String from, String to, int minutes, String reason) {}

  /** Not rejected and not cancelled, so it still holds its dates. */
  private static boolean isLive(Request r) {
    return !r.status().equals("rejected") && !r.status().equals("cancelled");
  }

  /** Both leave and comp-off requests start at the beginning of this year at the earliest. */
  private static String startOfYear(LocalDate today) {
    return today.getYear() + "-01-01";
  }

  public static Validated<LeaveValue> validateLeaveInput(LeaveInput input, LocalDate today, List<Holiday> holidays, List<Request> mine) {
    Map<String, String> errors = new LinkedHashMap<>();
    boolean halfDay = input.dayLength().equals("half");
    String from = input.from();
    String to = halfDay ? from : input.to();
    String type = LEAVE_TYPES.contains(input.type()) ? input.type() : null;

    if (!input.dayLength().equals("full") && !halfDay) errors.put("dayLength", "Choose a full or half day.");
    if (type == null) errors.put("type", "Choose casual or sick leave.");
    if (!Dates.isRealDate(from)) errors.put("from", "Pick a start date.");
    if (!Dates.isRealDate(to)) errors.put("to", "Pick an end date.");

    if (!errors.containsKey("from") && !errors.containsKey("to")) {
      String lastDay = (today.getYear() + 1) + "-12-31";
      if (from.compareTo(startOfYear(today)) < 0) errors.put("from", "Leave can't start before this year.");
      else if (to.compareTo(from) < 0) errors.put("to", "The end date can't be before the start date.");
      else if (to.compareTo(lastDay) > 0) errors.put("to", "Leave can't end after next year.");
      else if (Dates.parse(to).isAfter(Dates.parse(from).plusDays(MAX_LEAVE_RANGE_DAYS - 1)))
        errors.put("to", "A request can cover at most " + MAX_LEAVE_RANGE_DAYS + " days.");
    }

    if (!errors.containsKey("from") && !errors.containsKey("to") && type != null) {
      Request probe = new Request("probe", "", type, "pending", from, to, "").withHalfDay(halfDay);
      if (Leave.leaveDays(probe, holidays) == 0) {
        errors.put("form", halfDay
            ? "That day is a weekend or a national holiday, so there's nothing to take off."
            : "Those dates are all weekends or national holidays, so there's nothing to take off.");
      } else if (mine.stream().anyMatch(r -> !r.type().equals("Comp-off") && isLive(r) && r.from().compareTo(to) <= 0 && r.to().compareTo(from) >= 0)) {
        errors.put("form", "You already have leave that overlaps these dates.");
      }
    }

    if (!errors.isEmpty() || type == null) return Validated.invalid(errors);
    return Validated.valid(new LeaveValue(type, from, to, halfDay));
  }

  public static Validated<CompOffValue> validateCompOffInput(CompOffInput input, LocalDate today, List<Holiday> holidays, List<Request> mine, Employee employee) {
    Map<String, String> errors = new LinkedHashMap<>();
    String workedOn = input.workedOn();
    boolean halfDay = input.dayLength().equals("half");

    if (!input.dayLength().equals("full") && !input.dayLength().equals("half")) errors.put("dayLength", "Choose a full or half day.");

    if (!Dates.isRealDate(workedOn)) errors.put("workedOn", "Pick the day you worked.");
    else if (workedOn.compareTo(today.toString()) > 0) errors.put("workedOn", "That day hasn't happened yet.");
    else if (workedOn.compareTo(startOfYear(today)) < 0) errors.put("workedOn", "Comp-off can't be claimed for days before this year.");
    else if (workedOn.compareTo(employee.joiningDate()) < 0) errors.put("workedOn", "That's before your joining date.");
    else if (Leave.compOffDaysFor(workedOn, halfDay, holidays) == 0)
      errors.put("workedOn", "That was a working day, so it doesn't earn comp-off. Pick a weekend or a national holiday.");
    else if (mine.stream().anyMatch(r -> r.type().equals("Comp-off") && isLive(r) && r.from().equals(workedOn)))
      errors.put("workedOn", "You've already claimed comp-off for that day.");

    return errors.isEmpty() ? Validated.valid(new CompOffValue(workedOn, halfDay)) : Validated.invalid(errors);
  }

  /** {@code action} is "withdraw" or "request" when ok. */
  public record CancelPlan(boolean ok, String action, String error) {}

  /**
   * What cancelling a leave request does, if it can be done at all: pending leave is withdrawn straight away (nothing
   * was granted yet), and approved leave that hasn't started goes to an admin as a cancellation request.
   */
  public static CancelPlan planCancellation(Request r, LocalDate today) {
    if (r.type().equals("Comp-off")) return new CancelPlan(false, null, "Comp-off requests can't be cancelled here.");
    if (r.status().equals("pending")) return new CancelPlan(true, "withdraw", null);
    if (!r.status().equals("approved")) return new CancelPlan(false, null, "That request is already closed.");
    if (r.cancelRequested()) return new CancelPlan(false, null, "You've already asked to cancel this leave.");
    if (r.from().compareTo(today.toString()) < 0) return new CancelPlan(false, null, "This leave has already started, so it can't be cancelled.");
    return new CancelPlan(true, "request", null);
  }

  private static final Pattern TIME = Pattern.compile("^([01]\\d|2[0-3]):[0-5]\\d$");

  private static int toMinutes(String hhmm) {
    return Integer.parseInt(hhmm.substring(0, 2)) * 60 + Integer.parseInt(hhmm.substring(3, 5));
  }

  /** "1 hr", "30 min", "1 hr 30 min". */
  public static String formatMinutes(int minutes) {
    int h = minutes / 60;
    int m = minutes % 60;
    String out = (h > 0 ? h + " hr" : "") + (h > 0 && m > 0 ? " " : "") + (m > 0 ? m + " min" : "");
    return out.isEmpty() ? "0 min" : out;
  }

  /**
   * A permission is a few hours off on one working day. It's noted for the admin and never deducted from leave. It
   * can't overlap another permission of yours, or a day of leave you already have.
   */
  public static Validated<PermissionValue> validatePermissionInput(PermissionInput input, LocalDate today, List<Holiday> holidays,
      List<Request> leave, List<Permission> permissions) {
    Map<String, String> errors = new LinkedHashMap<>();
    String date = input.date();
    String from = input.from();
    String to = input.to();
    String reason = input.reason().strip();

    if (!Dates.isRealDate(date)) errors.put("date", "Pick the day.");
    else if (date.compareTo(startOfYear(today)) < 0) errors.put("date", "That day is before this year.");
    else if (date.compareTo((today.getYear() + 1) + "-12-31") > 0) errors.put("date", "That day is too far ahead.");
    else if (Dates.isWeekend(Dates.parse(date))
        || holidays.stream().anyMatch(h -> h.month() == Integer.parseInt(date.substring(5, 7)) && h.day() == Integer.parseInt(date.substring(8, 10)))) {
      errors.put("date", "That's a weekend or a national holiday, so no permission is needed.");
    }

    if (!TIME.matcher(from).matches()) errors.put("from", "Pick a start time.");
    if (!TIME.matcher(to).matches()) errors.put("to", "Pick an end time.");
    int minutes = 0;
    if (!errors.containsKey("from") && !errors.containsKey("to")) {
      minutes = toMinutes(to) - toMinutes(from);
      if (minutes <= 0) errors.put("to", "The end time has to be after the start time.");
      else if (minutes > MAX_PERMISSION_MINUTES) errors.put("to", "A permission can be at most 8 hours. Request leave for a full day.");
    }
    if (reason.length() > MAX_REASON_LENGTH) errors.put("reason", "Keep it under " + MAX_REASON_LENGTH + " characters.");

    if (!errors.containsKey("date") && !errors.containsKey("from") && !errors.containsKey("to")) {
      if (permissions.stream().anyMatch(p -> p.date().equals(date) && p.from().compareTo(to) < 0 && p.to().compareTo(from) > 0)) {
        errors.put("form", "You already have a permission that overlaps this time.");
      } else if (leave.stream().anyMatch(r -> !r.type().equals("Comp-off") && (r.status().equals("pending") || r.status().equals("approved"))
          && r.from().compareTo(date) <= 0 && r.to().compareTo(date) >= 0)) {
        errors.put("form", "You already have leave on that day.");
      }
    }

    return errors.isEmpty() ? Validated.valid(new PermissionValue(date, from, to, minutes, reason)) : Validated.invalid(errors);
  }
}
