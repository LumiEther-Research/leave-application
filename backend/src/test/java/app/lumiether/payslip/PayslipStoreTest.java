package app.lumiether.payslip;

import static org.junit.jupiter.api.Assertions.*;

import app.lumiether.db.Db;
import app.lumiether.db.DbException;
import app.lumiether.db.Store;
import app.lumiether.db.TestDb;
import app.lumiether.domain.Types.Admin;
import app.lumiether.domain.Types.Employee;
import app.lumiether.payslip.PayslipService.GenerateInput;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/** Port of "payslips in the database" and its "drafts from the monthly job" group. The PDF service is always a fake. */
class PayslipStoreTest {
  Db db;
  Store store;
  PayslipStore payslips;

  static byte[] pdfOf(String label) {
    return ("%PDF-1.4 " + label).getBytes(StandardCharsets.UTF_8);
  }

  static final PayslipRenderer OK = html -> pdfOf("first");

  static PayslipRenderer down() {
    return html -> {
      throw new PdfClient.PdfServiceException();
    };
  }

  @BeforeEach
  void setUp() {
    db = TestDb.reset();
    store = new Store(db);
    payslips = new PayslipStore(db);
  }

  PayslipService service(PayslipRenderer r) {
    return new PayslipService(payslips, r);
  }

  record People(Admin admin, Employee priya, Employee ravi) {}

  People setup() {
    Admin admin = store.createAdmin("Boss", "boss@example.com", "x");
    Employee priya = store.createEmployee(Store.NewEmployee.of("Priya", "priya@gmail.com", "2024-01-01", "x"));
    Employee ravi = store.createEmployee(Store.NewEmployee.of("Ravi", "ravi@gmail.com", "2024-01-01", "x"));
    db.query("update employees set designation = 'Software Engineer', monthly_salary = 16500 where id = $1", priya.id());
    return new People(admin, priya, ravi);
  }

  static GenerateInput input(String employeeId, String deduction, boolean replace, String month) {
    return new GenerateInput(employeeId, month, "16500", deduction, replace);
  }

  static GenerateInput input(String employeeId) {
    return input(employeeId, "0", false, "2026-08");
  }

  long count() {
    return db.query("select count(*) as n from payslips").get(0).integer("n");
  }

  String payslipId() {
    return db.query("select id from payslips").get(0).str("id");
  }

  @Test
  void generatingStoresThePdfTheNetAndTheWords() {
    People p = setup();
    var result = service(OK).generate(input(p.priya().id(), "1500.50", false, "2026-08"));
    assertEquals(List.of("saved", "Priya", "2026-08"), List.of(result.kind(), result.employeeName(), result.month()));
    var row = db.query("select net::text as net, amount_in_words, pdf, period_month::text as period from payslips").get(0);
    assertEquals("14999.50", row.str("net"));
    assertEquals("INR Fourteen Thousand, Nine Hundred Ninety-Nine and Fifty Paise only.", row.str("amount_in_words"));
    assertEquals("2026-08-01", row.str("period"));
    assertEquals("%PDF-1.4 first", new String(row.bytes("pdf"), StandardCharsets.UTF_8));
  }

  @Test
  void theHtmlSentToTheRendererCarriesTheEmployeeAndTheMoney() {
    People p = setup();
    var seen = new java.util.concurrent.atomic.AtomicReference<String>();
    service(html -> {
      seen.set(html);
      return pdfOf("x");
    }).generate(input(p.priya().id(), "1500.50", false, "2026-08"));
    assertTrue(seen.get().contains("Priya") && seen.get().contains("Software Engineer") && seen.get().contains("Loss of Pay") && seen.get().contains("₹14,999.50"));
    assertTrue(seen.get().contains("Pay Period: 2026-08-01 – 2026-08-31"));
  }

  @Test
  void generatedByHandMeansPublished() {
    People p = setup();
    service(OK).generate(input(p.priya().id()));
    assertTrue(db.query("select published from payslips").get(0).bool("published"));
  }

  @Test
  void badNumbersSaveNothingAndNeverReachThePdfService() {
    People p = setup();
    var called = new java.util.concurrent.atomic.AtomicBoolean();
    var svc = service(html -> {
      called.set(true);
      return pdfOf("x");
    });
    var tooMuch = svc.generate(input(p.priya().id(), "16501", false, "2026-08"));
    assertEquals("invalid", tooMuch.kind());
    assertTrue(tooMuch.errors().get("deduction").contains("more than the basic"));
    assertEquals("Deduction can't be negative.", svc.generate(input(p.priya().id(), "-1", false, "2026-08")).errors().get("deduction"));
    assertEquals("Choose an employee.", svc.generate(input("not-a-uuid")).errors().get("employee"));
    assertEquals("Choose a month.", svc.generate(input(p.priya().id(), "0", false, "1999-12")).errors().get("month"));
    assertFalse(called.get());
    assertEquals(0, count());
  }

  @Test
  void whenThePdfServiceIsDownNothingIsSaved() {
    People p = setup();
    var result = service(down()).generate(input(p.priya().id()));
    assertEquals(List.of("pdf", "PDF service is not running"), List.of(result.kind(), result.message()));
    assertEquals(0, count());
  }

  @Test
  void regeneratingAMonthAsksFirstAndLeavesTheOldPayslipAloneUntilTheAdminAgrees() {
    People p = setup();
    service(OK).generate(input(p.priya().id()));
    var again = service(html -> pdfOf("second")).generate(input(p.priya().id(), "500", false, "2026-08"));
    assertEquals(List.of("confirm", "Priya", "2026-08"), List.of(again.kind(), again.employeeName(), again.month()));
    var row = db.query("select net::text as net, pdf from payslips").get(0);
    assertEquals("16500.00", row.str("net"));
    assertEquals("%PDF-1.4 first", new String(row.bytes("pdf"), StandardCharsets.UTF_8));
  }

  @Test
  void withTheGoAheadTheMonthsRowIsReplacedNotDuplicated() {
    People p = setup();
    service(OK).generate(input(p.priya().id()));
    String firstId = payslipId();
    var result = service(html -> pdfOf("second")).generate(input(p.priya().id(), "500", true, "2026-08"));
    assertEquals(List.of("replaced", "Priya"), List.of(result.kind(), result.employeeName()));
    var rows = db.query("select id, net::text as net, deduction::text as deduction, pdf from payslips");
    assertEquals(1, rows.size());
    assertEquals(firstId, rows.get(0).str("id"));
    assertEquals(List.of("16000.00", "500.00"), List.of(rows.get(0).str("net"), rows.get(0).str("deduction")));
    assertEquals("%PDF-1.4 second", new String(rows.get(0).bytes("pdf"), StandardCharsets.UTF_8));
  }

  @Test
  void aFailedReRenderKeepsTheOldPayslip() {
    People p = setup();
    service(OK).generate(input(p.priya().id()));
    assertEquals("pdf", service(down()).generate(input(p.priya().id(), "500", true, "2026-08")).kind());
    assertEquals("%PDF-1.4 first", new String(db.query("select pdf from payslips").get(0).bytes("pdf"), StandardCharsets.UTF_8));
  }

  @Test
  void replaceOnAMonthWithNoPayslipJustSavesIt() {
    People p = setup();
    assertEquals("saved", service(OK).generate(input(p.priya().id(), "0", true, "2026-08")).kind());
  }

  @Test
  void anotherMonthOrAnotherEmployeeIsASeparatePayslip() {
    People p = setup();
    service(OK).generate(input(p.priya().id()));
    service(OK).generate(input(p.priya().id(), "0", false, "2026-09"));
    service(OK).generate(input(p.ravi().id()));
    assertEquals(3, count());
  }

  @Test
  void anEmployeeCanDownloadOnlyTheirOwnPayslip() {
    People p = setup();
    service(OK).generate(input(p.priya().id()));
    String id = payslipId();
    var own = payslips.getPayslipFileFor(p.priya().id(), false, id);
    assertEquals("%PDF-1.4 first", new String(own.pdf(), StandardCharsets.UTF_8));
    assertTrue(own.filename().matches("^Payslip_HR-EMP-\\d{5}_2026-08\\.pdf$"), own.filename());
    assertNull(payslips.getPayslipFileFor(p.ravi().id(), false, id));
  }

  @Test
  void anAdminCanDownloadAnyPayslip() {
    People p = setup();
    service(OK).generate(input(p.priya().id()));
    service(OK).generate(input(p.ravi().id()));
    for (var r : db.query("select id from payslips")) assertNotNull(payslips.getPayslipFileFor(p.admin().id(), true, r.str("id")));
  }

  @Test
  void anUnknownOrMadeUpIdIsNotFound() {
    People p = setup();
    assertNull(payslips.getPayslipFileFor(p.admin().id(), true, "00000000-0000-4000-8000-000000000000"));
    assertNull(payslips.getPayslipFileFor(p.admin().id(), true, "not-a-uuid"));
  }

  @Test
  void listsAnEmployeeSeesOnlyTheirOwnTheAdminSeesTheMonths() {
    People p = setup();
    service(OK).generate(input(p.priya().id()));
    service(OK).generate(input(p.ravi().id()));
    service(OK).generate(input(p.ravi().id(), "0", false, "2026-07"));
    assertEquals(List.of("Priya"), payslips.listPayslipsForEmployee(p.priya().id()).stream().map(PayslipStore.PayslipSummary::employeeName).toList());
    assertEquals(List.of("2026-08-01", "2026-07-01"), payslips.listPayslipsForEmployee(p.ravi().id()).stream().map(PayslipStore.PayslipSummary::periodMonth).toList());
    assertEquals(2, payslips.listPayslipsForMonth("2026-08-01").size());
    assertFalse(payslips.listPayslipsForMonth("2026-08-01").get(0).toString().contains("pdf"));
  }

  @Test
  void theDatabaseRefusesADeductionAboveTheBasicEvenIfTheCodeIsBypassed() {
    People p = setup();
    assertThrows(DbException.class, () -> db.query(
        "insert into payslips (employee_id, period_month, basic, deduction, net, amount_in_words, pdf) values ($1, '2026-08-01', 100, 200, -100, 'x', 'x')", p.priya().id()));
  }

  @Test
  void removingAnEmployeeDeletesTheirPayslipsAndNobodyElses() {
    People p = setup();
    service(OK).generate(input(p.priya().id()));
    service(OK).generate(input(p.ravi().id()));
    assertTrue(store.deleteEmployee(p.priya().id()));
    assertEquals(List.of(p.ravi().id()), db.query("select employee_id from payslips").stream().map(r -> r.str("employee_id")).toList());
  }

  @Test
  void theGeneratedOnDateIsTheIstCalendarDay() {
    People p = setup();
    service(OK).generate(input(p.priya().id()));
    String today = java.time.LocalDate.now(app.lumiether.domain.Dates.APP_TIME_ZONE).toString();
    assertEquals(today, payslips.listPayslipsForMonth("2026-08-01").get(0).generatedOn());
  }

  @Nested
  class Drafts {
    PayslipRenderer render = html -> pdfOf("draft");

    @Test
    void makesAZeroLopDraftOnlyForPeopleWithASalaryAndLeavesTheRestAlone() {
      People p = setup(); // only Priya has a salary
      assertEquals(new PayslipService.DraftResult(1, 0, null), service(render).createDrafts("2026-10"));
      var rows = db.query("select employee_id, basic::text as basic, deduction::text as deduction, net::text as net, published from payslips");
      assertEquals(1, rows.size());
      assertEquals(List.of(p.priya().id(), "16500.00", "0.00", "16500.00", false),
          List.of(rows.get(0).str("employee_id"), rows.get(0).str("basic"), rows.get(0).str("deduction"), rows.get(0).str("net"), rows.get(0).bool("published")));
    }

    @Test
    void runningItAgainCreatesNothingAndNeverOverwrites() {
      setup();
      service(render).createDrafts("2026-10");
      assertEquals(new PayslipService.DraftResult(0, 0, null), service(html -> pdfOf("again")).createDrafts("2026-10"));
      assertEquals("%PDF-1.4 draft", new String(db.query("select pdf from payslips").get(0).bytes("pdf"), StandardCharsets.UTF_8));
    }

    @Test
    void itDoesntMakeAPayslipForSomeoneWhoJoinedAfterThatMonth() {
      People p = setup();
      db.query("update employees set joining_date = '2026-11-15' where id = $1", p.priya().id());
      assertEquals(0, service(render).createDrafts("2026-10").created());
      db.query("update employees set joining_date = '2026-10-31' where id = $1", p.priya().id());
      assertEquals(1, service(render).createDrafts("2026-10").created());
    }

    @Test
    void withThePdfServiceDownItSavesNothingAndSaysSo() {
      setup();
      assertEquals(new PayslipService.DraftResult(0, 0, "PDF service is not running"), service(down()).createDrafts("2026-10"));
      assertEquals(0, count());
    }

    @Test
    void anEmployeeCantListOrDownloadADraftButTheAdminCan() {
      People p = setup();
      service(render).createDrafts("2026-10");
      String id = payslipId();
      assertEquals(List.of(), payslips.listPayslipsForEmployee(p.priya().id()));
      assertNull(payslips.getPayslipFileFor(p.priya().id(), false, id));
      assertNotNull(payslips.getPayslipFileFor(p.admin().id(), true, id));
      assertFalse(payslips.listPayslipsForMonth("2026-10-01").get(0).published());
    }

    @Test
    void publishingMakesItVisibleToItsOwnerOnce() {
      People p = setup();
      service(render).createDrafts("2026-10");
      String id = payslipId();
      assertTrue(payslips.publishPayslip(id));
      assertFalse(payslips.publishPayslip(id));
      assertFalse(payslips.publishPayslip("not-a-uuid"));
      assertEquals(1, payslips.listPayslipsForEmployee(p.priya().id()).size());
      assertNotNull(payslips.getPayslipFileFor(p.priya().id(), false, id));
    }

    @Test
    void generatingOverADraftWithLopNeedsNoConfirmationAndPublishesTheCorrectedPayslip() {
      People p = setup();
      service(render).createDrafts("2026-10");
      var result = service(html -> pdfOf("final")).generate(input(p.priya().id(), "1000", false, "2026-10"));
      assertEquals("replaced", result.kind());
      var rows = db.query("select net::text as net, published, pdf from payslips");
      assertEquals(1, rows.size());
      assertEquals(List.of("15500.00", true, "%PDF-1.4 final"), List.of(rows.get(0).str("net"), rows.get(0).bool("published"), new String(rows.get(0).bytes("pdf"), StandardCharsets.UTF_8)));
    }

    @Test
    void aStopMidwayKeepsWhatWasAlreadyMade() {
      People p = setup();
      db.query("update employees set monthly_salary = 20000 where id = $1", p.ravi().id());
      var calls = new java.util.concurrent.atomic.AtomicInteger();
      var flaky = (PayslipRenderer) html -> {
        if (calls.incrementAndGet() == 2) throw new PdfClient.PdfServiceException();
        return pdfOf("draft");
      };
      assertEquals(new PayslipService.DraftResult(1, 0, "PDF service is not running"), service(flaky).createDrafts("2026-10"));
      assertEquals(1, count());
    }
  }
}
