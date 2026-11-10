package app.lumiether.payslip;

import app.lumiether.domain.Money;
import app.lumiether.payslip.PayslipStore.PayslipEmployee;
import app.lumiether.payslip.PayslipTemplate.PayslipData;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;

/** Generating a payslip: check the numbers, render the PDF, then store it. Nothing is stored unless the PDF was made. Port of generate.ts and drafts.ts. */
public final class PayslipService {
  private final PayslipStore store;
  private final PayslipRenderer renderer;

  public PayslipService(PayslipStore store, PayslipRenderer renderer) {
    this.store = store;
    this.renderer = renderer;
  }

  /** {@code month} is "2026-08". {@code replace}: the admin agreed to overwrite an existing payslip for this month. */
  public record GenerateInput(String employeeId, String month, String basic, String deduction, boolean replace) {}

  /** kind: "saved", "replaced", "invalid" (errors), "confirm" (employeeName, month) or "pdf" (message). */
  public record GenerateResult(String kind, String employeeName, String month, Map<String, String> errors, String message) {
    public boolean ok() {
      return kind.equals("saved") || kind.equals("replaced");
    }
  }

  private static final Pattern MONTH = Pattern.compile("^(\\d{4})-(0[1-9]|1[0-2])$");

  public static boolean isMonth(String value) {
    return MONTH.matcher(value).matches() && value.compareTo("2000-01") >= 0;
  }

  private static String message(RuntimeException e) {
    return e instanceof PdfClient.PdfServiceException ? e.getMessage() : PdfClient.DOWN;
  }

  public GenerateResult generate(GenerateInput input) {
    Map<String, String> errors = new LinkedHashMap<>();
    PayslipEmployee employee = store.findPayslipEmployee(input.employeeId());
    if (employee == null) errors.put("employee", "Choose an employee.");
    if (!isMonth(input.month())) errors.put("month", "Choose a month.");
    Money.Pay pay = Money.calculatePay(input.basic(), input.deduction());
    if (!pay.ok()) errors.putAll(pay.errors());
    if (!errors.isEmpty() || employee == null || !pay.ok()) return new GenerateResult("invalid", null, null, errors, null);

    String periodMonth = input.month() + "-01";
    String state = store.payslipState(employee.id(), periodMonth);
    // Replacing a published payslip needs the admin's go-ahead. A draft is what this is for, so it needs none.
    if (!input.replace() && state.equals("published")) return new GenerateResult("confirm", employee.name(), input.month(), Map.of(), null);
    boolean replace = input.replace() || state.equals("draft");

    byte[] pdf;
    try {
      pdf = renderer.render(PayslipTemplate.buildHtml(new PayslipData(employee.name(), employee.employeeCode(), employee.designation(),
          periodMonth, pay.basic(), pay.deduction(), pay.net())));
    } catch (RuntimeException e) {
      return new GenerateResult("pdf", null, null, Map.of(), message(e));
    }

    // Generating by hand is the admin finalising it, so it is published.
    String saved = store.savePayslip(new PayslipStore.SaveInput(employee.id(), periodMonth, pay.basic(), pay.deduction(), pay.net(), pdf), replace, true);
    // Someone else made this month's payslip while the PDF was rendering.
    if (saved.equals("exists")) return new GenerateResult("confirm", employee.name(), input.month(), Map.of(), null);
    return new GenerateResult(saved, employee.name(), input.month(), Map.of(), null);
  }

  /** {@code failed} is null, or why the job stopped. */
  public record DraftResult(int created, int skipped, String failed) {}

  /** Makes zero-LOP drafts for the month ("2026-10"). Never touches a payslip that already exists. Stops at once if the PDF service is down. */
  public DraftResult createDrafts(String month) {
    String periodMonth = month + "-01";
    int created = 0, skipped = 0;
    for (PayslipEmployee e : store.listEmployeesNeedingPayslip(periodMonth)) {
      try {
        long salary = e.monthlySalary();
        byte[] pdf = renderer.render(PayslipTemplate.buildHtml(new PayslipData(e.name(), e.employeeCode(), e.designation(), periodMonth, salary, 0, salary)));
        String saved = store.savePayslip(new PayslipStore.SaveInput(e.id(), periodMonth, salary, 0, salary, pdf), false, false);
        if (saved.equals("saved")) created++;
        else skipped++; // someone made it while we rendered
      } catch (RuntimeException ex) {
        return new DraftResult(created, skipped, ex instanceof PdfClient.PdfServiceException ? ex.getMessage() : "Couldn't create a payslip");
      }
    }
    return new DraftResult(created, skipped, null);
  }

  /** True only for {@code Authorization: Bearer <CRON_SECRET>}. With no secret set, or a weak one, nothing is authorised. */
  public static boolean isCronAuthorized(String header, String secret) {
    if (secret == null || secret.length() < 16 || header == null) return false;
    return MessageDigest.isEqual(("Bearer " + secret).getBytes(StandardCharsets.UTF_8), header.getBytes(StandardCharsets.UTF_8));
  }

  /** "2026-11-01" gives "2026-10", across a year end too. */
  public static String previousMonthOf(String isoDate) {
    java.time.LocalDate d = java.time.LocalDate.parse(isoDate).withDayOfMonth(1).minusMonths(1);
    return d.toString().substring(0, 7);
  }

  private static final String[] MONTHS = {"January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"};

  /** "2026-08-01" or "2026-08" gives "August 2026". */
  public static String monthLabel(String period) {
    return MONTHS[Integer.parseInt(period.substring(5, 7)) - 1] + " " + period.substring(0, 4);
  }
}
