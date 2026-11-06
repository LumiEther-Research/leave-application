package app.lumiether.web;

import app.lumiether.auth.Auth;
import app.lumiether.auth.ChangePassword;
import app.lumiether.auth.Password;
import app.lumiether.auth.Sessions;
import app.lumiether.auth.Token.Role;
import app.lumiether.db.Db;
import app.lumiether.db.Store;
import app.lumiether.domain.Employees;
import app.lumiether.domain.Types.Admin;
import app.lumiether.domain.Types.SessionUser;
import app.lumiether.domain.Validated;
import io.helidon.http.HeaderNames;
import io.helidon.http.Status;
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

  private final String corsOrigin;

  public Api(Store store, Auth auth, Sessions sessions) {
    this(store, auth, sessions, null);
  }

  /** {@code corsOrigin}: only for development, when the Flutter dev server runs on another port. Null in production. */
  public Api(Store store, Auth auth, Sessions sessions, String corsOrigin) {
    this.corsOrigin = corsOrigin == null || corsOrigin.isBlank() ? null : corsOrigin;
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
    if (corsOrigin != null) {
      routing.addFilter((chain, req, res) -> {
        res.header(HeaderNames.create("Access-Control-Allow-Origin"), corsOrigin);
        res.header(HeaderNames.create("Access-Control-Allow-Headers"), "Authorization, Content-Type");
        res.header(HeaderNames.create("Access-Control-Allow-Methods"), "GET, POST, PUT, PATCH, DELETE, OPTIONS");
        if (req.prologue().method().text().equals("OPTIONS")) {
          res.status(Status.NO_CONTENT_204).send();
        } else {
          chain.proceed();
        }
      });
    }
    routing.get("/api/health", plain((req, res) -> json(res, 200, Map.of("status", "ok"))));
    routing.post("/api/auth/login", plain(this::login));
    routing.post("/api/auth/logout", plain((req, res) -> res.status(Status.NO_CONTENT_204).send()));
    routing.get("/api/auth/me", authed(null, (req, res, user) -> json(res, 200, Map.of("user", userJson(user)))));
    routing.post("/api/account/password", authed(null, this::changeMyPassword));
    routing.get("/api/admin/admins", authed(Role.admin, (req, res, user) -> json(res, 200, Map.of("admins", store.listAdmins()))));
    routing.post("/api/admin/admins", authed(Role.admin, this::addAdmin));
    routing.delete("/api/admin/admins/{id}", authed(Role.admin, this::removeAdmin));
  }

  // ---------------------------------------------------------------- plumbing

  private static void json(ServerResponse res, int status, Object body) {
    res.status(Status.create(status)).header(HeaderNames.CONTENT_TYPE, "application/json").header(HeaderNames.CACHE_CONTROL, "no-store").send(Json.write(body));
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
      var user = sessions.userFor(req.headers().first(HeaderNames.AUTHORIZATION).orElse(null));
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
      logFailure("missing-secret (SESSION_SECRET is unset or shorter than 32 characters)");
      error(res, 401, FAILED);
      return;
    }
    json(res, 200, Map.of("token", token, "user", userJson(result.user())));
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
    // The old session stops working with the old password, so hand back a new one for this device.
    json(res, 200, Map.of("token", sessions.start(user)));
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
}
