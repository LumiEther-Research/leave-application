package app.lumiether.domain;

import app.lumiether.domain.Types.Employee;
import app.lumiether.domain.Types.Holiday;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The leave policy, as pure functions (port of leave.ts): one balance per employee (the category's yearly days plus
 * approved comp-off) less leave taken; weekends and the national holidays are never deducted; sick leave counts like
 * casual; comp-off expires on the first joining anniversary after the day it was earned and is spent soonest-expiring
 * first; a request that would take the balance below zero is blocked.
 */
public final class Leave {
  private Leave() {}

  /** Year that the past-leave summary covers (see {@link #getLeaveEntries}). */
  public static final int PAST_LEAVE_YEAR = 2026;

  /**
   * A leave request, or a comp-off claim as a "Comp-off" request on the day worked. Dates are ISO strings.
   * {@code halfDay}: comp-off worked half a day (earns 0.5), or leave of half a day, single day only.
   */
  public record Request(
      String id, String employeeId, String type, String status, String from, String to, String appliedOn,
      boolean halfDay, boolean cancelRequested, String cancelRequestedOn) {
    public Request(String id, String employeeId, String type, String status, String from, String to, String appliedOn) {
      this(id, employeeId, type, status, from, to, appliedOn, false, false, null);
    }

    public Request withStatus(String newStatus) {
      return new Request(id, employeeId, type, newStatus, from, to, appliedOn, halfDay, cancelRequested, cancelRequestedOn);
    }

    public Request withCancelRequested() {
      return new Request(id, employeeId, type, status, from, to, appliedOn, halfDay, true, null);
    }

    public Request withHalfDay(boolean half) {
      return new Request(id, employeeId, type, status, from, to, appliedOn, half, cancelRequested, cancelRequestedOn);
    }
  }

  /** Days taken per month before the app tracked requests (index 0 = Jan), by kind. */
  public record PastLeave(double[] casual, double[] sick) {}

  /** One working day of a request. {@code weight} is 1, or 0.5 for a half-day leave request. */
  public record Day(int month, String date, double weight) {}

  public static boolean drawsOnBalance(Request r) {
    return !r.type().equals("Comp-off");
  }

  private static boolean isHoliday(LocalDate day, List<Holiday> holidays) {
    return holidays.stream().anyMatch(h -> h.month() == day.getMonthValue() && h.day() == day.getDayOfMonth());
  }

  /** Working days in a request (optionally only those in {@code year}): weekends and national holidays are skipped. */
  static List<Day> requestDays(Request r, List<Holiday> holidays, Integer year) {
    double weight = r.halfDay() && drawsOnBalance(r) ? 0.5 : 1;
    List<Day> days = new ArrayList<>();
    for (LocalDate d = Dates.parse(r.from()); !d.isAfter(Dates.parse(r.to())); d = d.plusDays(1)) {
      if ((year == null || d.getYear() == year) && !Dates.isWeekend(d) && !isHoliday(d, holidays)) {
        days.add(new Day(d.getMonthValue() - 1, d.toString(), weight));
      }
    }
    return days;
  }

  private static double sum(List<Double> nums) {
    double total = 0;
    for (double n : nums) total += n;
    return total;
  }

  /** Working days in a request (0.5 for a half day): weekends and national holidays are not counted. */
  public static double leaveDays(Request r, List<Holiday> holidays) {
    return sum(requestDays(r, holidays, null).stream().map(Day::weight).toList());
  }

  /** Days a leave request takes from the balance in {@code year}. Comp-off requests take none. */
  public static List<Day> balanceDays(Request r, List<Holiday> holidays, int year) {
    return drawsOnBalance(r) ? requestDays(r, holidays, year) : List.of();
  }

  public static List<Request> getPending(List<Request> requests) {
    return requests.stream().filter(r -> r.status().equals("pending")).toList();
  }

  /** Approved leave the employee has asked to cancel. */
  public static boolean isCancelRequest(Request r) {
    return r.status().equals("approved") && r.cancelRequested();
  }

  /** Everything waiting on an admin: pending requests and cancellation requests. */
  public static List<Request> getAwaitingDecision(List<Request> requests) {
    return requests.stream().filter(r -> r.status().equals("pending") || isCancelRequest(r)).toList();
  }

  public static List<Request> getOutOn(List<Request> requests, LocalDate day) {
    return requests.stream()
        .filter(r -> drawsOnBalance(r) && r.status().equals("approved")
            && !day.isBefore(Dates.parse(r.from())) && !day.isAfter(Dates.parse(r.to())))
        .toList();
  }

  /** Approved leave overlapping the Monday to Sunday week of {@code today}, earliest first. */
  public static List<Request> getOutThisWeek(List<Request> requests, LocalDate today) {
    LocalDate weekStart = Dates.startOfWeek(today);
    LocalDate weekEnd = Dates.endOfWeek(today);
    return requests.stream()
        .filter(r -> drawsOnBalance(r) && r.status().equals("approved")
            && !Dates.parse(r.from()).isAfter(weekEnd) && !Dates.parse(r.to()).isBefore(weekStart))
        .sorted(Comparator.comparing(Request::from))
        .toList();
  }

  // ------------------------------------------------------------------ comp-off

  /** One comp-off claim, with the date it stops being usable. {@code days}: 1, 0.5 for a half day, or 0. */
  public record CompOffLot(String id, String employeeId, String workedOn, double days, String expiresOn, String status) {}

  /** Days earned for working {@code workedOn}: 1 (0.5 for a half day) on a weekend or national holiday, else 0. */
  public static double compOffDaysFor(String workedOn, boolean halfDay, List<Holiday> holidays) {
    LocalDate day = Dates.parse(workedOn);
    if (!Dates.isWeekend(day) && !isHoliday(day, holidays)) return 0;
    return halfDay ? 0.5 : 1;
  }

  /** Comp-off expires on the first joining anniversary after the day it was earned. */
  public static String compOffExpiry(String joiningDate, String workedOn) {
    LocalDate worked = Dates.parse(workedOn);
    LocalDate thisYear = Dates.anniversaryIn(joiningDate, worked.getYear());
    return (thisYear.isAfter(worked) ? thisYear : Dates.anniversaryIn(joiningDate, worked.getYear() + 1)).toString();
  }

  /** Every comp-off claim, whatever its status. Only {@code approved} ones count toward a balance. */
  public static List<CompOffLot> getCompOffLots(List<Request> requests, List<Employee> employees, List<Holiday> holidays) {
    List<CompOffLot> lots = new ArrayList<>();
    for (Request r : requests) {
      Employee employee = employees.stream().filter(e -> e.id().equals(r.employeeId())).findFirst().orElse(null);
      if (!r.type().equals("Comp-off") || employee == null) continue;
      lots.add(new CompOffLot(r.id(), r.employeeId(), r.from(), compOffDaysFor(r.from(), r.halfDay(), holidays),
          compOffExpiry(employee.joiningDate(), r.from()), r.status()));
    }
    return lots;
  }

  /**
   * {@code granted}: added to the total (unexpired lots in full, expired lots only for what was used before they
   * expired). {@code available}: still usable and not yet taken. {@code expired}: earned, then expired unused.
   */
  public record CompOffSummary(double granted, double available, double expired) {}

  /** Leave taken on one date: 1 for a full day, 0.5 for a half day. */
  public record LeaveDay(String date, double days) {}

  /**
   * Spends {@code taken} (oldest first) on approved comp-off, soonest-expiring lot first. A lot can only cover days
   * from the day it was earned up to the day before it expires. Whatever a lot can't cover falls to the regular days.
   */
  public static CompOffSummary summariseCompOff(List<CompOffLot> lots, List<LeaveDay> taken, String todayIso) {
    Map<String, Double> left = new LinkedHashMap<>();
    List<CompOffLot> byExpiry = new ArrayList<>();
    for (CompOffLot l : lots) {
      if (!l.status().equals("approved")) continue;
      left.put(l.id(), l.days());
      byExpiry.add(l);
    }
    byExpiry.sort(Comparator.comparing(CompOffLot::expiresOn).thenComparing(CompOffLot::workedOn));

    for (LeaveDay d : taken.stream().sorted(Comparator.comparing(LeaveDay::date)).toList()) {
      double need = d.days();
      for (CompOffLot lot : byExpiry) {
        if (need == 0) break;
        if (lot.workedOn().compareTo(d.date()) > 0 || lot.expiresOn().compareTo(d.date()) <= 0) continue;
        double take = Math.min(need, left.get(lot.id()));
        left.put(lot.id(), left.get(lot.id()) - take);
        need -= take;
      }
    }

    double granted = 0, available = 0, expired = 0;
    for (CompOffLot lot : byExpiry) {
      double unused = left.get(lot.id());
      if (lot.expiresOn().compareTo(todayIso) <= 0) {
        granted += lot.days() - unused;
        expired += unused;
      } else {
        granted += lot.days();
        available += unused;
      }
    }
    return new CompOffSummary(granted, available, expired);
  }

  // ------------------------------------------------------------------- balances

  /** Leave days of one kind ("casual" or "sick"), in one month, for one employee. Status is "approved" or "pending". */
  public record LeaveEntry(String employeeId, String kind, int month, String status, double days) {}

  /**
   * Every leave day that counts against the quota in {@code year}: days already taken in past months, plus approved
   * and pending requests (minus weekends and national holidays). The chart and the balance table both aggregate this
   * one list, so their totals match by construction.
   */
  public static List<LeaveEntry> getLeaveEntries(List<Request> requests, Map<String, PastLeave> past, List<Holiday> holidays, int year) {
    List<LeaveEntry> entries = new ArrayList<>();
    if (year == PAST_LEAVE_YEAR) {
      for (var e : past.entrySet()) {
        for (String kind : List.of("casual", "sick")) {
          double[] byMonth = kind.equals("casual") ? e.getValue().casual() : e.getValue().sick();
          for (int month = 0; month < byMonth.length; month++) {
            if (byMonth[month] > 0) entries.add(new LeaveEntry(e.getKey(), kind, month, "approved", byMonth[month]));
          }
        }
      }
    }
    for (Request r : requests) {
      if (r.status().equals("rejected") || r.status().equals("cancelled")) continue;
      Map<Integer, Double> byMonth = new LinkedHashMap<>();
      for (Day d : balanceDays(r, holidays, year)) byMonth.merge(d.month(), d.weight(), Double::sum);
      for (var m : byMonth.entrySet()) {
        entries.add(new LeaveEntry(r.employeeId(), r.type().equals("Sick leave") ? "sick" : "casual", m.getKey(), r.status(), m.getValue()));
      }
    }
    return entries;
  }

  /**
   * {@code total}: the category's days plus the comp-off added. {@code used}: casual + sick, comp-off days included.
   * {@code remaining}: days left in the one balance. {@code compOffAvailable}: the part of it that is comp-off, spent
   * before the regular days. {@code compOffExpired}: comp-off that expired unused.
   */
  public record LeaveBalance(Employee employee, double total, double casual, double sick, double used, double remaining,
      double compOffAvailable, double compOffExpired) {}

  /**
   * One balance per employee: the yearly allowance plus approved comp-off, less leave taken. {@code counted} says
   * which request statuses use up days: just approved for the dashboard, approved and pending when checking a new request.
   */
  public static List<LeaveBalance> getLeaveBalances(List<Employee> employees, List<LeaveEntry> entries, List<Request> requests,
      List<Holiday> holidays, int year, LocalDate today, List<String> counted) {
    List<CompOffLot> lots = getCompOffLots(requests, employees, holidays);
    List<LeaveBalance> out = new ArrayList<>();
    for (Employee employee : employees) {
      List<LeaveEntry> mine = entries.stream().filter(e -> e.employeeId().equals(employee.id()) && counted.contains(e.status())).toList();
      double casual = sum(mine.stream().filter(e -> e.kind().equals("casual")).map(LeaveEntry::days).toList());
      double sick = sum(mine.stream().filter(e -> e.kind().equals("sick")).map(LeaveEntry::days).toList());
      double used = casual + sick;

      List<LeaveDay> taken = new ArrayList<>();
      for (Request r : requests) {
        if (r.employeeId().equals(employee.id()) && drawsOnBalance(r) && counted.contains(r.status())) {
          for (Day d : balanceDays(r, holidays, year)) taken.add(new LeaveDay(d.date(), d.weight()));
        }
      }
      CompOffSummary compOff = summariseCompOff(lots.stream().filter(l -> l.employeeId().equals(employee.id())).toList(), taken, today.toString());
      double total = employee.leaveAllowance() + compOff.granted();
      out.add(new LeaveBalance(employee, total, casual, sick, used, total - used, compOff.available(), compOff.expired()));
    }
    return out;
  }

  public static List<LeaveBalance> getLeaveBalances(List<Employee> employees, List<LeaveEntry> entries, List<Request> requests,
      List<Holiday> holidays, int year, LocalDate today) {
    return getLeaveBalances(employees, entries, requests, holidays, year, today, List.of("approved"));
  }

  /** {@code shortfall} is for the server's own use. The message never says by how much, because employees never see their days. */
  public record LeaveCheck(boolean ok, double shortfall, String message) {
    static final LeaveCheck OK = new LeaveCheck(true, 0, null);
  }

  /**
   * Whether {@code candidate} can be requested. Blocked if, with it added to the approved and pending leave already on
   * the books, the balance would go below zero in any year it touches. Comp-off claims add days, so never block.
   */
  public static LeaveCheck checkLeaveRequest(Request candidate, List<Employee> employees, List<Request> requests,
      Map<String, PastLeave> past, List<Holiday> holidays, LocalDate today) {
    Employee employee = employees.stream().filter(e -> e.id().equals(candidate.employeeId())).findFirst().orElse(null);
    if (employee == null) return new LeaveCheck(false, 0, "Unknown employee.");
    if (!drawsOnBalance(candidate)) return LeaveCheck.OK;

    List<Request> all = new ArrayList<>(requests);
    all.add(candidate.withStatus("pending"));
    for (int year = Dates.parse(candidate.from()).getYear(); year <= Dates.parse(candidate.to()).getYear(); year++) {
      List<LeaveEntry> entries = getLeaveEntries(all, past, holidays, year);
      LeaveBalance balance = getLeaveBalances(List.of(employee), entries, all, holidays, year, today, List.of("approved", "pending")).get(0);
      if (balance.remaining() < 0) {
        return new LeaveCheck(false, -balance.remaining(), "You don't have enough leave left for these dates. Ask your admin if you need more.");
      }
    }
    return LeaveCheck.OK;
  }

  /** Days of leave an employee has asked for in {@code year}: approved and pending. This is what they see instead of their allowance. */
  public record Applied(double approved, double pending, double total) {}

  public static Applied appliedLeaveDays(List<Request> requests, List<Holiday> holidays, int year) {
    double approved = 0, pending = 0;
    for (Request r : requests) {
      if (!drawsOnBalance(r) || (!r.status().equals("approved") && !r.status().equals("pending"))) continue;
      double days = sum(balanceDays(r, holidays, year).stream().map(Day::weight).toList());
      if (r.status().equals("approved")) approved += days;
      else pending += days;
    }
    return new Applied(approved, pending, approved + pending);
  }

  public record MonthlyLeave(String month, double approved, double pending) {}

  public static List<MonthlyLeave> getMonthlyLeave(List<LeaveEntry> entries) {
    String[] names = {"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};
    double[] approved = new double[12], pending = new double[12];
    for (LeaveEntry e : entries) (e.status().equals("approved") ? approved : pending)[e.month()] += e.days();
    List<MonthlyLeave> rows = new ArrayList<>();
    for (int i = 0; i < 12; i++) rows.add(new MonthlyLeave(names[i], approved[i], pending[i]));
    return rows;
  }
}
