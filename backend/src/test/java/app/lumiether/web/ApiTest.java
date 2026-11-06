package app.lumiether.web;

import static org.junit.jupiter.api.Assertions.*;

import app.lumiether.auth.Auth;
import app.lumiether.auth.Password;
import app.lumiether.auth.Sessions;
import app.lumiether.db.Store;
import app.lumiether.db.TestDb;
import com.fasterxml.jackson.databind.JsonNode;
import io.helidon.webserver.WebServer;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.*;

/** The HTTP layer end to end: a real Helidon server on a free port, a real test database. */
class ApiTest {
  static final String SECRET = "an-api-test-secret-that-is-long-enough-1234";
  WebServer server;
  Store store;
  Auth auth;
  HttpClient http = HttpClient.newHttpClient();
  String base;
  final AtomicReference<Auth.Bootstrap> bootstrap = new AtomicReference<>(new Auth.Bootstrap(null, null));

  void start(String secret) {
    var db = TestDb.reset();
    store = new Store(db);
    auth = new Auth(store, bootstrap::get);
    server = WebServer.builder().port(0).routing(new Api(store, auth, new Sessions(store, auth, secret))::register).build().start();
    base = "http://localhost:" + server.port();
  }

  @BeforeEach
  void setUp() {
    TestDb.requireDatabase();
    bootstrap.set(new Auth.Bootstrap(null, null));
    start(SECRET);
  }

  @AfterEach
  void tearDown() {
    if (server != null) server.stop();
  }

  record Res(int status, JsonNode body, String raw) {}

  Res call(String method, String path, String token, Object body) throws Exception {
    var b = HttpRequest.newBuilder(URI.create(base + path));
    if (token != null) b.header("Authorization", "Bearer " + token);
    b.header("Content-Type", "application/json");
    var publisher = body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(Json.write(body));
    var r = http.send(b.method(method, publisher).build(), HttpResponse.BodyHandlers.ofString());
    JsonNode json = r.body().isBlank() ? null : Json.MAPPER.readTree(r.body());
    return new Res(r.statusCode(), json, r.body());
  }

  String signIn(String email, String password) throws Exception {
    Res r = call("POST", "/api/auth/login", null, Map.of("email", email, "password", password));
    assertEquals(200, r.status(), r.raw());
    return r.body().get("token").asText();
  }

  void makeAdmin(String name) {
    store.createAdmin(name, name.toLowerCase() + "@example.com", Password.hash("admin-pass-1"));
  }

  void makeEmployee(String name) {
    store.createEmployee(Store.NewEmployee.of(name, name.toLowerCase() + "@gmail.com", "2000-01-01", Password.hash("temp-pass-1")));
  }

  @Test
  void healthIsOpen() throws Exception {
    assertEquals(200, call("GET", "/api/health", null, null).status());
  }

  @Test
  void aFailedSignInGivesOneGenericMessageWhateverTheReason() throws Exception {
    makeEmployee("Priya");
    Res wrongPassword = call("POST", "/api/auth/login", null, Map.of("email", "priya@gmail.com", "password", "nope"));
    Res unknownEmail = call("POST", "/api/auth/login", null, Map.of("email", "nobody@gmail.com", "password", "nope"));
    Res empty = call("POST", "/api/auth/login", null, Map.of("email", "", "password", ""));
    for (Res r : new Res[] {wrongPassword, unknownEmail, empty}) {
      assertEquals(401, r.status());
      assertEquals(Api.FAILED, r.body().get("error").asText());
    }
    assertEquals(wrongPassword.raw(), unknownEmail.raw());
  }

  @Test
  void signingInGivesATokenAndTheUserAndMeReturnsThem() throws Exception {
    makeEmployee("Priya");
    Res login = call("POST", "/api/auth/login", null, Map.of("email", "Priya@Gmail.com", "password", "temp-pass-1"));
    assertEquals(200, login.status());
    assertEquals("employee", login.body().at("/user/role").asText());
    assertFalse(login.raw().contains("passwordHash"));
    Res me = call("GET", "/api/auth/me", login.body().get("token").asText(), null);
    assertEquals("priya@gmail.com", me.body().at("/user/email").asText());
    assertFalse(me.raw().toLowerCase().contains("allowance"));
  }

  @Test
  void withoutAUsableSessionSecretNobodyCanSignIn() throws Exception {
    tearDown();
    start(null);
    makeEmployee("Priya");
    Res r = call("POST", "/api/auth/login", null, Map.of("email", "priya@gmail.com", "password", "temp-pass-1"));
    assertEquals(401, r.status());
    assertEquals(Api.FAILED, r.body().get("error").asText());
    tearDown();
    start("too-short");
    assertEquals(401, call("POST", "/api/auth/login", null, Map.of("email", "priya@gmail.com", "password", "temp-pass-1")).status());
  }

  @Test
  void signedOutIs401AndTheWrongRoleIs403() throws Exception {
    makeAdmin("Boss");
    makeEmployee("Priya");
    assertEquals(401, call("GET", "/api/auth/me", null, null).status());
    assertEquals(401, call("GET", "/api/auth/me", "garbage", null).status());
    assertEquals(401, call("GET", "/api/admin/admins", null, null).status());
    String employeeToken = signIn("priya@gmail.com", "temp-pass-1");
    assertEquals(403, call("GET", "/api/admin/admins", employeeToken, null).status());
    assertEquals(403, call("POST", "/api/admin/admins", employeeToken, Map.of("email", "x@y.com", "password", "temp-pass-1")).status());
    assertEquals(403, call("DELETE", "/api/admin/admins/00000000-0000-4000-8000-000000000001", employeeToken, null).status());
    String adminToken = signIn("boss@example.com", "admin-pass-1");
    assertEquals(200, call("GET", "/api/admin/admins", adminToken, null).status());
  }

  @Test
  void theRoleComesFromTheAccountNotTheToken() throws Exception {
    makeAdmin("Boss");
    makeEmployee("Priya");
    String employeeToken = signIn("priya@gmail.com", "temp-pass-1");
    // Forge: same signature, but swap the payload for an admin id. Fails the signature, so it is just 401.
    String[] parts = employeeToken.split("\\.");
    String forgedBody = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(
        ("{\"sub\":\"" + store.listAdmins().get(0).id() + "\",\"role\":\"admin\",\"exp\":4102444800,\"v\":\"x\"}").getBytes());
    assertEquals(401, call("GET", "/api/admin/admins", forgedBody + "." + parts[1], null).status());
  }

  @Test
  void addingAndRemovingAdmins() throws Exception {
    makeAdmin("Boss");
    String token = signIn("boss@example.com", "admin-pass-1");

    Res created = call("POST", "/api/admin/admins", token, Map.of("email", "Second.Admin@Company.co", "password", "temp-pass-1"));
    assertEquals(201, created.status());
    assertEquals("Second Admin", created.body().at("/created/name").asText());
    // the new admin can sign in with the temporary password
    assertNotNull(signIn("second.admin@company.co", "temp-pass-1"));

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
    // the removed admin is signed out on their next request
    assertEquals(401, call("GET", "/api/auth/me", secondToken, null).status());
    // and the last admin can't go
    Res last = call("DELETE", "/api/admin/admins/" + bossId, token, null);
    assertEquals(409, last.status());
  }

  @Test
  void changingYourPasswordGivesANewTokenAndKillsTheOldOne() throws Exception {
    makeEmployee("Priya");
    String oldToken = signIn("priya@gmail.com", "temp-pass-1");

    Res wrong = call("POST", "/api/account/password", oldToken, Map.of("current", "nope-nope", "next", "my-own-pass-9", "confirm", "my-own-pass-9"));
    assertEquals(422, wrong.status());
    assertEquals("That isn't your current password.", wrong.body().at("/errors/current").asText());
    assertEquals(200, call("GET", "/api/auth/me", oldToken, null).status()); // nothing changed

    Res ok = call("POST", "/api/account/password", oldToken, Map.of("current", "temp-pass-1", "next", "my-own-pass-9", "confirm", "my-own-pass-9"));
    assertEquals(200, ok.status());
    String newToken = ok.body().get("token").asText();
    assertEquals(401, call("GET", "/api/auth/me", oldToken, null).status()); // other sessions die with the old password
    assertEquals(200, call("GET", "/api/auth/me", newToken, null).status());
    assertEquals(401, call("POST", "/api/auth/login", null, Map.of("email", "priya@gmail.com", "password", "temp-pass-1")).status());
    assertNotNull(signIn("priya@gmail.com", "my-own-pass-9"));

    assertEquals(401, call("POST", "/api/account/password", null, Map.of("current", "a", "next", "b", "confirm", "b")).status());
  }

  @Test
  void aMalformedBodyIs400AndLogoutNeedsNoSession() throws Exception {
    var r = http.send(HttpRequest.newBuilder(URI.create(base + "/api/auth/login")).POST(HttpRequest.BodyPublishers.ofString("{not json")).build(),
        HttpResponse.BodyHandlers.ofString());
    assertEquals(400, r.statusCode());
    assertEquals(204, call("POST", "/api/auth/logout", null, null).status());
  }

  @Test
  void bootstrapAdminSignsInOverHttpOnlyOnce() throws Exception {
    bootstrap.set(new Auth.Bootstrap("boss@example.com", Password.hash("env-password-1")));
    String token = signIn("boss@example.com", "env-password-1");
    assertEquals("admin", call("GET", "/api/auth/me", token, null).body().at("/user/role").asText());
    assertEquals(1, store.countAdmins());
  }
}
