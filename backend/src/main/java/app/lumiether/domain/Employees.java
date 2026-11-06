package app.lumiether.domain;

import app.lumiether.domain.Types.*;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/** Validation for new employees, new admins and payroll details. Pure. */
public final class Employees {
  private Employees() {}

  /** Employees sign in with a Gmail address. */
  private static final Pattern GMAIL = Pattern.compile("^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?@gmail\\.com$");
  private static final Pattern EMAIL = Pattern.compile("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", Pattern.UNICODE_CHARACTER_CLASS);

  public static final int MIN_PASSWORD_LENGTH = 8;
  public static final int MAX_PASSWORD_LENGTH = 128;
  public static final int MAX_DESIGNATION_LENGTH = 100;
  private static final String EARLIEST_JOINING_DATE = "2000-01-01";

  public record PayrollInput(String monthlySalary, String designation) {
    public PayrollInput {
      monthlySalary = monthlySalary == null ? "" : monthlySalary;
      designation = designation == null ? "" : designation;
    }
  }

  public record PayrollValue(String monthlySalary, String designation) {}

  /** Salary and designation are both optional. A salary, if given, is a positive amount with at most two decimals. */
  public static Validated<PayrollValue> validatePayroll(PayrollInput input) {
    Map<String, String> errors = new LinkedHashMap<>();
    String salaryText = input.monthlySalary().strip();
    String designation = input.designation().strip();
    String monthlySalary = null;

    if (!salaryText.isEmpty()) {
      Long paise = Money.parseAmount(salaryText);
      if (paise == null || paise <= 0 || paise > Money.MAX_PAISE) {
        errors.put("monthlySalary", "Enter a positive amount with at most two decimals, like 16500 or 16500.50.");
      } else {
        monthlySalary = Money.toPlain(paise);
      }
    }
    if (designation.length() > MAX_DESIGNATION_LENGTH) {
      errors.put("designation", "Use at most " + MAX_DESIGNATION_LENGTH + " characters.");
    }
    if (!errors.isEmpty()) return Validated.invalid(errors);
    return Validated.valid(new PayrollValue(monthlySalary, designation.isEmpty() ? null : designation));
  }

  public record NewEmployeeInput(
      String email, String joiningDate, String password, String category, String monthlySalary, String designation) {
    public static NewEmployeeInput of(String email, String joiningDate, String password, String category) {
      return new NewEmployeeInput(email, joiningDate, password, category, "", "");
    }
  }

  public record NewEmployeeValue(
      String email, String joiningDate, String password, String category, String monthlySalary, String designation) {}

  /** "priya.sharma@gmail.com" becomes "Priya Sharma". The form has no name field. */
  public static String nameFromEmail(String email) {
    String local = email.substring(0, email.indexOf('@') < 0 ? email.length() : email.indexOf('@'));
    List<String> words = new ArrayList<>();
    for (String w : local.replaceAll("\\d+", " ").split("[._+-]+|\\s+")) if (!w.isEmpty()) words.add(w);
    if (words.isEmpty()) return email;
    List<String> out = new ArrayList<>();
    for (String w : words) {
      int first = w.codePointAt(0);
      out.add(new String(Character.toChars(first)).toUpperCase(Locale.ROOT) + w.substring(Character.charCount(first)));
    }
    return String.join(" ", out);
  }

  private static void checkPassword(String password, Map<String, String> errors) {
    if (password.length() < MIN_PASSWORD_LENGTH) errors.put("password", "Use at least " + MIN_PASSWORD_LENGTH + " characters.");
    else if (password.length() > MAX_PASSWORD_LENGTH) errors.put("password", "Use at most " + MAX_PASSWORD_LENGTH + " characters.");
  }

  private static boolean taken(String email, List<String> emails) {
    return emails.stream().anyMatch(e -> e.toLowerCase(Locale.ROOT).equals(email));
  }

  public static Validated<NewEmployeeValue> validateNewEmployee(NewEmployeeInput input, List<String> takenEmails) {
    Map<String, String> errors = new LinkedHashMap<>();
    String email = input.email().strip().toLowerCase(Locale.ROOT);
    String category = Types.CATEGORIES.contains(input.category()) ? input.category() : null;
    if (category == null) errors.put("category", "Choose a category.");
    String joiningDate = input.joiningDate().strip();

    if (!GMAIL.matcher(email).matches()) errors.put("email", "Enter a Gmail address, like name@gmail.com.");
    else if (taken(email, takenEmails)) errors.put("email", "Someone already uses this email.");

    if (!Dates.isRealDate(joiningDate)) errors.put("joiningDate", "Pick a joining date.");
    else if (joiningDate.compareTo(EARLIEST_JOINING_DATE) < 0) errors.put("joiningDate", "That joining date is too far back.");

    checkPassword(input.password(), errors);

    Validated<PayrollValue> payroll = validatePayroll(new PayrollInput(input.monthlySalary(), input.designation()));
    if (!payroll.ok()) errors.putAll(payroll.errors());

    if (!errors.isEmpty()) return Validated.invalid(errors);
    return Validated.valid(new NewEmployeeValue(
        email, joiningDate, input.password(), category, payroll.value().monthlySalary(), payroll.value().designation()));
  }

  public record NewAdminInput(String email, String password) {}

  /** Admins can use any email address, not just Gmail. */
  public static Validated<NewAdminInput> validateNewAdmin(NewAdminInput input, List<String> takenEmails) {
    Map<String, String> errors = new LinkedHashMap<>();
    String email = input.email().strip().toLowerCase(Locale.ROOT);

    if (!EMAIL.matcher(email).matches() || email.length() > 254) errors.put("email", "Enter a valid email address.");
    else if (taken(email, takenEmails)) errors.put("email", "Someone already uses this email.");

    checkPassword(input.password(), errors);

    if (!errors.isEmpty()) return Validated.invalid(errors);
    return Validated.valid(new NewAdminInput(email, input.password()));
  }
}
