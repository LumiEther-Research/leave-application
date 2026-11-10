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

  /** Indian grouping with two decimals: ₹16,500.00 and ₹1,00,000.00. */
  public static String formatInr(long paise) {
    String rupees = String.valueOf(paise / 100);
    String head = rupees.length() > 3 ? rupees.substring(0, rupees.length() - 3) : "";
    String grouped = (head.isEmpty() ? "" : head.replaceAll("\\B(?=(\\d{2})+$)", ",") + ",") + rupees.substring(rupees.length() - Math.min(3, rupees.length()));
    return "₹" + grouped + "." + String.format("%02d", paise % 100);
  }

  /** The outcome of {@link #calculatePay}: net is basic minus deduction, or a message per bad field. */
  public record Pay(boolean ok, long basic, long deduction, long net, java.util.Map<String, String> errors) {}

  /** Net = basic minus deduction. The deduction must be between 0 and the basic. An empty deduction means none. */
  public static Pay calculatePay(String basicText, String deductionText) {
    java.util.Map<String, String> errors = new java.util.LinkedHashMap<>();
    Long basic = parseAmount(basicText);
    Long deduction = deductionText.strip().isEmpty() ? Long.valueOf(0) : parseAmount(deductionText);

    if (basicText.strip().startsWith("-")) errors.put("basic", "Basic can't be negative.");
    else if (basic == null) errors.put("basic", "Enter the basic as an amount, like 16500 or 16500.50.");
    else if (basic <= 0) errors.put("basic", "Basic must be more than zero.");
    else if (basic > MAX_PAISE) errors.put("basic", "That basic is too large.");

    if (deductionText.strip().startsWith("-")) errors.put("deduction", "Deduction can't be negative.");
    else if (deduction == null) errors.put("deduction", "Enter the deduction as an amount, like 1500 or 1500.50.");
    else if (basic != null && !errors.containsKey("basic") && deduction > basic)
      errors.put("deduction", "Deduction can't be more than the basic of " + formatInr(basic) + ".");

    if (!errors.isEmpty() || basic == null || deduction == null) return new Pay(false, 0, 0, 0, errors);
    return new Pay(true, basic, deduction, basic - deduction, java.util.Map.of());
  }

  private static final String[] ONES = {"", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
      "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"};
  private static final String[] TENS = {"", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"};

  /** 1 to 999 in words. */
  private static String underThousand(long n) {
    java.util.List<String> parts = new java.util.ArrayList<>();
    if (n >= 100) parts.add(ONES[(int) (n / 100)] + " Hundred");
    long rest = n % 100;
    if (rest > 0) parts.add(rest < 20 ? ONES[(int) rest] : TENS[(int) (rest / 10)] + (rest % 10 != 0 ? "-" + ONES[(int) (rest % 10)] : ""));
    return String.join(" ", parts);
  }

  /** Whole rupees in the Indian system: Crore, Lakh, Thousand. Zero is "Zero". */
  private static String rupeesInWords(long n) {
    if (n == 0) return "Zero";
    long[] counts = {n / 10_000_000, (n / 100_000) % 100, (n / 1000) % 100, n % 1000};
    String[] units = {"Crore", "Lakh", "Thousand", ""};
    java.util.List<String> out = new java.util.ArrayList<>();
    for (int i = 0; i < 4; i++) {
      if (counts[i] > 0) out.add(units[i].isEmpty() ? underThousand(counts[i]) : underThousand(counts[i]) + " " + units[i]);
    }
    return String.join(", ", out);
  }

  /** "INR Sixteen Thousand, Five Hundred only." Paise, if any, follow: "... and Fifty Paise only." */
  public static String amountInWords(long paise) {
    long rupees = paise / 100;
    long rest = paise % 100;
    return "INR " + rupeesInWords(rupees) + (rest != 0 ? " and " + underThousand(rest) + " Paise" : "") + " only.";
  }
}
