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
}
