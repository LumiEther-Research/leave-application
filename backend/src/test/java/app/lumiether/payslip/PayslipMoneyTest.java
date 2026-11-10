package app.lumiether.payslip;

import static org.junit.jupiter.api.Assertions.*;

import app.lumiether.domain.Money;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Port of the "net pay", "deduction limits", "Indian grouping" and "amount in words" groups of payslip.test.ts. */
class PayslipMoneyTest {
  @Test
  void netIsBasicMinusDeductionToThePaisa() {
    var r = Money.calculatePay("16500", "1500.50");
    assertEquals(List.of(true, 1_650_000L, 150_050L, 1_499_950L), List.of(r.ok(), r.basic(), r.deduction(), r.net()));
  }

  @Test
  void anEmptyDeductionMeansNone() {
    assertEquals(1_650_000, Money.calculatePay("16500", "").net());
  }

  @Test
  void aDeductionEqualToTheBasicIsAllowedAndLeavesNothing() {
    var r = Money.calculatePay("16500", "16500");
    assertTrue(r.ok());
    assertEquals(0, r.net());
  }

  @Test
  void pointOnePlusPointTwoStyleSumsStayExact() {
    assertEquals(20, Money.calculatePay("0.30", "0.10").net());
  }

  @Test
  void aNegativeDeductionIsRejectedWithAClearMessage() {
    var r = Money.calculatePay("16500", "-1");
    assertFalse(r.ok());
    assertEquals(Map.of("deduction", "Deduction can't be negative."), r.errors());
  }

  @Test
  void aDeductionAboveTheBasicIsRejectedAndNamesTheBasic() {
    var r = Money.calculatePay("16500", "16500.01");
    assertEquals(Map.of("deduction", "Deduction can't be more than the basic of ₹16,500.00."), r.errors());
  }

  @Test
  void anythingThatIsntAnAmountIsRejected() {
    for (String bad : List.of("abc", "1e3", "12.345", "1,2,x", "NaN", "Infinity")) {
      assertFalse(Money.calculatePay("16500", bad).ok(), bad);
    }
    assertEquals("Enter the deduction as an amount, like 1500 or 1500.50.", Money.calculatePay("16500", "abc").errors().get("deduction"));
  }

  @Test
  void theBasicMustBeAPositiveAmount() {
    for (String bad : List.of("", "0", "-5", "x")) assertFalse(Money.calculatePay(bad, "0").ok(), bad);
    assertEquals("Basic can't be negative.", Money.calculatePay("-5", "0").errors().get("basic"));
    assertEquals("Basic must be more than zero.", Money.calculatePay("0", "0").errors().get("basic"));
    assertEquals("Enter the basic as an amount, like 16500 or 16500.50.", Money.calculatePay("x", "0").errors().get("basic"));
    // more than ten digits is not an amount at all (the same limit as the current app and the numeric(12,2) column)
    assertEquals("Enter the basic as an amount, like 16500 or 16500.50.", Money.calculatePay("99999999999", "0").errors().get("basic"));
    assertTrue(Money.calculatePay("9999999999.99", "0").ok());
  }

  @Test
  void amountsAreGroupedInTwosAfterTheFirstThreeDigitsWithTwoDecimals() {
    assertEquals("₹0.00", Money.formatInr(0));
    assertEquals("₹0.05", Money.formatInr(5));
    assertEquals("₹999.00", Money.formatInr(99_900));
    assertEquals("₹16,500.00", Money.formatInr(1_650_000));
    assertEquals("₹1,00,000.00", Money.formatInr(10_000_000));
    assertEquals("₹12,34,567.89", Money.formatInr(123_456_789));
    assertEquals("₹9,99,99,99,999.99", Money.formatInr(999_999_999_999L));
  }

  @Test
  void typedAmountsMayCarryCommas() {
    assertEquals(10_000_000L, Money.parseAmount("1,00,000"));
  }

  @Test
  void amountInWordsMatchesTheSamplePayslip() {
    assertEquals("INR Sixteen Thousand, Five Hundred only.", Money.amountInWords(1_650_000));
  }

  @Test
  void usesLakhAndCrore() {
    assertEquals("INR One Lakh only.", Money.amountInWords(10_000_000));
    assertEquals("INR One Lakh, Twenty-Three Thousand, Four Hundred Fifty-Six only.", Money.amountInWords(12_345_600));
    assertEquals("INR One Crore only.", Money.amountInWords(1_000_000_000));
    assertEquals("INR One Crore, Twenty-Three Lakh, Forty-Five Thousand, Six Hundred Seventy-Eight only.", Money.amountInWords(1_234_567_800));
  }

  @Test
  void smallRoundAndZeroAmounts() {
    assertEquals("INR Zero only.", Money.amountInWords(0));
    assertEquals("INR Nineteen only.", Money.amountInWords(1900));
    assertEquals("INR One Thousand only.", Money.amountInWords(100_000));
    assertEquals("INR One Hundred only.", Money.amountInWords(10_000));
  }

  @Test
  void paiseFollowTheRupees() {
    assertEquals("INR Sixteen Thousand, Five Hundred and Fifty Paise only.", Money.amountInWords(1_650_050));
    assertEquals("INR Zero and Five Paise only.", Money.amountInWords(5));
  }
}
