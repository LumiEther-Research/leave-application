package app.lumiether.payslip;

import app.lumiether.domain.Money;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Fills the payslip template (the same HTML the Node app uses) with one employee's month. Pure apart from reading two bundled files. */
public final class PayslipTemplate {
  private PayslipTemplate() {}

  // The letterhead's address and CIN come from the sample payslip.
  public static final String COMPANY_NAME = "LumiEther Research LLP,";
  public static final String COMPANY_ADDRESS = "152, BOOHBCS 1st Stage, Doddakallasandra, Off Kanakapura Road, Bengaluru-560062";
  public static final String COMPANY_CIN = "ACN-8436";

  /** {@code periodMonth} is the first day of the month, "2026-08-01". Money is in paise. */
  public record PayslipData(String employeeName, String employeeCode, String designation, String periodMonth, long basic, long deduction, long net) {}

  static String escapeHtml(String s) {
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&#39;");
  }

  /** "2026-08-01" gives ["2026-08-01", "2026-08-31"]. */
  public static String[] periodRange(String periodMonth) {
    LocalDate first = LocalDate.parse(periodMonth).withDayOfMonth(1);
    return new String[] {first.toString(), first.withDayOfMonth(first.lengthOfMonth()).toString()};
  }

  private static final Pattern IF = Pattern.compile("\\{\\{#if (\\w+)\\}\\}([\\s\\S]*?)\\{\\{/if\\}\\}");
  private static final Pattern VAR = Pattern.compile("\\{\\{(\\w+)\\}\\}");

  /** Replaces {{name}} with the escaped value, and keeps {{#if name}}...{{/if}} only when that value is set. */
  public static String fillTemplate(String template, Map<String, String> values) {
    Matcher ifs = IF.matcher(template);
    StringBuilder withoutIfs = new StringBuilder();
    while (ifs.find()) {
      String v = values.get(ifs.group(1));
      ifs.appendReplacement(withoutIfs, Matcher.quoteReplacement(v != null && !v.isEmpty() ? ifs.group(2) : ""));
    }
    ifs.appendTail(withoutIfs);
    Matcher vars = VAR.matcher(withoutIfs);
    StringBuilder out = new StringBuilder();
    while (vars.find()) {
      String key = vars.group(1);
      String v = values.getOrDefault(key, "");
      vars.appendReplacement(out, Matcher.quoteReplacement(key.equals("logo") ? v : escapeHtml(v)));
    }
    vars.appendTail(out);
    return out.toString();
  }

  private static byte[] resource(String name) {
    try (InputStream in = PayslipTemplate.class.getResourceAsStream("/payslip/" + name)) {
      if (in == null) throw new IllegalStateException("missing bundled file " + name);
      return in.readAllBytes();
    } catch (IOException e) {
      throw new IllegalStateException(e);
    }
  }

  public static String buildHtml(PayslipData d) {
    String template = new String(resource("template.html"), StandardCharsets.UTF_8);
    String[] range = periodRange(d.periodMonth());
    Map<String, String> v = new HashMap<>();
    // The PDF service can't see this app's files, so the logo travels inside the HTML.
    v.put("logo", "data:image/png;base64," + Base64.getEncoder().encodeToString(resource("lumiether-logo.png")));
    v.put("companyName", COMPANY_NAME);
    v.put("companyAddress", COMPANY_ADDRESS);
    v.put("companyCin", COMPANY_CIN);
    v.put("period", range[0].substring(0, 7));
    v.put("periodStart", range[0]);
    v.put("periodEnd", range[1]);
    v.put("employeeName", d.employeeName());
    v.put("employeeCode", d.employeeCode());
    v.put("designation", d.designation() == null || d.designation().isBlank() ? "—" : d.designation().strip());
    v.put("basic", Money.formatInr(d.basic()).substring(1));
    v.put("gross", Money.formatInr(d.basic()).substring(1));
    v.put("deduction", Money.formatInr(d.deduction()).substring(1));
    v.put("hasDeduction", d.deduction() > 0 ? "1" : "");
    v.put("grossInr", Money.formatInr(d.basic()));
    v.put("deductionInr", Money.formatInr(d.deduction()));
    v.put("netInr", Money.formatInr(d.net()));
    v.put("amountInWords", Money.amountInWords(d.net()));
    return fillTemplate(template, v);
  }
}
