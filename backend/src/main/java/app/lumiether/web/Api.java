package app.lumiether.web;

import app.lumiether.auth.Auth;
import app.lumiether.auth.ChangePassword;
import app.lumiether.auth.Password;
import app.lumiether.auth.Sessions;
import app.lumiether.auth.Token.Role;
import app.lumiether.db.Db;
import app.lumiether.db.Store;
import app.lumiether.domain.Employees;
import app.lumiether.domain.Types;
import app.lumiether.domain.Types.Admin;
import app.lumiether.domain.Types.SessionUser;
import app.lumiether.domain.Validated;
import io.helidon.http.HeaderNames;
import io.helidon.http.Method;
import io.helidon.http.Status;
import io.helidon.webserver.http.HttpRoute;
import io.helidon.webserver.http.HttpRouting;
import io.helidon.webserver.http.ServerRequest;
import io.helidon.webserver.http.ServerResponse;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The REST API under /api. Every route does what the matching Next.js page or server action did: check the session
 * and role first, then call the same rules. Errors are JSON: {"error": "..."} or {"errors": {field: message}}.
 */
public final class Api {
  private static final System.Logger LOG = System.getLogger("lumiether");

  /** The only thing a browser ever hears about a failed sign-in. */
  public static final String FAILED = "Incorrect email or password.";

  private final Store store;
  private final Auth auth;
  private final Sessions sessions;
  private final ChangePassword changePassword;

  private final Settings settings;

  /**
   * {@code cookieSecure}: add the Secure attribute to the session cookie (on in production, off on plain http).
   * {@code allowedOrigins}: the origins that may make state-changing requests, already normalised (see CsrfGuard).
   * There is no CORS: other sites can never make credentialed calls.
   */
  public record Settings(boolean cookieSecure, List<String> allowedOrigins) {}

  public Api(Store store, Auth auth, Sessions sessions, Settings settings) {
    this.settings = settings;
    this.store = store;
    this.auth = auth;
    this.sessions = sessions;
    this.changePassword = new ChangePassword(store, auth);
  }

  @FunctionalInterface
  interface Authed {
    void handle(ServerRequest req, ServerResponse res, SessionUser user) throws Exception;
  }

  @FunctionalInterface
  interface Plain {
    void handle(ServerRequest req, ServerResponse res) throws Exception;
  }

  public void register(HttpRouting.Builder routing) {
    // CSRF: a state-changing request must come from an allowed origin and be JSON (see CsrfGuard). Runs before any route.
    routing.addFilter((chain, req, res) -> {
      if (req.path().path().startsWith("/api/")) {
        var verdict = CsrfGuard.check(
            req.prologue().method().text(),
            req.headers().first(HeaderNames.ORIGIN).orElse(null),
            req.headers().first(HeaderNames.REFERER).orElse(null),
            req.headers().first(HeaderNames.CONTENT_TYPE).orElse(null),
            settings.allowedOrigins());
        if (!verdict.allowed()) {
          LOG.log(System.Logger.Level.WARNING, "[csrf] refused " + req.prologue().method().text() + " " + req.path().path()
              + " (origin=" + abbreviate(req.headers().first(HeaderNames.ORIGIN).orElse("-")) + ", status " + verdict.status() + ")");
          error(res, verdict.status(), verdict.message());
          return;
        }
      }
      chain.proceed();
    });
    // Health checks from load balancers and uptime monitors are often HEAD requests, so answer both.
    routing.route(HttpRoute.builder().methods(Method.GET, Method.HEAD).path("/api/health")
        .handler(plain((req, res) -> json(res, 200, Map.of("status", "ok")))).build());
    routing.post("/api/auth/login", plain(this::login));
    routing.post("/api/auth/logout", plain(this::logout));
    routing.get("/api/auth/me", authed(null, (req, res, user) -> json(res, 200, Map.of("user", userJson(user)))));
    routing.post("/api/account/password", authed(null, this::changeMyPassword));
    routing.get("/api/admin/admins", authed(Role.admin, (req, res, user) -> json(res, 200, Map.of("admins", store.listAdmins()))));
    routing.post("/api/admin/admins", authed(Role.admin, this::addAdmin));
    routing.delete("/api/admin/admins/{id}", authed(Role.admin, this::removeAdmin));
    routing.get("/api/admin/employees", authed(Role.admin, (req, res, user) -> json(res, 200, Map.of("employees", store.listEmployeesWithPayroll()))));
    routing.post("/api/admin/employees", authed(Role.admin, this::addEmployee));
    routing.patch("/api/admin/employees/{id}/category", authed(Role.admin, this::changeCategory));
    routing.patch("/api/admin/employees/{id}/payroll", authed(Role.admin, this::updatePayroll));
    routing.delete("/api/admin/employees/{id}", authed(Role.admin, this::removeEmployee));
  }

  // ---------------------------------------------------------------- plumbing

  private static void json(ServerResponse res, int status, Object body) {
    res.status(Status.create(status)).header(HeaderNames.CONTENT_TYPE, "application/json").header(HeaderNames.CACHE_CONTROL, "no-store").send(Json.write(body));
  }

  private static String abbreviate(String s) {
    return s.length() <= 80 ? s : s.substring(0, 80) + "...";
  }

  private static void error(ServerResponse res, int status, String message) {
    json(res, status, Map.of("error", message));
  }

  private static io.helidon.webserver.http.Handler plain(Plain p) {
    return (req, res) -> {
      try {
        p.handle(req, res);
      } catch (Exception e) {
        LOG.log(System.Logger.Level.ERROR, "unhandled error on " + req.path().path(), e);
        error(res, 500, "Something went wrong. Please try again.");
      }
    };
  }

  /** {@code role} null means any signed-in user. Signed out is 401; the wrong role is 403. */
  private io.helidon.webserver.http.Handler authed(Role role, Authed h) {
    return plain((req, res) -> {
      var user = sessions.userForCookie(req.headers().first(HeaderNames.COOKIE).orElse(null));
      if (user.isEmpty()) {
        error(res, 401, "You are signed out. Sign in again.");
      } else if (role != null && user.get().role() != role) {
        error(res, 403, "You don't have access to that.");
      } else {
        h.handle(req, res, user.get());
      }
    });
  }

  private static Map<String, Object> body(ServerRequest req, ServerResponse res) {
    Map<String, Object> body = Json.parseObject(req.content().as(String.class));
    if (body == null) error(res, 400, "That request couldn't be read.");
    return body;
  }

  private static Map<String, Object> userJson(SessionUser u) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("id", u.id());
    m.put("name", u.name());
    m.put("email", u.email());
    m.put("role", u.role().name());
    return m;
  }

  // -------------------------------------------------------------------- auth

  /** The real reason goes to the server log only. Never the password, never sent to the client. */
  private static void logFailure(String reason) {
    LOG.log(System.Logger.Level.WARNING, "[auth] sign-in failed: " + reason);
  }

  private void login(ServerRequest req, ServerResponse res) {
    Map<String, Object> body = body(req, res);
    if (body == null) return;
    String email = Json.text(body, "email");
    String password = Json.text(body, "password");
    if (email.isBlank() || password.isEmpty()) {
      logFailure("empty-input");
      error(res, 401, FAILED);
      return;
    }

    Auth.Result result;
    try {
      result = auth.authenticate(email, password);
    } catch (RuntimeException e) {
      // The database is unreachable or not configured. The browser still gets the generic message.
      logFailure("database-error (" + e.getMessage() + ")");
      error(res, 401, FAILED);
      return;
    }
    if (!result.ok()) {
      logFailure(result.failure().code);
      error(res, 401, FAILED);
      return;
    }

    String token;
    try {
      token = sessions.start(result.user());
    } catch (Sessions.ConfigError e) {
      logFailure("missing-secret (LR_COOKIE_SECRET is unset or shorter than 32 characters)");
      error(res, 401, FAILED);
      return;
    }
    // The token travels only in the httpOnly cookie, never in the body, so a script can't read it.
    res.header(HeaderNames.SET_COOKIE, Sessions.setCookie(token, settings.cookieSecure()));
    json(res, 200, Map.of("user", userJson(result.user())));
  }

  /** Ends the session on this device by expiring the cookie. The token itself is stateless, as in the Node app. */
  private void logout(ServerRequest req, ServerResponse res) {
    res.header(HeaderNames.SET_COOKIE, Sessions.clearCookie(settings.cookieSecure()));
    res.status(Status.NO_CONTENT_204).send();
  }

  /** Any signed-in user, for their own password only. The user comes from the session, never the body. */
  private void changeMyPassword(ServerRequest req, ServerResponse res, SessionUser user) {
    Map<String, Object> body = body(req, res);
    if (body == null) return;
    Map<String, String> errors = changePassword.change(
        user, new ChangePassword.Input(Json.text(body, "current"), Json.text(body, "next"), Json.text(body, "confirm")));
    if (!errors.isEmpty()) {
      json(res, 422, Map.of("errors", errors));
      return;
    }
    // The old session stops working with the old password, so replace the cookie with a new one for this device.
    res.header(HeaderNames.SET_COOKIE, Sessions.setCookie(sessions.start(user), settings.cookieSecure()));
    json(res, 200, Map.of("ok", true));
  }

  // ------------------------------------------------------------------ admins

  /** Admins only. The new admin gets the temporary password chosen here and can change it after signing in. */
  private void addAdmin(ServerRequest req, ServerResponse res, SessionUser user) {
    Map<String, Object> body = body(req, res);
    if (body == null) return;
    String email = Json.text(body, "email");
    Map<String, String> values = Map.of("email", email);

    Validated<Employees.NewAdminInput> result = Employees.validateNewAdmin(
        new Employees.NewAdminInput(email, Json.text(body, "password")), auth.isEmailInUse(email) ? List.of(email) : List.of());
    if (!result.ok()) {
      json(res, 422, Map.of("errors", result.errors(), "values", values));
      return;
    }
    try {
      Admin admin = store.createAdmin(
          Employees.nameFromEmail(result.value().email()), result.value().email(), Password.hash(result.value().password()));
      json(res, 201, Map.of("created", Map.of("name", admin.name(), "email", admin.email())));
    } catch (RuntimeException e) {
      if (Db.isUniqueViolation(e)) {
        json(res, 422, Map.of("errors", Map.of("email", "Someone already uses this email."), "values", values));
      } else {
        LOG.log(System.Logger.Level.ERROR, "couldn't add admin", e);
        json(res, 500, Map.of("error", "Couldn't add the admin. Please try again.", "values", values));
      }
    }
  }

  /** Admins only. Removes another admin; the removed admin is signed out on their next request. */
  private void removeAdmin(ServerRequest req, ServerResponse res, SessionUser user) {
    Store.Result result = auth.removeAdmin(user, req.path().pathParameters().get("id"));
    if (result.ok()) json(res, 200, Map.of("ok", true));
    else error(res, 409, result.error());
  }

  // --------------------------------------------------------------- employees

  /** Admin only. The admin chooses the temporary password; only its hash is stored. */
  private void addEmployee(ServerRequest req, ServerResponse res, SessionUser user) {
    Map<String, Object> body = body(req, res);
    if (body == null) return;
    // Sent back on failure so the fields keep what was typed (never the password).
    Map<String, String> values = new LinkedHashMap<>();
    for (String key : List.of("email", "joiningDate", "category", "monthlySalary", "designation")) values.put(key, Json.text(body, key));

    Validated<Employees.NewEmployeeValue> result = Employees.validateNewEmployee(
        new Employees.NewEmployeeInput(values.get("email"), values.get("joiningDate"), Json.text(body, "password"),
            values.get("category"), values.get("monthlySalary"), values.get("designation")),
        auth.isEmailInUse(values.get("email")) ? List.of(values.get("email")) : List.of());
    if (!result.ok()) {
      json(res, 422, Map.of("errors", result.errors(), "values", values));
      return;
    }
    Employees.NewEmployeeValue v = result.value();
    try {
      var employee = store.createEmployee(new Store.NewEmployee(
          Employees.nameFromEmail(v.email()), v.email(), v.joiningDate(), Password.hash(v.password()), v.category(), v.monthlySalary(), v.designation()));
      json(res, 201, Map.of("created", Map.of("name", employee.name(), "email", employee.email())));
    } catch (RuntimeException e) {
      // Two people adding the same email at once: the unique index lets only one through.
      if (Db.isUniqueViolation(e)) {
        json(res, 422, Map.of("errors", Map.of("email", "Someone already uses this email."), "values", values));
      } else {
        LOG.log(System.Logger.Level.ERROR, "couldn't add employee", e);
        json(res, 500, Map.of("error", "Couldn't add the employee. Please try again.", "values", values));
      }
    }
  }

  /** Admin only. Moving an employee to another category changes how many leave days they get. */
  private void changeCategory(ServerRequest req, ServerResponse res, SessionUser user) {
    Map<String, Object> body = body(req, res);
    if (body == null) return;
    if (!Types.CATEGORIES.contains(Json.text(body, "category"))) {
      error(res, 422, "Choose a category.");
    } else if (!store.setEmployeeCategory(req.path().pathParameters().get("id"), Json.text(body, "category"))) {
      error(res, 404, "That employee no longer exists.");
    } else {
      json(res, 200, Map.of("ok", true));
    }
  }

  /** Admin only. Saves the monthly salary and designation shown on payslips. Empty clears a value. */
  private void updatePayroll(ServerRequest req, ServerResponse res, SessionUser user) {
    Map<String, Object> body = body(req, res);
    if (body == null) return;
    Validated<Employees.PayrollValue> result =
        Employees.validatePayroll(new Employees.PayrollInput(Json.text(body, "monthlySalary"), Json.text(body, "designation")));
    if (!result.ok()) {
      json(res, 422, Map.of("errors", result.errors()));
    } else if (!store.setEmployeePayroll(req.path().pathParameters().get("id"), result.value().monthlySalary(), result.value().designation())) {
      error(res, 404, "That employee no longer exists.");
    } else {
      json(res, 200, Map.of("ok", true));
    }
  }

  /** Admin only. Permanently removes the employee and everything of theirs: leave, comp-off, permissions, payslips. */
  private void removeEmployee(ServerRequest req, ServerResponse res, SessionUser user) {
    if (store.deleteEmployee(req.path().pathParameters().get("id"))) json(res, 200, Map.of("ok", true));
    else error(res, 404, "That employee no longer exists.");
  }
}
