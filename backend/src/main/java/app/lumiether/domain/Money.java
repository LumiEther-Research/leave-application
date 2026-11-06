package app.lumiether.domain;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Money for payslips and salaries, in paise (whole numbers) so rounding never creeps in. */
public final class Money {
  private Money() {}

  /** numeric(12,2) holds up to 9,999,999,999.99 */
  public static final long MAX_PAISE = 999_999_999_999L;

  private static final Pattern AMOUNT = Pattern.compile("^(\\d{1,10})(?:\\.(\\d{1,2}))?$");

  /** Parses "16500", "16,500.5" or "16500.50" into paise. Null if it isn't a plain non-negative amount. */
  public static Long parseAmount(String input) {
    Matcher m = AMOUNT.matcher(input.strip().replace(",", ""));
    if (!m.matches()) return null;
    String frac = m.group(2) == null ? "" : m.group(2);
    String padded = frac.length() == 1 ? frac + "0" : frac;
    return Long.parseLong(m.group(1)) * 100 + (padded.isEmpty() ? 0 : Long.parseLong(padded));
  }

  /** Paise as the plain "16500.50" a number input or a numeric column uses. */
  public static String toPlain(long paise) {
    return (paise / 100) + "." + String.format("%02d", paise % 100);
  }
}
