package app.lumiether.domain;

import java.time.DateTimeException;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.regex.Pattern;

/** Calendar helpers. The team's calendar day is IST regardless of where the server runs. */
public final class Dates {
  private Dates() {}

  public static final ZoneId APP_TIME_ZONE = ZoneId.of("Asia/Kolkata");
  private static final Pattern ISO = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}$");

  /** Today's calendar date in the app time zone. */
  public static LocalDate today() {
    return LocalDate.now(APP_TIME_ZONE);
  }

  /**
   * A real calendar date written yyyy-MM-dd. 2026-02-30 is not real. Years below 100 are refused, because
   * JavaScript's Date turns them into 19xx and the Node app therefore refuses them too.
   */
  public static boolean isRealDate(String iso) {
    if (iso == null || !ISO.matcher(iso).matches()) return false;
    try {
      LocalDate d = LocalDate.parse(iso);
      return d.getYear() >= 100 && d.toString().equals(iso);
    } catch (DateTimeException e) {
      return false;
    }
  }

  public static LocalDate parse(String iso) {
    return LocalDate.parse(iso);
  }

  /** Saturday or Sunday: the non-working days of the 5-day week. */
  public static boolean isWeekend(LocalDate d) {
    return d.getDayOfWeek() == java.time.DayOfWeek.SATURDAY || d.getDayOfWeek() == java.time.DayOfWeek.SUNDAY;
  }

  /** The {@code year} anniversary of {@code joiningIso} (a 29 Feb joining date falls on 28 Feb in non-leap years). */
  public static LocalDate anniversaryIn(String joiningIso, int year) {
    LocalDate j = parse(joiningIso);
    return LocalDate.of(year, j.getMonthValue(), Math.min(j.getDayOfMonth(), java.time.YearMonth.of(year, j.getMonthValue()).lengthOfMonth()));
  }

  /** Monday of the week containing {@code d}. */
  public static LocalDate startOfWeek(LocalDate d) {
    return d.minusDays(d.getDayOfWeek().getValue() - 1);
  }

  /** Sunday of the week containing {@code d}. */
  public static LocalDate endOfWeek(LocalDate d) {
    return startOfWeek(d).plusDays(6);
  }

  /** "6 Nov", "6–8 Nov" or "30 Oct – 2 Nov". */
  public static String formatRange(String fromIso, String toIso) {
    LocalDate from = parse(fromIso);
    LocalDate to = parse(toIso);
    java.util.function.Function<LocalDate, String> dm = d -> d.getDayOfMonth() + " " + MONTHS[d.getMonthValue() - 1];
    if (from.equals(to)) return dm.apply(from);
    if (from.getYear() == to.getYear() && from.getMonth() == to.getMonth()) return from.getDayOfMonth() + "–" + dm.apply(to);
    return dm.apply(from) + " – " + dm.apply(to);
  }

  private static final String[] MONTHS = {"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};
}
