// Run with `npm test`. The money, words and template tests need nothing; the download and replace tests
// use the Neon test branch (see ../test-db.ts). The PDF service is always mocked.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { DB_TEST_SKIP, resetDb } from "../test-db";
import { query } from "../db";
import { validatePayroll } from "../employees";
import { createAdmin, createEmployee, deleteEmployee, setEmployeePayroll } from "../store";
import { createDraftPayslips, isCronAuthorized } from "./drafts";
import { generatePayslip } from "./generate";
import { amountInWords, calculatePay, formatInr, parseAmount } from "./money";
import { buildPayslipHtml, PdfServiceError, renderPdf } from "./render";
import { previousMonthOf } from "./month";
import { getPayslipFileFor, listPayslipsForEmployee, listPayslipsForMonth, publishPayslip } from "./store";

const pdfOf = (label: string) => Buffer.from(`%PDF-1.4 ${label}`);

describe("net pay", () => {
  test("net is basic minus deduction, to the paisa", () => {
    assert.deepEqual(calculatePay({ basic: "16500", deduction: "1500.50" }), {
      ok: true,
      basic: 1_650_000,
      deduction: 150_050,
      net: 1_499_950,
    });
  });

  test("an empty deduction means none", () => {
    const r = calculatePay({ basic: "16500", deduction: "" });
    assert.equal(r.ok && r.net, 1_650_000);
  });

  test("a deduction equal to the basic is allowed and leaves nothing", () => {
    const r = calculatePay({ basic: "16500", deduction: "16500" });
    assert.equal(r.ok && r.net, 0);
  });

  test("0.1 + 0.2 style sums stay exact", () => {
    const r = calculatePay({ basic: "0.30", deduction: "0.10" });
    assert.equal(r.ok && r.net, 20);
  });
});

describe("deduction limits", () => {
  test("a negative deduction is rejected with a clear message", () => {
    assert.deepEqual(calculatePay({ basic: "16500", deduction: "-1" }), {
      ok: false,
      errors: { deduction: "Deduction can't be negative." },
    });
  });

  test("a deduction above the basic is rejected and names the basic", () => {
    assert.deepEqual(calculatePay({ basic: "16500", deduction: "16500.01" }), {
      ok: false,
      errors: { deduction: "Deduction can't be more than the basic of ₹16,500.00." },
    });
  });

  test("anything that isn't an amount is rejected", () => {
    for (const bad of ["abc", "1e3", "12.345", "1,2,x", "NaN", "Infinity"]) {
      const r = calculatePay({ basic: "16500", deduction: bad });
      assert.equal(r.ok, false, bad);
    }
  });

  test("the basic must be a positive amount", () => {
    for (const bad of ["", "0", "-5", "x"]) assert.equal(calculatePay({ basic: bad, deduction: "0" }).ok, false, bad);
  });
});

describe("salary and designation", () => {
  test("a salary is a positive amount with at most two decimals", () => {
    assert.deepEqual(validatePayroll({ monthlySalary: "16500", designation: " Engineer " }), {
      ok: true,
      value: { monthlySalary: "16500.00", designation: "Engineer" },
    });
    assert.deepEqual(validatePayroll({ monthlySalary: "1,00,000.5" }), {
      ok: true,
      value: { monthlySalary: "100000.50", designation: null },
    });
    for (const bad of ["0", "0.00", "-100", "12.345", "abc", "1e5", "99999999999"]) {
      const r = validatePayroll({ monthlySalary: bad });
      assert.equal(r.ok === false && !!r.errors.monthlySalary, true, bad);
    }
  });

  test("both are optional, and a too-long designation is refused", () => {
    assert.deepEqual(validatePayroll({}), { ok: true, value: { monthlySalary: null, designation: null } });
    assert.equal(validatePayroll({ designation: "x".repeat(101) }).ok, false);
  });
});

describe("the monthly job's guard", () => {
  const secret = "0123456789abcdef-secret";
  test("only the exact bearer secret is let in", () => {
    assert.equal(isCronAuthorized(`Bearer ${secret}`, secret), true);
    assert.equal(isCronAuthorized("Bearer wrong", secret), false);
    assert.equal(isCronAuthorized(`bearer ${secret}`, secret), false);
    assert.equal(isCronAuthorized(null, secret), false);
  });
  test("with no secret set, or a weak one, nobody is let in", () => {
    assert.equal(isCronAuthorized("Bearer ", ""), false);
    assert.equal(isCronAuthorized("Bearer undefined", undefined), false);
    assert.equal(isCronAuthorized("Bearer short", "short"), false);
  });
  test("on the 1st it makes last month's payslips, across a year end too", () => {
    assert.equal(previousMonthOf("2026-11-01"), "2026-10");
    assert.equal(previousMonthOf("2027-01-01"), "2026-12");
  });
});

describe("Indian grouping", () => {
  test("amounts are grouped in twos after the first three digits, with two decimals", () => {
    assert.equal(formatInr(0), "₹0.00");
    assert.equal(formatInr(5), "₹0.05");
    assert.equal(formatInr(99_900), "₹999.00");
    assert.equal(formatInr(1_650_000), "₹16,500.00");
    assert.equal(formatInr(10_000_000), "₹1,00,000.00");
    assert.equal(formatInr(123_456_789), "₹12,34,567.89");
    assert.equal(formatInr(999_999_999_999), "₹9,99,99,99,999.99");
  });

  test("typed amounts may carry commas", () => {
    assert.equal(parseAmount("1,00,000"), 10_000_000);
  });
});

describe("amount in words", () => {
  test("matches the sample payslip", () => {
    assert.equal(amountInWords(1_650_000), "INR Sixteen Thousand, Five Hundred only.");
  });

  test("uses Lakh and Crore", () => {
    assert.equal(amountInWords(10_000_000), "INR One Lakh only.");
    assert.equal(amountInWords(12_345_600), "INR One Lakh, Twenty-Three Thousand, Four Hundred Fifty-Six only.");
    assert.equal(amountInWords(1_000_000_000), "INR One Crore only.");
    assert.equal(
      amountInWords(1_234_567_800),
      "INR One Crore, Twenty-Three Lakh, Forty-Five Thousand, Six Hundred Seventy-Eight only.",
    );
  });

  test("small, round and zero amounts", () => {
    assert.equal(amountInWords(0), "INR Zero only.");
    assert.equal(amountInWords(1900), "INR Nineteen only.");
    assert.equal(amountInWords(100_000), "INR One Thousand only.");
    assert.equal(amountInWords(10_000), "INR One Hundred only.");
  });

  test("paise follow the rupees", () => {
    assert.equal(amountInWords(1_650_050), "INR Sixteen Thousand, Five Hundred and Fifty Paise only.");
    assert.equal(amountInWords(5), "INR Zero and Five Paise only.");
  });
});

describe("the template", () => {
  const base = {
    employeeName: "Priya Sharma",
    employeeCode: "HR-EMP-00007",
    designation: "Software Engineer",
    periodMonth: "2026-02-01",
    basic: 1_650_000,
    deduction: 0,
    net: 1_650_000,
  };

  test("fills the employee block, the period and the money", async () => {
    const html = await buildPayslipHtml(base);
    for (const text of [
      "Salary Slip",
      "Pay Period: 2026-02-01 – 2026-02-28",
      "Priya Sharma",
      "HR-EMP-00007",
      "Software Engineer",
      "₹16,500.00",
      "INR Sixteen Thousand, Five Hundred only.",
      "This is a computer-generated document and does not require a physical signature. | Confidential",
      "https://www.lumiether.com",
      "data:image/png;base64,",
      "size: A4",
    ])
      assert.ok(html.includes(text), text);
    assert.equal(html.includes("{{"), false, "every placeholder is filled");
  });

  test("the LOP row only shows when the deduction is above zero", async () => {
    assert.equal((await buildPayslipHtml(base)).includes("Loss of Pay"), false);
    const html = await buildPayslipHtml({ ...base, deduction: 150_050, net: 1_499_950 });
    assert.ok(html.includes("Loss of Pay"));
    assert.ok(html.includes("₹14,999.50"));
  });

  test("names are escaped, so they can't inject markup", async () => {
    const html = await buildPayslipHtml({ ...base, employeeName: "<script>x</script> & Co" });
    assert.equal(html.includes("<script>x"), false);
    assert.ok(html.includes("&lt;script&gt;x&lt;/script&gt; &amp; Co"));
  });
});

describe("the PDF service client", () => {
  const realFetch = globalThis.fetch;
  const realUrl = process.env.PDF_SERVICE_URL;
  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realUrl === undefined) delete process.env.PDF_SERVICE_URL;
    else process.env.PDF_SERVICE_URL = realUrl;
  });

  test("posts the HTML to /render and returns the PDF bytes", async () => {
    process.env.PDF_SERVICE_URL = "http://pdf.test:8080";
    let seen: { url: string; method?: string; body?: unknown } | undefined;
    globalThis.fetch = (async (url: URL, init: RequestInit) => {
      seen = { url: String(url), method: init.method, body: init.body };
      return new Response(pdfOf("ok"), { status: 200 });
    }) as typeof fetch;
    assert.equal((await renderPdf("<p>hi</p>")).toString(), "%PDF-1.4 ok");
    assert.deepEqual(seen, { url: "http://pdf.test:8080/render", method: "POST", body: "<p>hi</p>" });
  });

  test("a service that can't be reached is reported as not running", async () => {
    process.env.PDF_SERVICE_URL = "http://pdf.test:8080";
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await assert.rejects(renderPdf("<p>hi</p>"), { message: "PDF service is not running" });
  });

  test("no PDF_SERVICE_URL is reported as not running too", async () => {
    delete process.env.PDF_SERVICE_URL;
    await assert.rejects(renderPdf("<p>hi</p>"), { message: "PDF service is not running" });
  });
});

describe("payslips in the database", { skip: DB_TEST_SKIP }, () => {
  beforeEach(resetDb);

  const setup = async () => {
    const admin = await createAdmin({ name: "Boss", email: "boss@example.com", passwordHash: "x" });
    const priya = await createEmployee({ name: "Priya", email: "priya@gmail.com", joiningDate: "2024-01-01", passwordHash: "x" });
    const ravi = await createEmployee({ name: "Ravi", email: "ravi@gmail.com", joiningDate: "2024-01-01", passwordHash: "x" });
    await query("update employees set designation = 'Software Engineer', monthly_salary = 16500 where id = $1", [priya.id]);
    return { admin, priya, ravi };
  };
  const input = (employeeId: string, over: Partial<Parameters<typeof generatePayslip>[0]> = {}) => ({
    employeeId,
    month: "2026-08",
    basic: "16500",
    deduction: "0",
    replace: false,
    ...over,
  });
  const ok = async () => pdfOf("first");

  test("employees get codes like HR-EMP-00001, in the order they joined, and they are unique", async () => {
    const { priya, ravi } = await setup();
    const codes = await query<{ employee_code: string }>("select employee_code from employees order by created_at, id");
    assert.equal(codes.length, 2);
    assert.match(codes[0].employee_code, /^HR-EMP-\d{5}$/);
    assert.notEqual(codes[0].employee_code, codes[1].employee_code);
    assert.ok(priya.id !== ravi.id);
  });

  test("salary and designation are saved when adding an employee, and can be edited or cleared", async () => {
    const e = await createEmployee({
      name: "Asha", email: "asha@gmail.com", joiningDate: "2024-01-01", passwordHash: "x",
      monthlySalary: "16500.00", designation: "Designer",
    });
    const read = () => query<{ monthly_salary: string | null; designation: string | null }>(
      "select monthly_salary::text, designation from employees where id = $1", [e.id]);
    assert.deepEqual((await read())[0], { monthly_salary: "16500.00", designation: "Designer" });
    assert.equal(await setEmployeePayroll(e.id, { monthlySalary: "18000.50", designation: "Lead" }), true);
    assert.deepEqual((await read())[0], { monthly_salary: "18000.50", designation: "Lead" });
    assert.equal(await setEmployeePayroll(e.id, { monthlySalary: null, designation: null }), true);
    assert.deepEqual((await read())[0], { monthly_salary: null, designation: null });
    assert.equal(await setEmployeePayroll("not-a-uuid", { monthlySalary: null, designation: null }), false);
  });

  test("removing an employee deletes them and their payslips, and nobody else's", async () => {
    const { priya, ravi } = await setup();
    await generatePayslip(input(priya.id), { render: ok });
    await generatePayslip(input(ravi.id), { render: ok });
    assert.equal(await deleteEmployee(priya.id), true);
    assert.equal(await deleteEmployee(priya.id), false);
    assert.equal(await deleteEmployee("not-a-uuid"), false);
    assert.deepEqual((await query<{ employee_id: string }>("select employee_id from payslips")).map((r) => r.employee_id), [ravi.id]);
    assert.deepEqual((await query<{ id: string }>("select id from employees")).map((r) => r.id), [ravi.id]);
  });

  test("generating stores the PDF, the net and the words", async () => {
    const { priya } = await setup();
    const result = await generatePayslip(input(priya.id, { deduction: "1500.50" }), { render: ok });
    assert.deepEqual(result, { ok: true, outcome: "saved", employeeName: "Priya", month: "2026-08" });
    const [row] = await query<{ net: string; amount_in_words: string; pdf: Buffer; period_month: string }>(
      "select net::text, amount_in_words, pdf, period_month::text from payslips",
    );
    assert.equal(row.net, "14999.50");
    assert.equal(row.amount_in_words, "INR Fourteen Thousand, Nine Hundred Ninety-Nine and Fifty Paise only.");
    assert.equal(row.period_month, "2026-08-01");
    assert.equal(row.pdf.toString(), "%PDF-1.4 first");
  });

  test("bad numbers save nothing and never reach the PDF service", async () => {
    const { priya } = await setup();
    let called = false;
    const render = async () => ((called = true), pdfOf("x"));
    const tooMuch = await generatePayslip(input(priya.id, { deduction: "16501" }), { render });
    assert.equal(tooMuch.ok === false && tooMuch.kind === "invalid" && tooMuch.errors.deduction?.includes("more than the basic"), true);
    const negative = await generatePayslip(input(priya.id, { deduction: "-1" }), { render });
    assert.equal(negative.ok === false && negative.kind === "invalid" && negative.errors.deduction, "Deduction can't be negative.");
    assert.equal(called, false);
    assert.equal((await query("select 1 from payslips")).length, 0);
  });

  test("when the PDF service is down nothing is saved", async () => {
    const { priya } = await setup();
    const result = await generatePayslip(input(priya.id), {
      render: async () => {
        throw new PdfServiceError();
      },
    });
    assert.deepEqual(result, { ok: false, kind: "pdf", message: "PDF service is not running" });
    assert.equal((await query("select 1 from payslips")).length, 0);
  });

  test("regenerating a month asks first and leaves the old payslip alone until the admin agrees", async () => {
    const { priya } = await setup();
    await generatePayslip(input(priya.id), { render: ok });
    const again = await generatePayslip(input(priya.id, { deduction: "500" }), { render: async () => pdfOf("second") });
    assert.deepEqual(again, { ok: false, kind: "confirm", employeeName: "Priya", month: "2026-08" });
    const [row] = await query<{ net: string; pdf: Buffer }>("select net::text, pdf from payslips");
    assert.equal(row.net, "16500.00");
    assert.equal(row.pdf.toString(), "%PDF-1.4 first");
  });

  test("with the go-ahead the month's row is replaced, not duplicated", async () => {
    const { priya } = await setup();
    await generatePayslip(input(priya.id), { render: ok });
    const [{ id: firstId }] = await query<{ id: string }>("select id from payslips");
    const result = await generatePayslip(input(priya.id, { deduction: "500", replace: true }), {
      render: async () => pdfOf("second"),
    });
    assert.deepEqual(result, { ok: true, outcome: "replaced", employeeName: "Priya", month: "2026-08" });
    const rows = await query<{ id: string; net: string; deduction: string; pdf: Buffer }>(
      "select id, net::text, deduction::text, pdf from payslips",
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, firstId);
    assert.deepEqual([rows[0].net, rows[0].deduction], ["16000.00", "500.00"]);
    assert.equal(rows[0].pdf.toString(), "%PDF-1.4 second");
  });

  test("a failed re-render keeps the old payslip", async () => {
    const { priya } = await setup();
    await generatePayslip(input(priya.id), { render: ok });
    const result = await generatePayslip(input(priya.id, { replace: true, deduction: "500" }), {
      render: async () => {
        throw new PdfServiceError();
      },
    });
    assert.equal(result.ok, false);
    const [row] = await query<{ pdf: Buffer }>("select pdf from payslips");
    assert.equal(row.pdf.toString(), "%PDF-1.4 first");
  });

  test("replace on a month with no payslip just saves it", async () => {
    const { priya } = await setup();
    const result = await generatePayslip(input(priya.id, { replace: true }), { render: ok });
    assert.equal(result.ok && result.outcome, "saved");
  });

  test("another month or another employee is a separate payslip", async () => {
    const { priya, ravi } = await setup();
    await generatePayslip(input(priya.id), { render: ok });
    await generatePayslip(input(priya.id, { month: "2026-09" }), { render: ok });
    await generatePayslip(input(ravi.id), { render: ok });
    assert.equal((await query("select 1 from payslips")).length, 3);
  });

  test("an employee can download only their own payslip", async () => {
    const { priya, ravi } = await setup();
    await generatePayslip(input(priya.id), { render: ok });
    const [{ id }] = await query<{ id: string }>("select id from payslips");

    const own = await getPayslipFileFor({ id: priya.id, role: "employee" }, id);
    assert.equal(own?.pdf.toString(), "%PDF-1.4 first");
    assert.match(own?.filename ?? "", /^Payslip_HR-EMP-\d{5}_2026-08\.pdf$/);

    assert.equal(await getPayslipFileFor({ id: ravi.id, role: "employee" }, id), null);
  });

  test("an admin can download any payslip", async () => {
    const { admin, priya, ravi } = await setup();
    await generatePayslip(input(priya.id), { render: ok });
    await generatePayslip(input(ravi.id), { render: ok });
    for (const { id } of await query<{ id: string }>("select id from payslips")) {
      assert.ok(await getPayslipFileFor({ id: admin.id, role: "admin" }, id));
    }
  });

  test("an unknown or made-up id is not found", async () => {
    const { admin } = await setup();
    assert.equal(await getPayslipFileFor({ id: admin.id, role: "admin" }, "00000000-0000-4000-8000-000000000000"), null);
    assert.equal(await getPayslipFileFor({ id: admin.id, role: "admin" }, "not-a-uuid"), null);
  });

  test("lists: an employee sees only their own, the admin sees the month's", async () => {
    const { priya, ravi } = await setup();
    await generatePayslip(input(priya.id), { render: ok });
    await generatePayslip(input(ravi.id), { render: ok });
    await generatePayslip(input(ravi.id, { month: "2026-07" }), { render: ok });
    assert.deepEqual((await listPayslipsForEmployee(priya.id)).map((p) => p.employeeName), ["Priya"]);
    assert.deepEqual((await listPayslipsForEmployee(ravi.id)).map((p) => p.periodMonth), ["2026-08-01", "2026-07-01"]);
    assert.equal((await listPayslipsForMonth("2026-08-01")).length, 2);
    assert.equal("pdf" in (await listPayslipsForMonth("2026-08-01"))[0], false);
  });

  test("the database refuses a deduction above the basic even if the code is bypassed", async () => {
    const { priya } = await setup();
    await assert.rejects(
      query(
        "insert into payslips (employee_id, period_month, basic, deduction, net, amount_in_words, pdf) values ($1, '2026-08-01', 100, 200, -100, 'x', 'x')",
        [priya.id],
      ),
    );
  });

  describe("drafts from the monthly job", () => {
    const draftsFor = async () => {
      const { admin, priya, ravi } = await setup(); // only Priya has a salary
      return { admin, priya, ravi };
    };
    const render = async () => pdfOf("draft");

    test("makes a zero-LOP draft only for people with a salary, and leaves the rest alone", async () => {
      const { priya } = await draftsFor();
      assert.deepEqual(await createDraftPayslips("2026-10", { render }), { created: 1, skipped: 0, failed: null });
      const rows = await query<{ employee_id: string; basic: string; deduction: string; net: string; published: boolean }>(
        "select employee_id, basic::text, deduction::text, net::text, published from payslips",
      );
      assert.deepEqual(rows, [{ employee_id: priya.id, basic: "16500.00", deduction: "0.00", net: "16500.00", published: false }]);
    });

    test("running it again creates nothing and never overwrites", async () => {
      await draftsFor();
      await createDraftPayslips("2026-10", { render });
      assert.deepEqual(await createDraftPayslips("2026-10", { render: async () => pdfOf("again") }), { created: 0, skipped: 0, failed: null });
      const [row] = await query<{ pdf: Buffer }>("select pdf from payslips");
      assert.equal(row.pdf.toString(), "%PDF-1.4 draft");
    });

    test("it doesn't make a payslip for someone who joined after that month", async () => {
      const { priya } = await draftsFor();
      await query("update employees set joining_date = '2026-11-15' where id = $1", [priya.id]);
      assert.equal((await createDraftPayslips("2026-10", { render })).created, 0);
      await query("update employees set joining_date = '2026-10-31' where id = $1", [priya.id]);
      assert.equal((await createDraftPayslips("2026-10", { render })).created, 1);
    });

    test("with the PDF service down it saves nothing and says so", async () => {
      await draftsFor();
      const result = await createDraftPayslips("2026-10", {
        render: async () => {
          throw new PdfServiceError();
        },
      });
      assert.deepEqual(result, { created: 0, skipped: 0, failed: "PDF service is not running" });
      assert.equal((await query("select 1 from payslips")).length, 0);
    });

    test("an employee can't list or download a draft, but the admin can", async () => {
      const { admin, priya } = await draftsFor();
      await createDraftPayslips("2026-10", { render });
      const [{ id }] = await query<{ id: string }>("select id from payslips");
      assert.deepEqual(await listPayslipsForEmployee(priya.id), []);
      assert.equal(await getPayslipFileFor({ id: priya.id, role: "employee" }, id), null);
      assert.ok(await getPayslipFileFor({ id: admin.id, role: "admin" }, id));
      assert.equal((await listPayslipsForMonth("2026-10-01"))[0].published, false);
    });

    test("publishing makes it visible to its owner, once", async () => {
      const { priya } = await draftsFor();
      await createDraftPayslips("2026-10", { render });
      const [{ id }] = await query<{ id: string }>("select id from payslips");
      assert.equal(await publishPayslip(id), true);
      assert.equal(await publishPayslip(id), false);
      assert.equal((await listPayslipsForEmployee(priya.id)).length, 1);
      assert.ok(await getPayslipFileFor({ id: priya.id, role: "employee" }, id));
    });

    test("generating over a draft with LOP needs no confirmation and publishes the corrected payslip", async () => {
      const { priya } = await draftsFor();
      await createDraftPayslips("2026-10", { render });
      const result = await generatePayslip(input(priya.id, { month: "2026-10", deduction: "1000" }), { render: async () => pdfOf("final") });
      assert.deepEqual(result, { ok: true, outcome: "replaced", employeeName: "Priya", month: "2026-10" });
      const rows = await query<{ net: string; published: boolean; pdf: Buffer }>("select net::text, published, pdf from payslips");
      assert.equal(rows.length, 1);
      assert.deepEqual([rows[0].net, rows[0].published, rows[0].pdf.toString()], ["15500.00", true, "%PDF-1.4 final"]);
    });
  });
});
