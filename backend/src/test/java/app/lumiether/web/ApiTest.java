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
    var api = new Api(store, auth, new Sessions(store, auth, secret), new Api.Settings(secure, List.of(ORIGIN)));
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
