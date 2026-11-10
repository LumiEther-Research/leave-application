package app.lumiether.payslip;

import static org.junit.jupiter.api.Assertions.*;

import app.lumiether.payslip.PayslipTemplate.PayslipData;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Port of the "the template" group, plus the monthly job's guard and the month helpers. */
class PayslipTemplateTest {
  static final PayslipData BASE = new PayslipData("Priya Sharma", "HR-EMP-00007", "Software Engineer", "2026-02-01", 1_650_000, 0, 1_650_000);

  @Test
  void fillsTheEmployeeBlockThePeriodAndTheMoney() {
    String html = PayslipTemplate.buildHtml(BASE);
    for (String text : List.of("Salary Slip", "Pay Period: 2026-02-01 – 2026-02-28", "Priya Sharma", "HR-EMP-00007", "Software Engineer", "₹16,500.00",
        "INR Sixteen Thousand, Five Hundred only.", "This is a computer-generated document and does not require a physical signature. | Confidential",
        "https://www.lumiether.com", "data:image/png;base64,", "size: A4", "LumiEther Research LLP,", "ACN-8436", "BOOHBCS 1st Stage")) {
      assertTrue(html.contains(text), text);
    }
    assertFalse(html.contains("{{"), "every placeholder is filled");
  }

  @Test
  void theLopRowOnlyShowsWhenTheDeductionIsAboveZero() {
    assertFalse(PayslipTemplate.buildHtml(BASE).contains("Loss of Pay"));
    String html = PayslipTemplate.buildHtml(new PayslipData("Priya Sharma", "HR-EMP-00007", "Software Engineer", "2026-02-01", 1_650_000, 150_050, 1_499_950));
    assertTrue(html.contains("Loss of Pay"));
    assertTrue(html.contains("₹14,999.50"));
  }

  @Test
  void namesAreEscapedSoTheyCantInjectMarkup() {
    String html = PayslipTemplate.buildHtml(new PayslipData("<script>x</script> & Co", "HR-EMP-00007", "x", "2026-02-01", 100, 0, 100));
    assertFalse(html.contains("<script>x"));
    assertTrue(html.contains("&lt;script&gt;x&lt;/script&gt; &amp; Co"));
  }

  @Test
  void aMissingDesignationShowsADash() {
    assertTrue(PayslipTemplate.buildHtml(new PayslipData("A", "HR-EMP-00001", null, "2026-02-01", 100, 0, 100)).contains("<span class=\"value\">—</span>"));
    assertTrue(PayslipTemplate.buildHtml(new PayslipData("A", "HR-EMP-00001", "   ", "2026-02-01", 100, 0, 100)).contains("<span class=\"value\">—</span>"));
  }

  @Test
  void theLastDayOfTheMonthIsRightIncludingLeapFebruary() {
    assertEquals("2028-02-29", PayslipTemplate.periodRange("2028-02-01")[1]);
    assertEquals("2027-02-28", PayslipTemplate.periodRange("2027-02-01")[1]);
    assertEquals("2026-12-31", PayslipTemplate.periodRange("2026-12-01")[1]);
  }

  // ---------------------------------------------------- the monthly job's guard

  static final String SECRET = "0123456789abcdef-secret";

  @Test
  void onlyTheExactBearerSecretIsLetIn() {
    assertTrue(PayslipService.isCronAuthorized("Bearer " + SECRET, SECRET));
    assertFalse(PayslipService.isCronAuthorized("Bearer wrong", SECRET));
    assertFalse(PayslipService.isCronAuthorized("bearer " + SECRET, SECRET));
    assertFalse(PayslipService.isCronAuthorized(null, SECRET));
  }

  @Test
  void withNoSecretSetOrAWeakOneNobodyIsLetIn() {
    assertFalse(PayslipService.isCronAuthorized("Bearer ", ""));
    assertFalse(PayslipService.isCronAuthorized("Bearer undefined", null));
    assertFalse(PayslipService.isCronAuthorized("Bearer short", "short"));
  }

  @Test
  void onThe1stItMakesLastMonthsPayslipsAcrossAYearEndToo() {
    assertEquals("2026-10", PayslipService.previousMonthOf("2026-11-01"));
    assertEquals("2026-12", PayslipService.previousMonthOf("2027-01-01"));
    assertEquals("2026-01", PayslipService.previousMonthOf("2026-02-15"));
  }

  @Test
  void monthsAreLabelledAndChecked() {
    assertEquals("August 2026", PayslipService.monthLabel("2026-08-01"));
    assertEquals("August 2026", PayslipService.monthLabel("2026-08"));
    assertTrue(PayslipService.isMonth("2000-01"));
    for (String bad : List.of("1999-12", "2026-13", "2026-00", "2026-8", "", "2026-08-01")) assertFalse(PayslipService.isMonth(bad), bad);
  }
}
