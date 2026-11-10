package app.lumiether.web;

import static org.junit.jupiter.api.Assertions.*;

import app.lumiether.auth.Auth;
import app.lumiether.auth.Password;
import app.lumiether.auth.Sessions;
import app.lumiether.auth.Token;
import app.lumiether.db.Store;
import app.lumiether.db.TestDb;
import com.fasterxml.jackson.databind.JsonNode;
import io.helidon.webserver.WebServer;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.*;

/**
 * The HTTP layer end to end: a real Helidon server on a free port, a real test database, real cookies. The session is
 * an httpOnly cookie named lr_session, signed with its own secret; state-changing requests must come from an allowed
 * origin and be JSON.
 */
class ApiTest {
  static final String COOKIE_SECRET = "an-api-test-cookie-secret-that-is-long-enough-1234";
  static final String ORIGIN = "http://app.test";
  static final String EVIL = "https://evil.example";
  static final String CRON_SECRET = "an-api-test-cron-secret-1234";
  /** The PDF service is always a fake here; a test swaps it to simulate the service being down. */
  final AtomicReference<app.lumiether.payslip.PayslipRenderer> renderer = new AtomicReference<>(html -> "%PDF-1.4 fake".getBytes());
  /** The team's "today" for every leave rule: a Wednesday. */
  static final java.time.LocalDate TODAY = java.time.LocalDate.parse("2026-11-04");

  WebServer server;
  Store store;
  Auth auth;
  HttpClient http = HttpClient.newHttpClient();
  String base;
  final AtomicReference<Auth.Bootstrap> bootstrap = new AtomicReference<>(new Auth.Bootstrap(null, null));

  void start(String secret, boolean secure) {
    var db = TestDb.reset();
    store = new Store(db);
    auth = new Auth(store, bootstrap::get);
    var api = new Api(store, auth, new Sessions(store, auth, secret), new Api.Settings(secure, List.of(ORIGIN)), () -> TODAY,
        html -> renderer.get().render(html), CRON_SECRET);
    server = WebServer.builder().port(0).routing(api::register).build().start();
    base = "http://localhost:" + server.port();
  }

  @BeforeEach
  void setUp() {
    TestDb.requireDatabase();
    bootstrap.set(new Auth.Bootstrap(null, null));
    start(COOKIE_SECRET, false);
  }

  @AfterEach
  void tearDown() {
    if (server != null) server.stop();
  }

  record Res(int status, JsonNode body, String raw, List<String> setCookies, java.net.http.HttpHeaders headers) {
    /** The value of the lr_session cookie this response sets, or null. */
    String sessionCookie() {
      for (String c : setCookies) if (c.startsWith("lr_session=")) return c.substring("lr_session=".length(), c.indexOf(';'));
      return null;
    }

    String sessionSetCookie() {
      return setCookies.stream().filter(c -> c.startsWith("lr_session=")).findFirst().orElse(null);
    }
  }

  /** Sends exactly the headers given, nothing added. */
  Res send(String method, String path, Map<String, String> headers, String body) throws Exception {
    var b = HttpRequest.newBuilder(URI.create(base + path));
    headers.forEach(b::header);
    var publisher = body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body);
    var r = http.send(b.method(method, publisher).build(), HttpResponse.BodyHandlers.ofString());
    JsonNode json = null;
    if (!r.body().isBlank()) {
      try {
        json = Json.MAPPER.readTree(r.body());
      } catch (Exception notJson) {
        // plain-text answers (a 404 from the server itself) have no JSON body
      }
    }
    return new Res(r.statusCode(), json, r.body(), r.headers().allValues("set-cookie"), r.headers());
  }

  /** A browser-like call from the allowed origin: JSON, with the session cookie if one is given. */
  Res call(String method, String path, String cookie, Object body) throws Exception {
    Map<String, String> h = new LinkedHashMap<>();
    h.put("Origin", ORIGIN);
    h.put("Content-Type", "application/json");
    if (cookie != null) h.put("Cookie", "lr_session=" + cookie);
    return send(method, path, h, body == null ? null : Json.write(body));
  }

  /** Signs in and returns the lr_session cookie value. */
  String signIn(String email, String password) throws Exception {
    Res r = call("POST", "/api/auth/login", null, Map.of("email", email, "password", password));
    assertEquals(200, r.status(), r.raw());
    assertNotNull(r.sessionCookie(), "the response must set the lr_session cookie");
    return r.sessionCookie();
  }

  void makeAdmin(String name) {
    store.createAdmin(name, name.toLowerCase() + "@example.com", Password.hash("admin-pass-1"));
  }

  void makeEmployee(String name) {
    store.createEmployee(Store.NewEmployee.of(name, name.toLowerCase() + "@gmail.com", "2000-01-01", Password.hash("temp-pass-1")));
  }

  // ------------------------------------------------------------------ health

  @Test
  void healthIsOpenAndAnswersHeadToo() throws Exception {
    assertEquals(200, send("GET", "/api/health", Map.of(), null).status());
    assertEquals(200, send("HEAD", "/api/health", Map.of(), null).status()); // load balancers often probe with HEAD
  }

  // ----------------------------------------------------------------- sign-in

  @Test
  void aFailedSignInGivesOneGenericMessageWhateverTheReasonAndSetsNoCookie() throws Exception {
    makeEmployee("Priya");
    Res wrongPassword = call("POST", "/api/auth/login", null, Map.of("email", "priya@gmail.com", "password", "nope"));
    Res unknownEmail = call("POST", "/api/auth/login", null, Map.of("email", "nobody@gmail.com", "password", "nope"));
    Res empty = call("POST", "/api/auth/login", null, Map.of("email", "", "password", ""));
    for (Res r : new Res[] {wrongPassword, unknownEmail, empty}) {
      assertEquals(401, r.status());
      assertEquals(Api.FAILED, r.body().get("error").asText());
      assertTrue(r.setCookies().isEmpty(), "no cookie on a failed sign-in");
    }
    assertEquals(wrongPassword.raw(), unknownEmail.raw());
  }

  @Test
  void signingInSetsAnHttpOnlyCookieAndNeverPutsTheTokenInTheBody() throws Exception {
    makeEmployee("Priya");
    Res login = call("POST", "/api/auth/login", null, Map.of("email", "Priya@Gmail.com", "password", "temp-pass-1"));
    assertEquals(200, login.status());
    assertEquals("employee", login.body().at("/user/role").asText());
    assertFalse(login.body().has("token"), "the token must not be in the response body");
    assertFalse(login.raw().contains(login.sessionCookie()), "the cookie value must not appear in the body");
    assertFalse(login.raw().contains("passwordHash"));

    String c = login.sessionSetCookie();
    for (String attr : new String[] {"Path=/", "Max-Age=604800", "HttpOnly", "SameSite=Lax"}) assertTrue(c.contains(attr), attr + " in " + c);
    assertFalse(c.contains("Secure"), "Secure is off in this test's config");

    Res me = call("GET", "/api/auth/me", login.sessionCookie(), null);
    assertEquals("priya@gmail.com", me.body().at("/user/email").asText());
    assertFalse(me.raw().toLowerCase().contains("allowance"));
  }

  @Test
  void theSecureAttributeFollowsTheConfig() throws Exception {
    tearDown();
    start(COOKIE_SECRET, true);
    makeEmployee("Priya");
    Res login = call("POST", "/api/auth/login", null, Map.of("email", "priya@gmail.com", "password", "temp-pass-1"));
    assertTrue(login.sessionSetCookie().contains("; Secure"), login.sessionSetCookie());
    assertTrue(login.sessionSetCookie().contains("HttpOnly"));
  }

  @Test
  void withoutAUsableCookieSecretNobodyCanSignIn() throws Exception {
    tearDown();
    start(null, false);
    makeEmployee("Priya");
    Res r = call("POST", "/api/auth/login", null, Map.of("email", "priya@gmail.com", "password", "temp-pass-1"));
    assertEquals(401, r.status());
    assertEquals(Api.FAILED, r.body().get("error").asText());
    assertTrue(r.setCookies().isEmpty());
    tearDown();
    start("too-short", false);
    assertEquals(401, call("POST", "/api/auth/login", null, Map.of("email", "priya@gmail.com", "password", "temp-pass-1")).status());
  }

  // ------------------------------------------------------------ who may do what

  @Test
  void signedOutIs401AndTheWrongRoleIs403() throws Exception {
    makeAdmin("Boss");
    makeEmployee("Priya");
    assertEquals(401, call("GET", "/api/auth/me", null, null).status());
    assertEquals(401, call("GET", "/api/auth/me", "garbage", null).status());
    assertEquals(401, call("GET", "/api/admin/admins", null, null).status());
    String employee = signIn("priya@gmail.com", "temp-pass-1");
    assertEquals(403, call("GET", "/api/admin/admins", employee, null).status());
    assertEquals(403, call("POST", "/api/admin/admins", employee, Map.of("email", "x@y.com", "password", "temp-pass-1")).status());
    assertEquals(403, call("DELETE", "/api/admin/admins/00000000-0000-4000-8000-000000000001", employee, null).status());
    String admin = signIn("boss@example.com", "admin-pass-1");
    assertEquals(200, call("GET", "/api/admin/admins", admin, null).status());
  }

  @Test
  void theRoleComesFromTheAccountNotTheCookie() throws Exception {
    makeAdmin("Boss");
    makeEmployee("Priya");
    String employee = signIn("priya@gmail.com", "temp-pass-1");
    String signature = employee.split("\\.")[1];
    String forgedBody = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(
        ("{\"sub\":\"" + store.listAdmins().get(0).id() + "\",\"role\":\"admin\",\"exp\":4102444800,\"v\":\"x\"}").getBytes());
    assertEquals(401, call("GET", "/api/admin/admins", forgedBody + "." + signature, null).status());
  }

  @Test
  void aBearerHeaderNoLongerSignsAnyoneIn() throws Exception {
    makeEmployee("Priya");
    String cookie = signIn("priya@gmail.com", "temp-pass-1");
    Res viaBearer = send("GET", "/api/auth/me", Map.of("Authorization", "Bearer " + cookie, "Origin", ORIGIN), null);
    assertEquals(401, viaBearer.status());
    assertEquals(200, call("GET", "/api/auth/me", cookie, null).status()); // the same token as a cookie works
  }

  @Test
  void aCookieSignedWithAnotherSecretIsRejectedEvenWithTheRightUserAndFingerprint() throws Exception {
    makeEmployee("Priya");
    var e = store.findEmployeeByEmail("priya@gmail.com").orElseThrow();
    var payload = new Token.Payload(e.employee().id(), Token.Role.employee, System.currentTimeMillis() / 1000 + 600,
        Token.passwordFingerprint(e.passwordHash()));
    // control: the same payload signed with the cookie secret is accepted, so the test is not passing for another reason
    assertEquals(200, call("GET", "/api/auth/me", Token.sign(payload, COOKIE_SECRET), null).status());
    // a token signed with the Node app's retired SESSION_SECRET (or any other secret) is not
    assertEquals(401, call("GET", "/api/auth/me", Token.sign(payload, "the-retired-session-secret-0123456789abcdef"), null).status());
  }

  // ------------------------------------------------------------------ admins

  @Test
  void addingAndRemovingAdmins() throws Exception {
    makeAdmin("Boss");
    String token = signIn("boss@example.com", "admin-pass-1");

    Res created = call("POST", "/api/admin/admins", token, Map.of("email", "Second.Admin@Company.co", "password", "temp-pass-1"));
    assertEquals(201, created.status());
    assertEquals("Second Admin", created.body().at("/created/name").asText());
    assertNotNull(signIn("second.admin@company.co", "temp-pass-1")); // the new admin can sign in with the temporary password

    Res dup = call("POST", "/api/admin/admins", token, Map.of("email", "SECOND.admin@company.co", "password", "temp-pass-1"));
    assertEquals(422, dup.status());
    assertEquals("Someone already uses this email.", dup.body().at("/errors/email").asText());
    assertEquals("SECOND.admin@company.co", dup.body().at("/values/email").asText());

    Res bad = call("POST", "/api/admin/admins", token, Map.of("email", "nope", "password", "short"));
    assertEquals(422, bad.status());
    assertTrue(bad.body().at("/errors").has("email") && bad.body().at("/errors").has("password"));

    JsonNode list = call("GET", "/api/admin/admins", token, null).body().get("admins");
    assertEquals(2, list.size());
    assertFalse(list.toString().contains("password"));
    String bossId = list.get(0).get("id").asText();
    String secondId = list.get(1).get("id").asText();

    Res self = call("DELETE", "/api/admin/admins/" + bossId, token, null);
    assertEquals(409, self.status());
    assertTrue(self.body().get("error").asText().contains("own admin account"));

    String secondToken = signIn("second.admin@company.co", "temp-pass-1");
    assertEquals(200, call("DELETE", "/api/admin/admins/" + secondId, token, null).status());
    assertEquals(401, call("GET", "/api/auth/me", secondToken, null).status()); // the removed admin is signed out
    assertEquals(409, call("DELETE", "/api/admin/admins/" + bossId, token, null).status()); // and the last admin can't go
  }

  // --------------------------------------------------------------- employees

  static Map<String, Object> newEmployee(String email) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("email", email);
    m.put("joiningDate", "2026-01-05");
    m.put("category", "intern");
    m.put("monthlySalary", "16500.5");
    m.put("designation", "  Engineer ");
    m.put("password", "temp-pass-1");
    return m;
  }

  @Test
  void theEmployeeRoutesAreForAdminsOnly() throws Exception {
    makeAdmin("Boss");
    makeEmployee("Priya");
    String id = store.getEmployees().get(0).id();
    String employee = signIn("priya@gmail.com", "temp-pass-1");
    for (String[] route : new String[][] {
      {"GET", "/api/admin/employees"}, {"POST", "/api/admin/employees"},
      {"PATCH", "/api/admin/employees/" + id + "/category"}, {"PATCH", "/api/admin/employees/" + id + "/payroll"},
      {"DELETE", "/api/admin/employees/" + id}}) {
      assertEquals(401, call(route[0], route[1], null, Map.of()).status(), "signed out: " + route[1]);
      assertEquals(403, call(route[0], route[1], employee, Map.of()).status(), "employee: " + route[1]);
    }
    assertEquals(1, store.getEmployees().size()); // and nothing happened
  }

  @Test
  void addingAnEmployeeSavesCleanedValuesDerivesTheNameAndLetsThemSignInWithTheTemporaryPassword() throws Exception {
    makeAdmin("Boss");
    String admin = signIn("boss@example.com", "admin-pass-1");
    Res created = call("POST", "/api/admin/employees", admin, newEmployee(" Priya.Sharma@Gmail.com "));
    assertEquals(201, created.status(), created.raw());
    assertEquals("Priya Sharma", created.body().at("/created/name").asText());
    assertEquals("priya.sharma@gmail.com", created.body().at("/created/email").asText());
    assertFalse(created.raw().contains("temp-pass-1"));

    JsonNode e = call("GET", "/api/admin/employees", admin, null).body().at("/employees/0");
    assertEquals("intern", e.get("category").asText());
    assertEquals("2026-01-05", e.get("joiningDate").asText());
    assertEquals("16500.50", e.get("monthlySalary").asText());
    assertEquals("Engineer", e.get("designation").asText());
    assertFalse(e.toString().contains("assword"));

    String own = signIn("priya.sharma@gmail.com", "temp-pass-1");
    assertEquals("employee", call("GET", "/api/auth/me", own, null).body().at("/user/role").asText());
  }

  @Test
  void aBadEmployeeIsRefusedWithEveryMessageAtOnceAndNothingIsSaved() throws Exception {
    makeAdmin("Boss");
    String admin = signIn("boss@example.com", "admin-pass-1");
    Map<String, Object> bad = new LinkedHashMap<>(newEmployee("someone@yahoo.com"));
    bad.put("joiningDate", "1999-12-31");
    bad.put("category", "manager");
    bad.put("password", "short");
    bad.put("monthlySalary", "0");
    bad.put("designation", "x".repeat(101));
    Res r = call("POST", "/api/admin/employees", admin, bad);
    assertEquals(422, r.status());
    JsonNode errors = r.body().get("errors");
    assertEquals("Enter a Gmail address, like name@gmail.com.", errors.get("email").asText());
    assertEquals("That joining date is too far back.", errors.get("joiningDate").asText());
    assertEquals("Choose a category.", errors.get("category").asText());
    assertEquals("Use at least 8 characters.", errors.get("password").asText());
    assertEquals("Enter a positive amount with at most two decimals, like 16500 or 16500.50.", errors.get("monthlySalary").asText());
    assertEquals("Use at most 100 characters.", errors.get("designation").asText());
    // the fields keep what was typed, but the password is never sent back
    assertEquals("someone@yahoo.com", r.body().at("/values/email").asText());
    assertEquals("1999-12-31", r.body().at("/values/joiningDate").asText());
    assertFalse(r.body().get("values").has("password"));
    assertFalse(r.raw().contains("short"));
    assertEquals(0, store.getEmployees().size());
  }

  @Test
  void anEmailAnAdminOrEmployeeAlreadyUsesCantBeUsedForAnEmployeeWhateverItsCase() throws Exception {
    makeAdmin("Boss");
    makeEmployee("Priya");
    String admin = signIn("boss@example.com", "admin-pass-1");
    Res dup = call("POST", "/api/admin/employees", admin, newEmployee("PRIYA@gmail.com"));
    assertEquals(422, dup.status());
    assertEquals("Someone already uses this email.", dup.body().at("/errors/email").asText());
    // an admin's address would be refused for being non-Gmail first; an employee address equal to the bootstrap email is taken
    bootstrap.set(new Auth.Bootstrap("boot@gmail.com", Password.hash("env-password-1")));
    Res boot = call("POST", "/api/admin/employees", admin, newEmployee("Boot@Gmail.com"));
    assertEquals("Someone already uses this email.", boot.body().at("/errors/email").asText());
    assertEquals(1, store.getEmployees().size());
  }

  @Test
  void changingACategoryNeedsARealCategoryAndARealEmployee() throws Exception {
    makeAdmin("Boss");
    makeEmployee("Priya");
    String admin = signIn("boss@example.com", "admin-pass-1");
    String id = store.getEmployees().get(0).id();
    assertEquals(200, call("PATCH", "/api/admin/employees/" + id + "/category", admin, Map.of("category", "student")).status());
    assertEquals("student", store.getEmployees().get(0).category());
    Res bad = call("PATCH", "/api/admin/employees/" + id + "/category", admin, Map.of("category", "manager"));
    assertEquals(422, bad.status());
    assertEquals("Choose a category.", bad.body().get("error").asText());
    Res gone = call("PATCH", "/api/admin/employees/00000000-0000-4000-8000-000000000001/category", admin, Map.of("category", "intern"));
    assertEquals(404, gone.status());
    assertEquals("That employee no longer exists.", gone.body().get("error").asText());
    assertEquals(404, call("PATCH", "/api/admin/employees/not-a-uuid/category", admin, Map.of("category", "intern")).status());
    assertEquals("student", store.getEmployees().get(0).category());
  }

  @Test
  void payrollDetailsAreValidatedSavedTrimmedAndClearedByBlankFields() throws Exception {
    makeAdmin("Boss");
    makeEmployee("Priya");
    String admin = signIn("boss@example.com", "admin-pass-1");
    String path = "/api/admin/employees/" + store.getEmployees().get(0).id() + "/payroll";
    assertEquals(200, call("PATCH", path, admin, Map.of("monthlySalary", " 1,65,000 ", "designation", " Lead ")).status());
    assertEquals("165000.00", store.listEmployeesWithPayroll().get(0).monthlySalary());
    Res bad = call("PATCH", path, admin, Map.of("monthlySalary", "12.345", "designation", "ok"));
    assertEquals(422, bad.status());
    assertEquals("Enter a positive amount with at most two decimals, like 16500 or 16500.50.", bad.body().at("/errors/monthlySalary").asText());
    assertEquals("Lead", store.listEmployeesWithPayroll().get(0).designation()); // a refused save changes nothing
    assertEquals(200, call("PATCH", path, admin, Map.of("monthlySalary", "", "designation", "  ")).status());
    assertNull(store.listEmployeesWithPayroll().get(0).monthlySalary());
    assertNull(store.listEmployeesWithPayroll().get(0).designation());
    Res gone = call("PATCH", "/api/admin/employees/00000000-0000-4000-8000-000000000001/payroll", admin, Map.of("monthlySalary", "", "designation", ""));
    assertEquals(404, gone.status());
    assertEquals("That employee no longer exists.", gone.body().get("error").asText());
  }

  @Test
  void removingAnEmployeeSignsThemOutAndAskingAgainSaysTheyAreGone() throws Exception {
    makeAdmin("Boss");
    makeEmployee("Priya");
    String admin = signIn("boss@example.com", "admin-pass-1");
    String own = signIn("priya@gmail.com", "temp-pass-1");
    String id = store.getEmployees().get(0).id();
    assertEquals(200, call("DELETE", "/api/admin/employees/" + id, admin, null).status());
    assertEquals(401, call("GET", "/api/auth/me", own, null).status());
    Res again = call("DELETE", "/api/admin/employees/" + id, admin, null);
    assertEquals(404, again.status());
    assertEquals("That employee no longer exists.", again.body().get("error").asText());
    assertEquals(0, store.getEmployees().size());
  }

  // ------------------------------------------------------- leave and comp-off

  /** An admin and one employee, both signed in. */
  record Pair(String admin, String employee) {}

  Pair adminAndEmployee() throws Exception {
    makeAdmin("Boss");
    makeEmployee("Priya");
    return new Pair(signIn("boss@example.com", "admin-pass-1"), signIn("priya@gmail.com", "temp-pass-1"));
  }

  static Map<String, Object> leaveBody(String type, String from, String to, String len) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("type", type);
    m.put("from", from);
    m.put("to", to);
    m.put("dayLength", len);
    return m;
  }

  String apply(String cookie, String from, String to) throws Exception {
    Res r = call("POST", "/api/employee/leave", cookie, leaveBody("Casual leave", from, to, "full"));
    assertEquals(201, r.status(), r.raw());
    return call("GET", "/api/employee/leave", cookie, null).body().at("/requests/0/id").asText();
  }

  @Test
  void theLeaveRoutesKeepEachRoleToItsOwnSide() throws Exception {
    var p = adminAndEmployee();
    for (String[] route : new String[][] {
      {"GET", "/api/employee/dashboard"}, {"GET", "/api/employee/leave"}, {"POST", "/api/employee/leave"}, {"GET", "/api/employee/comp-off"},
      {"POST", "/api/employee/comp-off"}, {"GET", "/api/employee/permissions"}, {"POST", "/api/employee/permissions"}}) {
      assertEquals(401, call(route[0], route[1], null, Map.of()).status(), "signed out " + route[1]);
      assertEquals(403, call(route[0], route[1], p.admin(), Map.of()).status(), "admin on " + route[1]);
    }
    for (String[] route : new String[][] {
      {"GET", "/api/admin/dashboard"}, {"GET", "/api/admin/leave"}, {"GET", "/api/admin/comp-off"}, {"GET", "/api/admin/permissions"},
      {"GET", "/api/admin/leave-policy"}, {"PUT", "/api/admin/leave-policy"}, {"POST", "/api/admin/requests/00000000-0000-4000-8000-000000000001/decision"}}) {
      assertEquals(401, call(route[0], route[1], null, Map.of()).status(), "signed out " + route[1]);
      assertEquals(403, call(route[0], route[1], p.employee(), Map.of()).status(), "employee on " + route[1]);
    }
    assertEquals(401, call("GET", "/api/holidays", null, null).status());
    assertEquals(200, call("GET", "/api/holidays", p.employee(), null).status());
    assertEquals(200, call("GET", "/api/holidays", p.admin(), null).status());
  }

  @Test
  void holidaysAreTheFourNationalOnesNextOccurrenceFirst() throws Exception {
    var p = adminAndEmployee();
    JsonNode list = call("GET", "/api/holidays", p.employee(), null).body().get("holidays");
    assertEquals(List.of("Republic Day", "Labour Day", "Independence Day", "Gandhi Jayanti").size(), list.size());
    assertEquals("Republic Day", list.get(0).get("name").asText()); // from 4 Nov 2026 the next one is 26 Jan 2027
    assertEquals("2027-01-26", list.get(0).get("date").asText());
    assertEquals(83, list.get(0).get("daysAway").asInt());
    assertEquals("Gandhi Jayanti", list.get(3).get("name").asText());
    assertEquals("2027-10-02", list.get(3).get("date").asText());
  }

  @Test
  void anEmployeeAppliesForLeaveAndSeesItWithItsWorkingDaysAndNothingAboutTheirAllowance() throws Exception {
    var p = adminAndEmployee();
    Res ok = call("POST", "/api/employee/leave", p.employee(), leaveBody("Casual leave", "2026-11-13", "2026-11-16", "full")); // Fri to Mon
    assertEquals(201, ok.status(), ok.raw());
    assertEquals("2026-11-16", ok.body().at("/submitted/to").asText());
    JsonNode row = call("GET", "/api/employee/leave", p.employee(), null).body().at("/requests/0");
    assertEquals(List.of("Casual leave", "pending", 2.0), List.of(row.get("type").asText(), row.get("status").asText(), row.get("days").asDouble()));
    assertEquals("2026-11-04", row.get("appliedOn").asText());
    assertEquals("withdraw", row.get("cancel").asText());
    String all = ok.raw() + call("GET", "/api/employee/dashboard", p.employee(), null).raw() + call("GET", "/api/employee/leave", p.employee(), null).raw();
    for (String secret : List.of("leaveAllowance", "remaining", "daysPerYear", "balance", "compOffExpired")) assertFalse(all.contains(secret), secret);
  }

  @Test
  void aHalfDayIsSavedAsOneDayWhateverTheToDate() throws Exception {
    var p = adminAndEmployee();
    Res r = call("POST", "/api/employee/leave", p.employee(), leaveBody("Sick leave", "2026-11-16", "2026-11-20", "half"));
    assertEquals(201, r.status());
    assertTrue(r.body().at("/submitted/halfDay").asBoolean());
    JsonNode row = call("GET", "/api/employee/leave", p.employee(), null).body().at("/requests/0");
    assertEquals(List.of("2026-11-16", "2026-11-16", 0.5), List.of(row.get("from").asText(), row.get("to").asText(), row.get("days").asDouble()));
  }

  @Test
  void badLeaveIsRefusedWithTheCurrentAppsMessagesAndTheDatesComeBack() throws Exception {
    var p = adminAndEmployee();
    Res r = call("POST", "/api/employee/leave", p.employee(), leaveBody("Comp-off", "2026-11-18", "2026-11-16", "full"));
    assertEquals(422, r.status());
    assertEquals("Choose casual or sick leave.", r.body().at("/errors/type").asText());
    assertEquals("The end date can't be before the start date.", r.body().at("/errors/to").asText());
    assertEquals("2026-11-18", r.body().at("/values/from").asText());
    Res weekend = call("POST", "/api/employee/leave", p.employee(), leaveBody("Casual leave", "2026-11-14", "2026-11-15", "full"));
    assertEquals("Those dates are all weekends or national holidays, so there's nothing to take off.", weekend.body().at("/errors/form").asText());
    assertEquals(0, call("GET", "/api/employee/leave", p.employee(), null).body().get("requests").size());
    // a missing dayLength means a full day, as in the current app
    Map<String, Object> noLength = leaveBody("Casual leave", "2026-11-16", "2026-11-16", "full");
    noLength.remove("dayLength");
    assertEquals(201, call("POST", "/api/employee/leave", p.employee(), noLength).status());
  }

  @Test
  void leaveThatOverdrawsTheBalanceIsBlockedWithoutSayingByHowMuch() throws Exception {
    var p = adminAndEmployee();
    store.db().query("update leave_categories set days_per_year = 3 where category = 'employee'");
    Res r = call("POST", "/api/employee/leave", p.employee(), leaveBody("Casual leave", "2026-11-16", "2026-11-19", "full")); // 4 working days
    assertEquals(422, r.status());
    String msg = r.body().at("/errors/form").asText();
    assertTrue(msg.contains("enough leave"));
    assertFalse(msg.matches(".*\\d.*"), msg);
    assertEquals(201, call("POST", "/api/employee/leave", p.employee(), leaveBody("Casual leave", "2026-11-16", "2026-11-18", "full")).status());
  }

  @Test
  void anOverlappingRequestIsRefused() throws Exception {
    var p = adminAndEmployee();
    apply(p.employee(), "2026-11-16", "2026-11-18");
    Res r = call("POST", "/api/employee/leave", p.employee(), leaveBody("Sick leave", "2026-11-18", "2026-11-19", "full"));
    assertEquals("You already have leave that overlaps these dates.", r.body().at("/errors/form").asText());
  }

  @Test
  void pendingLeaveIsWithdrawnAtOnceAndAnApprovedOneBecomesACancellationTheAdminDecides() throws Exception {
    var p = adminAndEmployee();
    String pending = apply(p.employee(), "2026-11-16", "2026-11-16");
    Res withdrawn = call("POST", "/api/employee/leave/" + pending + "/cancel", p.employee(), null);
    assertEquals("withdraw", withdrawn.body().get("action").asText());
    assertEquals("cancelled", call("GET", "/api/employee/leave", p.employee(), null).body().at("/requests/0/status").asText());
    assertEquals(0, call("GET", "/api/admin/dashboard", p.admin(), null).body().get("pending").size()); // nothing for the admin to do

    String approved = apply(p.employee(), "2026-11-17", "2026-11-17");
    assertEquals(200, call("POST", "/api/admin/requests/" + approved + "/decision", p.admin(), Map.of("decision", "approved")).status());
    Res asked = call("POST", "/api/employee/leave/" + approved + "/cancel", p.employee(), null);
    assertEquals("request", asked.body().get("action").asText());
    JsonNode waiting = call("GET", "/api/admin/dashboard", p.admin(), null).body().at("/pending/0");
    assertEquals(List.of(approved, true, "approved"), List.of(waiting.get("id").asText(), waiting.get("cancelRequested").asBoolean(), waiting.get("status").asText()));
    assertEquals(409, call("POST", "/api/employee/leave/" + approved + "/cancel", p.employee(), null).status()); // not twice

    assertEquals(200, call("POST", "/api/admin/requests/" + approved + "/decision", p.admin(), Map.of("decision", "approved")).status()); // approve the cancellation
    JsonNode done = call("GET", "/api/employee/leave", p.employee(), null).body().get("requests");
    assertTrue(StreamSupport_anyMatch(done, "cancelled"));
    assertEquals(0, call("GET", "/api/admin/dashboard", p.admin(), null).body().get("pending").size());
  }

  static boolean StreamSupport_anyMatch(JsonNode rows, String status) {
    for (JsonNode r : rows) if (r.get("status").asText().equals(status)) return true;
    return false;
  }

  @Test
  void rejectingACancellationKeepsTheLeave() throws Exception {
    var p = adminAndEmployee();
    String id = apply(p.employee(), "2026-11-17", "2026-11-17");
    call("POST", "/api/admin/requests/" + id + "/decision", p.admin(), Map.of("decision", "approved"));
    call("POST", "/api/employee/leave/" + id + "/cancel", p.employee(), null);
    assertEquals(200, call("POST", "/api/admin/requests/" + id + "/decision", p.admin(), Map.of("decision", "rejected")).status());
    JsonNode row = call("GET", "/api/employee/leave", p.employee(), null).body().at("/requests/0");
    assertEquals(List.of("approved", false), List.of(row.get("status").asText(), row.get("cancelRequested").asBoolean()));
    assertEquals("request", row.get("cancel").asText()); // and they may ask again
  }

  @Test
  void leaveThatHasStartedCantBeCancelledAndNobodyCancelsSomeoneElsesLeave() throws Exception {
    var p = adminAndEmployee();
    makeEmployee("Other");
    String other = signIn("other@gmail.com", "temp-pass-1");
    String id = apply(p.employee(), "2026-11-02", "2026-11-03"); // already started
    call("POST", "/api/admin/requests/" + id + "/decision", p.admin(), Map.of("decision", "approved"));
    Res started = call("POST", "/api/employee/leave/" + id + "/cancel", p.employee(), null);
    assertEquals(409, started.status());
    assertEquals("This leave has already started, so it can't be cancelled.", started.body().get("error").asText());
    assertNull(call("GET", "/api/employee/leave", p.employee(), null).body().at("/requests/0/cancel").textValue());

    String pendingId = apply(p.employee(), "2026-11-17", "2026-11-17");
    Res theirs = call("POST", "/api/employee/leave/" + pendingId + "/cancel", other, null);
    assertEquals("We couldn't find that request.", theirs.body().get("error").asText());
    assertEquals(0, call("GET", "/api/employee/leave", other, null).body().get("requests").size());
  }

  @Test
  void anAdminDecisionNeedsApproveOrRejectAndSomethingWaiting() throws Exception {
    var p = adminAndEmployee();
    String id = apply(p.employee(), "2026-11-17", "2026-11-17");
    assertEquals(422, call("POST", "/api/admin/requests/" + id + "/decision", p.admin(), Map.of("decision", "cancelled")).status());
    assertEquals(200, call("POST", "/api/admin/requests/" + id + "/decision", p.admin(), Map.of("decision", "rejected")).status());
    Res again = call("POST", "/api/admin/requests/" + id + "/decision", p.admin(), Map.of("decision", "approved"));
    assertEquals(409, again.status());
    assertEquals("That request is no longer waiting for a decision.", again.body().get("error").asText());
    assertEquals(409, call("POST", "/api/admin/requests/not-a-uuid/decision", p.admin(), Map.of("decision", "approved")).status());
    assertEquals("rejected", call("GET", "/api/employee/leave", p.employee(), null).body().at("/requests/0/status").asText());
  }

  @Test
  void compOffIsClaimedApprovedAndThenShowsUpAsAvailableOnTheEmployeeDashboard() throws Exception {
    var p = adminAndEmployee();
    Res claim = call("POST", "/api/employee/comp-off", p.employee(), Map.of("workedOn", "2026-10-31", "dayLength", "full")); // a Saturday
    assertEquals(201, claim.status(), claim.raw());
    JsonNode row = call("GET", "/api/employee/comp-off", p.employee(), null).body().at("/requests/0");
    assertEquals(List.of("Comp-off", "pending", 1.0, "2027-01-01"), List.of(row.get("type").asText(), row.get("status").asText(), row.get("days").asDouble(), row.get("expiresOn").asText()));
    assertTrue(call("GET", "/api/employee/leave", p.employee(), null).body().get("requests").isEmpty()); // not in the leave list
    JsonNode before = call("GET", "/api/employee/dashboard", p.employee(), null).body().get("compOff");
    assertEquals(List.of(0.0, 1.0), List.of(before.get("available").asDouble(), before.get("waiting").asDouble()));

    assertEquals(200, call("POST", "/api/admin/requests/" + row.get("id").asText() + "/decision", p.admin(), Map.of("decision", "approved")).status());
    JsonNode after = call("GET", "/api/employee/dashboard", p.employee(), null).body().get("compOff");
    assertEquals(List.of(1.0, 0.0), List.of(after.get("available").asDouble(), after.get("waiting").asDouble()));
  }

  @Test
  void compOffClaimsAreRefusedWithTheCurrentAppsMessages() throws Exception {
    var p = adminAndEmployee();
    assertEquals("That was a working day, so it doesn't earn comp-off. Pick a weekend or a national holiday.",
        call("POST", "/api/employee/comp-off", p.employee(), Map.of("workedOn", "2026-11-03", "dayLength", "full")).body().at("/errors/workedOn").asText());
    assertEquals("That day hasn't happened yet.",
        call("POST", "/api/employee/comp-off", p.employee(), Map.of("workedOn", "2026-11-07", "dayLength", "full")).body().at("/errors/workedOn").asText());
    assertEquals(201, call("POST", "/api/employee/comp-off", p.employee(), Map.of("workedOn", "2026-10-31", "dayLength", "half")).status());
    Res dup = call("POST", "/api/employee/comp-off", p.employee(), Map.of("workedOn", "2026-10-31", "dayLength", "full"));
    assertEquals("You've already claimed comp-off for that day.", dup.body().at("/errors/workedOn").asText());
    assertEquals("2026-10-31", dup.body().at("/values/workedOn").asText());
  }

  @Test
  void permissionsAreLoggedByTheEmployeeSeenByTheAdminAndNeverDeducted() throws Exception {
    var p = adminAndEmployee();
    Map<String, Object> body = Map.of("date", "2026-11-05", "from", "10:00", "to", "11:30", "reason", "Bank work");
    assertEquals(201, call("POST", "/api/employee/permissions", p.employee(), body).status());
    JsonNode mine = call("GET", "/api/employee/permissions", p.employee(), null).body().at("/permissions/0");
    assertEquals(List.of(90, "Bank work"), List.of(mine.get("minutes").asInt(), mine.get("reason").asText()));
    JsonNode admin = call("GET", "/api/admin/permissions", p.admin(), null).body().at("/permissions/0");
    assertEquals(List.of("Priya", "2026-11-05"), List.of(admin.get("employeeName").asText(), admin.get("date").asText()));
    Res overlap = call("POST", "/api/employee/permissions", p.employee(), Map.of("date", "2026-11-05", "from", "11:00", "to", "12:00", "reason", ""));
    assertEquals(422, overlap.status());
    assertEquals("You already have a permission that overlaps this time.", overlap.body().at("/errors/form").asText());
    assertEquals("11:00", overlap.body().at("/values/from").asText());
    JsonNode balance = call("GET", "/api/admin/dashboard", p.admin(), null).body().at("/balances/0");
    assertEquals(List.of(0.0, 24.0), List.of(balance.get("used").asDouble(), balance.get("remaining").asDouble()));
  }

  @Test
  void theAdminDashboardShowsWaitingRequestsWhoIsOutTheMonthlyChartAndEveryBalance() throws Exception {
    var p = adminAndEmployee();
    String id = apply(p.employee(), "2026-11-04", "2026-11-05"); // today and tomorrow
    call("POST", "/api/admin/requests/" + id + "/decision", p.admin(), Map.of("decision", "approved"));
    apply(p.employee(), "2026-12-01", "2026-12-01"); // pending
    JsonNode d = call("GET", "/api/admin/dashboard", p.admin(), null).body();
    assertEquals(1, d.get("teamSize").asInt());
    assertEquals(1, d.get("pending").size());
    assertEquals(1, d.get("pendingLeaveCount").asInt());
    assertEquals(1, d.get("outTodayCount").asInt());
    assertEquals(1, d.get("outThisWeek").size());
    assertEquals(2.0, d.at("/monthly/10/approved").asDouble());
    assertEquals(1.0, d.at("/monthly/11/pending").asDouble());
    JsonNode b = d.at("/balances/0");
    assertEquals(List.of(24.0, 2.0, 22.0), List.of(b.get("total").asDouble(), b.get("used").asDouble(), b.get("remaining").asDouble()));
    assertEquals("employee", b.get("category").asText());
    assertEquals(2026, d.get("year").asInt());
  }

  @Test
  void theAdminListsShowEveryonesRequestsWithNames() throws Exception {
    var p = adminAndEmployee();
    apply(p.employee(), "2026-11-16", "2026-11-16");
    call("POST", "/api/employee/comp-off", p.employee(), Map.of("workedOn", "2026-10-31", "dayLength", "full"));
    JsonNode leave = call("GET", "/api/admin/leave", p.admin(), null).body().get("requests");
    JsonNode comp = call("GET", "/api/admin/comp-off", p.admin(), null).body().get("requests");
    assertEquals(List.of(1, 1, "Priya", "Priya"), List.of(leave.size(), comp.size(), leave.get(0).get("employeeName").asText(), comp.get(0).get("employeeName").asText()));
    assertEquals("Casual leave", leave.get(0).get("type").asText());
    assertEquals("Comp-off", comp.get(0).get("type").asText());
  }

  @Test
  void leavePolicyListsTheFourCategoriesWithHeadcountAndSavesAllFourOrNone() throws Exception {
    var p = adminAndEmployee();
    JsonNode cats = call("GET", "/api/admin/leave-policy", p.admin(), null).body().get("categories");
    assertEquals(List.of("contractor", "employee", "intern", "student"), List.of(cats.get(0).get("category").asText(), cats.get(1).get("category").asText(), cats.get(2).get("category").asText(), cats.get(3).get("category").asText()));
    assertEquals(List.of(24, 1L), List.of(cats.get(1).get("daysPerYear").asInt(), cats.get(1).get("employees").asLong()));

    Res bad = call("PUT", "/api/admin/leave-policy", p.admin(), Map.of("contractor", "12", "employee", "", "intern", "367", "student", "1.5"));
    assertEquals(422, bad.status());
    assertEquals("Enter a whole number of days.", bad.body().at("/errors/employee").asText());
    assertEquals("Use a number between 0 and 366.", bad.body().at("/errors/intern").asText());
    assertEquals("Enter a whole number of days.", bad.body().at("/errors/student").asText());
    assertFalse(bad.body().get("errors").has("contractor"));
    assertEquals("367", bad.body().at("/values/intern").asText());
    assertEquals(24, call("GET", "/api/admin/leave-policy", p.admin(), null).body().at("/categories/0/daysPerYear").asInt()); // nothing saved

    assertEquals(200, call("PUT", "/api/admin/leave-policy", p.admin(), Map.of("contractor", "12", "employee", "30", "intern", "0", "student", "366")).status());
    JsonNode saved = call("GET", "/api/admin/leave-policy", p.admin(), null).body().get("categories");
    assertEquals(List.of(12, 30, 0, 366), List.of(saved.get(0).get("daysPerYear").asInt(), saved.get(1).get("daysPerYear").asInt(), saved.get(2).get("daysPerYear").asInt(), saved.get(3).get("daysPerYear").asInt()));
  }

  @Test
  void changingTheCategoryDaysChangesTheEmployeesBalanceStraightAway() throws Exception {
    var p = adminAndEmployee();
    call("PUT", "/api/admin/leave-policy", p.admin(), Map.of("contractor", "24", "employee", "10", "intern", "24", "student", "24"));
    assertEquals(10.0, call("GET", "/api/admin/dashboard", p.admin(), null).body().at("/balances/0/total").asDouble());
  }

  // ----------------------------------------------------------------- payslips

  void giveSalary(String email, String salary, String designation) {
    store.db().query("update employees set monthly_salary = $2, designation = $3 where lower(email) = $1", email, salary, designation);
  }

  Map<String, Object> payslipBody(String employeeId, String month, String basic, String deduction) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("employeeId", employeeId);
    m.put("month", month);
    m.put("basic", basic);
    m.put("deduction", deduction);
    return m;
  }

  String employeeId(String email) {
    return store.findEmployeeByEmail(email).orElseThrow().employee().id();
  }

  @Test
  void thePayslipRoutesKeepEachRoleToItsOwnSide() throws Exception {
    var p = adminAndEmployee();
    for (String[] route : new String[][] {{"GET", "/api/admin/payslips"}, {"POST", "/api/admin/payslips"}, {"POST", "/api/admin/payslips/00000000-0000-4000-8000-000000000001/publish"}}) {
      assertEquals(401, call(route[0], route[1], null, Map.of()).status(), "signed out " + route[1]);
      assertEquals(403, call(route[0], route[1], p.employee(), Map.of()).status(), "employee on " + route[1]);
    }
    assertEquals(401, call("GET", "/api/employee/payslips", null, null).status());
    assertEquals(403, call("GET", "/api/employee/payslips", p.admin(), null).status());
  }

  @Test
  void anAdminGeneratesAPayslipAndTheEmployeeSeesAndDownloadsIt() throws Exception {
    var p = adminAndEmployee();
    giveSalary("priya@gmail.com", "16500", "Software Engineer");
    Res made = call("POST", "/api/admin/payslips", p.admin(), payslipBody(employeeId("priya@gmail.com"), "2026-10", "16500", "1500.5"));
    assertEquals(201, made.status(), made.raw());
    assertEquals("Payslip generated for Priya, October 2026", made.body().at("/done/message").asText());

    JsonNode list = call("GET", "/api/admin/payslips?month=2026-10", p.admin(), null).body();
    assertEquals("2026-10", list.get("month").asText());
    assertEquals(List.of("Priya", 1_650_000, 150_050, 1_499_950, true, "2026-10-01"),
        List.of(list.at("/payslips/0/employeeName").asText(), list.at("/payslips/0/basic").asInt(), list.at("/payslips/0/deduction").asInt(),
            list.at("/payslips/0/net").asInt(), list.at("/payslips/0/published").asBoolean(), list.at("/payslips/0/periodMonth").asText()));
    assertEquals("16500.00", list.at("/employees/0/monthlySalary").asText());
    assertEquals("Software Engineer", list.at("/employees/0/designation").asText());
    assertFalse(list.toString().contains("pdf"));

    JsonNode mine = call("GET", "/api/employee/payslips", p.employee(), null).body().get("payslips");
    assertEquals(1, mine.size());
    String id = mine.get(0).get("id").asText();
    Res pdf = call("GET", "/api/payslips/" + id + "/pdf", p.employee(), null);
    assertEquals(200, pdf.status());
    assertEquals("%PDF-1.4 fake", pdf.raw());
    assertEquals("application/pdf", pdf.headers().firstValue("content-type").orElse(""));
    assertTrue(pdf.headers().firstValue("content-disposition").orElse("").matches("attachment; filename=\"Payslip_HR-EMP-\\d{5}_2026-10\\.pdf\""));
    assertEquals("private, no-store", pdf.headers().firstValue("cache-control").orElse(""));
  }

  @Test
  void onlyTheOwnerAndAnAdminCanDownloadAndEveryoneElseGetsA404() throws Exception {
    var p = adminAndEmployee();
    makeEmployee("Other");
    String other = signIn("other@gmail.com", "temp-pass-1");
    call("POST", "/api/admin/payslips", p.admin(), payslipBody(employeeId("priya@gmail.com"), "2026-10", "16500", ""));
    String id = call("GET", "/api/employee/payslips", p.employee(), null).body().at("/payslips/0/id").asText();
    assertEquals(200, call("GET", "/api/payslips/" + id + "/pdf", p.admin(), null).status());
    assertEquals(404, call("GET", "/api/payslips/" + id + "/pdf", other, null).status());
    assertEquals(404, call("GET", "/api/payslips/" + id + "/pdf", null, null).status()); // signed out
    assertEquals(404, call("GET", "/api/payslips/not-a-uuid/pdf", p.admin(), null).status());
    assertEquals(404, call("GET", "/api/payslips/00000000-0000-4000-8000-000000000000/pdf", p.admin(), null).status());
  }

  @Test
  void badPayslipNumbersAre422WithTheCurrentAppsMessagesAndSaveNothing() throws Exception {
    var p = adminAndEmployee();
    Res r = call("POST", "/api/admin/payslips", p.admin(), payslipBody("not-a-uuid", "1999-12", "abc", "-1"));
    assertEquals(422, r.status());
    assertEquals("Choose an employee.", r.body().at("/errors/employee").asText());
    assertEquals("Choose a month.", r.body().at("/errors/month").asText());
    assertEquals("Enter the basic as an amount, like 16500 or 16500.50.", r.body().at("/errors/basic").asText());
    assertEquals("Deduction can't be negative.", r.body().at("/errors/deduction").asText());
    Res tooMuch = call("POST", "/api/admin/payslips", p.admin(), payslipBody(employeeId("priya@gmail.com"), "2026-10", "16500", "16500.01"));
    assertEquals("Deduction can't be more than the basic of ₹16,500.00.", tooMuch.body().at("/errors/deduction").asText());
    assertEquals(0, call("GET", "/api/admin/payslips?month=2026-10", p.admin(), null).body().get("payslips").size());
  }

  @Test
  void regeneratingAPublishedPayslipAsksFirstAndReplacesOnlyWithTheGoAhead() throws Exception {
    var p = adminAndEmployee();
    String id = employeeId("priya@gmail.com");
    call("POST", "/api/admin/payslips", p.admin(), payslipBody(id, "2026-10", "16500", "0"));
    Res ask = call("POST", "/api/admin/payslips", p.admin(), payslipBody(id, "2026-10", "16500", "500"));
    assertEquals(409, ask.status());
    assertEquals(List.of("Priya", "2026-10"), List.of(ask.body().at("/confirm/employeeName").asText(), ask.body().at("/confirm/month").asText()));
    assertEquals(0, call("GET", "/api/admin/payslips?month=2026-10", p.admin(), null).body().at("/payslips/0/deduction").asInt()); // untouched
    Map<String, Object> go = payslipBody(id, "2026-10", "16500", "500");
    go.put("replace", true);
    Res done = call("POST", "/api/admin/payslips", p.admin(), go);
    assertEquals(201, done.status());
    assertEquals("Payslip replaced for Priya, October 2026", done.body().at("/done/message").asText());
    JsonNode rows = call("GET", "/api/admin/payslips?month=2026-10", p.admin(), null).body().get("payslips");
    assertEquals(List.of(1, 50_000), List.of(rows.size(), rows.get(0).get("deduction").asInt()));
  }

  @Test
  void whenThePdfServiceIsDownTheAdminIsToldAndNothingIsSaved() throws Exception {
    var p = adminAndEmployee();
    renderer.set(html -> {
      throw new app.lumiether.payslip.PdfClient.PdfServiceException();
    });
    Res r = call("POST", "/api/admin/payslips", p.admin(), payslipBody(employeeId("priya@gmail.com"), "2026-10", "16500", ""));
    assertEquals(503, r.status());
    assertEquals("PDF service is not running", r.body().get("pdfError").asText());
    assertEquals(0, call("GET", "/api/admin/payslips?month=2026-10", p.admin(), null).body().get("payslips").size());
  }

  @Test
  void theMonthDefaultsToTheCurrentOneAndAnUnreadableMonthFallsBackToIt() throws Exception {
    var p = adminAndEmployee();
    assertEquals("2026-11", call("GET", "/api/admin/payslips", p.admin(), null).body().get("month").asText());
    assertEquals("2026-11", call("GET", "/api/admin/payslips?month=nonsense", p.admin(), null).body().get("month").asText());
    assertEquals("2026-03", call("GET", "/api/admin/payslips?month=2026-03", p.admin(), null).body().get("month").asText());
  }

  @Test
  void theMonthlyJobMakesDraftsOnlyForTheRightCallerAndEmployeesCantSeeThem() throws Exception {
    var p = adminAndEmployee();
    giveSalary("priya@gmail.com", "16500", "Engineer");
    Map<String, String> good = Map.of("Authorization", "Bearer " + CRON_SECRET);
    assertEquals(404, send("GET", "/api/cron/payslips", Map.of(), null).status());
    assertEquals(404, send("GET", "/api/cron/payslips", Map.of("Authorization", "Bearer nope"), null).status());
    assertEquals(404, send("GET", "/api/cron/payslips", Map.of("Authorization", "Bearer " + CRON_SECRET + "x"), null).status());
    assertEquals(404, call("GET", "/api/cron/payslips", p.admin(), null).status()); // a signed-in admin is not the job

    Res run = send("GET", "/api/cron/payslips", good, null);
    assertEquals(200, run.status(), run.raw());
    assertEquals(List.of("2026-10", 1, 0), List.of(run.body().get("month").asText(), run.body().get("created").asInt(), run.body().get("skipped").asInt())); // TODAY is 4 Nov: last month is Oct
    assertTrue(run.body().get("failed").isNull());
    assertEquals(0, call("GET", "/api/employee/payslips", p.employee(), null).body().get("payslips").size());
    JsonNode draft = call("GET", "/api/admin/payslips?month=2026-10", p.admin(), null).body().at("/payslips/0");
    assertFalse(draft.get("published").asBoolean());
    assertEquals(200, send("GET", "/api/cron/payslips", good, null).status()); // again: creates nothing
    assertEquals(0, send("GET", "/api/cron/payslips", good, null).body().get("created").asInt());

    String id = draft.get("id").asText();
    assertEquals(404, call("GET", "/api/payslips/" + id + "/pdf", p.employee(), null).status()); // a draft is the admin's alone
    assertEquals(200, call("GET", "/api/payslips/" + id + "/pdf", p.admin(), null).status());
    assertEquals(200, call("POST", "/api/admin/payslips/" + id + "/publish", p.admin(), null).status());
    assertEquals(409, call("POST", "/api/admin/payslips/" + id + "/publish", p.admin(), null).status());
    assertEquals(200, call("GET", "/api/payslips/" + id + "/pdf", p.employee(), null).status());
    assertEquals(1, call("GET", "/api/employee/payslips", p.employee(), null).body().get("payslips").size());
  }

  @Test
  void theMonthlyJobReportsA503WhenThePdfServiceIsDown() throws Exception {
    adminAndEmployee();
    giveSalary("priya@gmail.com", "16500", "Engineer");
    renderer.set(html -> {
      throw new app.lumiether.payslip.PdfClient.PdfServiceException();
    });
    Res r = send("GET", "/api/cron/payslips", Map.of("Authorization", "Bearer " + CRON_SECRET), null);
    assertEquals(503, r.status());
    assertEquals("PDF service is not running", r.body().get("failed").asText());
  }

  @Test
  void withNoCronSecretConfiguredTheJobAnswers404ToEveryone() throws Exception {
    server.stop();
    var api = new Api(store, auth, new Sessions(store, auth, COOKIE_SECRET), new Api.Settings(false, List.of(ORIGIN)), () -> TODAY, html -> new byte[0], null);
    server = WebServer.builder().port(0).routing(api::register).build().start();
    base = "http://localhost:" + server.port();
    assertEquals(404, send("GET", "/api/cron/payslips", Map.of("Authorization", "Bearer "), null).status());
    assertEquals(404, send("GET", "/api/cron/payslips", Map.of("Authorization", "Bearer null"), null).status());
  }

  // ---------------------------------------------------------- password change

  @Test
  void changingYourPasswordReplacesTheCookieAndKillsTheOldOne() throws Exception {
    makeEmployee("Priya");
    String oldCookie = signIn("priya@gmail.com", "temp-pass-1");

    Res wrong = call("POST", "/api/account/password", oldCookie, Map.of("current", "nope-nope", "next", "my-own-pass-9", "confirm", "my-own-pass-9"));
    assertEquals(422, wrong.status());
    assertEquals("That isn't your current password.", wrong.body().at("/errors/current").asText());
    assertTrue(wrong.setCookies().isEmpty(), "a refused change must not touch the cookie");
    assertEquals(200, call("GET", "/api/auth/me", oldCookie, null).status()); // nothing changed

    Res ok = call("POST", "/api/account/password", oldCookie, Map.of("current", "temp-pass-1", "next", "my-own-pass-9", "confirm", "my-own-pass-9"));
    assertEquals(200, ok.status());
    assertFalse(ok.raw().contains("token"), "no token in the body");
    String newCookie = ok.sessionCookie();
    assertNotNull(newCookie, "the response replaces the cookie");
    assertNotEquals(oldCookie, newCookie);
    assertTrue(ok.sessionSetCookie().contains("HttpOnly"));
    assertEquals(401, call("GET", "/api/auth/me", oldCookie, null).status()); // other sessions die with the old password
    assertEquals(200, call("GET", "/api/auth/me", newCookie, null).status());
    assertEquals(401, call("POST", "/api/auth/login", null, Map.of("email", "priya@gmail.com", "password", "temp-pass-1")).status());
    assertNotNull(signIn("priya@gmail.com", "my-own-pass-9"));

    assertEquals(401, call("POST", "/api/account/password", null, Map.of("current", "a", "next", "b", "confirm", "b")).status());
  }

  // ------------------------------------------------------------------ logout

  @Test
  void logoutExpiresTheCookieAndNeedsNoSession() throws Exception {
    makeEmployee("Priya");
    String cookie = signIn("priya@gmail.com", "temp-pass-1");
    Res out = call("POST", "/api/auth/logout", cookie, null);
    assertEquals(204, out.status());
    String c = out.sessionSetCookie();
    assertNotNull(c, "logout must send a Set-Cookie");
    assertTrue(c.startsWith("lr_session=;"), c);
    assertTrue(c.contains("Max-Age=0") && c.contains("Path=/") && c.contains("HttpOnly"), c);
    assertEquals(204, call("POST", "/api/auth/logout", null, null).status()); // fine when already signed out
  }

  // ------------------------------------------------------------ CSRF and CORS

  @Test
  void aCrossOriginRequestIsRefusedBeforeAnythingHappens() throws Exception {
    makeAdmin("Boss");
    makeEmployee("Priya");
    String admin = signIn("boss@example.com", "admin-pass-1");

    // signing in from another site (login CSRF) sets no cookie
    Res login = send("POST", "/api/auth/login", Map.of("Origin", EVIL, "Content-Type", "application/json"),
        Json.write(Map.of("email", "priya@gmail.com", "password", "temp-pass-1")));
    assertEquals(403, login.status());
    assertTrue(login.setCookies().isEmpty());

    // a valid admin cookie plus a foreign Origin changes nothing
    Map<String, String> h = Map.of("Origin", EVIL, "Content-Type", "application/json", "Cookie", "lr_session=" + admin);
    assertEquals(403, send("POST", "/api/admin/admins", h, Json.write(Map.of("email", "new@x.com", "password", "temp-pass-1"))).status());
    assertEquals(1, store.listAdmins().size(), "the admin must not have been created");
    makeAdmin("Other");
    String otherId = store.findAdminByEmail("other@example.com").orElseThrow().id();
    assertEquals(403, send("DELETE", "/api/admin/admins/" + otherId, h, null).status());
    assertTrue(store.findAdminById(otherId).isPresent(), "the admin must not have been removed");
    assertEquals(403, send("POST", "/api/account/password", h, Json.write(Map.of("current", "admin-pass-1", "next", "hijacked-pass-1", "confirm", "hijacked-pass-1"))).status());
    assertEquals(200, call("POST", "/api/auth/login", null, Map.of("email", "boss@example.com", "password", "admin-pass-1")).status(), "the password is unchanged");

    // the same request from the allowed origin works, so the 403s were about the origin
    assertEquals(201, call("POST", "/api/admin/admins", admin, Map.of("email", "new@x.com", "password", "temp-pass-1")).status());
    assertEquals(403, send("POST", "/api/auth/logout", Map.of("Origin", "null", "Content-Type", "application/json"), null).status());
  }

  @Test
  void theRefererDecidesWhenThereIsNoOrigin() throws Exception {
    makeEmployee("Priya");
    String body = Json.write(Map.of("email", "priya@gmail.com", "password", "temp-pass-1"));
    assertEquals(403, send("POST", "/api/auth/login", Map.of("Referer", EVIL + "/page", "Content-Type", "application/json"), body).status());
    assertEquals(200, send("POST", "/api/auth/login", Map.of("Referer", ORIGIN + "/login?x=1", "Content-Type", "application/json"), body).status());
  }

  @Test
  void aRequestWithNeitherOriginNorRefererIsNotFromABrowserAndIsAllowed() throws Exception {
    makeEmployee("Priya");
    Res r = send("POST", "/api/auth/login", Map.of("Content-Type", "application/json"), Json.write(Map.of("email", "priya@gmail.com", "password", "temp-pass-1")));
    assertEquals(200, r.status());
  }

  @Test
  void stateChangingRequestsMustBeJson() throws Exception {
    makeAdmin("Boss");
    String admin = signIn("boss@example.com", "admin-pass-1");
    String login = "email=boss%40example.com&password=admin-pass-1";
    // an HTML form can send these two, and nothing else, without a CORS preflight
    assertEquals(415, send("POST", "/api/auth/login", Map.of("Origin", ORIGIN, "Content-Type", "application/x-www-form-urlencoded"), login).status());
    assertEquals(415, send("POST", "/api/auth/login", Map.of("Origin", ORIGIN, "Content-Type", "text/plain"), Json.write(Map.of("email", "boss@example.com", "password", "admin-pass-1"))).status());
    assertEquals(415, send("POST", "/api/auth/login", Map.of("Origin", ORIGIN), "{}").status(), "no content type at all");

    // a body-less DELETE needs the header too, and without it nothing is removed
    makeAdmin("Other");
    String otherId = store.findAdminByEmail("other@example.com").orElseThrow().id();
    Res noType = send("DELETE", "/api/admin/admins/" + otherId, Map.of("Origin", ORIGIN, "Cookie", "lr_session=" + admin), null);
    assertEquals(415, noType.status());
    assertTrue(store.findAdminById(otherId).isPresent());
    // logout also, so a cross-site form can't sign someone out either
    Res logout = send("POST", "/api/auth/logout", Map.of("Origin", ORIGIN, "Content-Type", "text/plain", "Cookie", "lr_session=" + admin), null);
    assertEquals(415, logout.status());
    assertNull(logout.sessionSetCookie());
    assertEquals(200, call("DELETE", "/api/admin/admins/" + otherId, admin, null).status()); // with JSON it works
  }

  @Test
  void readsAreNotCheckedSoGetNeedsNeitherOriginNorContentType() throws Exception {
    makeEmployee("Priya");
    String cookie = signIn("priya@gmail.com", "temp-pass-1");
    assertEquals(200, send("GET", "/api/auth/me", Map.of("Cookie", "lr_session=" + cookie), null).status());
  }

  @Test
  void thereIsNoCorsAnywhere() throws Exception {
    makeEmployee("Priya");
    Map<String, String> preflight = Map.of("Origin", EVIL, "Access-Control-Request-Method", "POST", "Access-Control-Request-Headers", "content-type");
    Res options = send("OPTIONS", "/api/auth/login", preflight, null);
    Res health = send("GET", "/api/health", Map.of("Origin", EVIL), null);
    Res login = call("POST", "/api/auth/login", null, Map.of("email", "priya@gmail.com", "password", "temp-pass-1"));
    for (Res r : new Res[] {options, health, login}) {
      r.headers().map().keySet().forEach(name -> assertFalse(name.toLowerCase().startsWith("access-control-"), name));
    }
    assertNotEquals(200, options.status(), "a preflight must not be answered as if it were allowed");
  }

  // --------------------------------------------------------- malformed input

  @Test
  void aMalformedBodyIs400() throws Exception {
    Res r = send("POST", "/api/auth/login", Map.of("Origin", ORIGIN, "Content-Type", "application/json"), "{not json");
    assertEquals(400, r.status());
  }

  // --------------------------------------------------------------- bootstrap

  @Test
  void bootstrapAdminSignsInOverHttpOnlyOnce() throws Exception {
    bootstrap.set(new Auth.Bootstrap("boss@example.com", Password.hash("env-password-1")));
    String cookie = signIn("boss@example.com", "env-password-1");
    assertEquals("admin", call("GET", "/api/auth/me", cookie, null).body().at("/user/role").asText());
    assertEquals(1, store.countAdmins());
  }
}
