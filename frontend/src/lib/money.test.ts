import { describe, expect, it } from "vitest";
import { calculatePay, formatInr, monthLabel, parseAmount, toPlain } from "./money";

describe("payslip money (the live net pay under the form)", () => {
  it("net is basic minus deduction, to the paisa, and an empty deduction is none", () => {
    expect(calculatePay({ basic: "16500", deduction: "1500.50" })).toEqual({ ok: true, basic: 1_650_000, deduction: 150_050, net: 1_499_950 });
    expect(calculatePay({ basic: "16500", deduction: "" })).toMatchObject({ ok: true, net: 1_650_000 });
    expect(calculatePay({ basic: "16500", deduction: "16500" })).toMatchObject({ ok: true, net: 0 });
    expect(calculatePay({ basic: "0.30", deduction: "0.10" })).toMatchObject({ net: 20 });
  });

  it("refuses a negative or too-large deduction and anything that isn't an amount, with the current app's words", () => {
    expect(calculatePay({ basic: "16500", deduction: "-1" })).toEqual({ ok: false, errors: { deduction: "Deduction can't be negative." } });
    expect(calculatePay({ basic: "16500", deduction: "16500.01" })).toEqual({ ok: false, errors: { deduction: "Deduction can't be more than the basic of ₹16,500.00." } });
    for (const bad of ["abc", "1e3", "12.345", "NaN"]) expect(calculatePay({ basic: "16500", deduction: bad }).ok).toBe(false);
    expect(calculatePay({ basic: "0", deduction: "" })).toEqual({ ok: false, errors: { basic: "Basic must be more than zero." } });
    expect(calculatePay({ basic: "-5", deduction: "" })).toEqual({ ok: false, errors: { basic: "Basic can't be negative." } });
    expect(calculatePay({ basic: "x", deduction: "" })).toEqual({ ok: false, errors: { basic: "Enter the basic as an amount, like 16500 or 16500.50." } });
  });

  it("groups rupees in the Indian way", () => {
    expect(formatInr(0)).toBe("₹0.00");
    expect(formatInr(5)).toBe("₹0.05");
    expect(formatInr(1_650_000)).toBe("₹16,500.00");
    expect(formatInr(10_000_000)).toBe("₹1,00,000.00");
    expect(formatInr(123_456_789)).toBe("₹12,34,567.89");
    expect(formatInr(999_999_999_999)).toBe("₹9,99,99,99,999.99");
    expect(parseAmount("1,00,000")).toBe(10_000_000);
    expect(toPlain(1_650_050)).toBe("16500.50");
  });

  it("labels a month", () => {
    expect(monthLabel("2026-08-01")).toBe("August 2026");
    expect(monthLabel("2026-08")).toBe("August 2026");
  });
});
