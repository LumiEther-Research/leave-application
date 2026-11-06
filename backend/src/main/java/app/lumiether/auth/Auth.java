package app.lumiether.auth;

import app.lumiether.auth.Token.Role;
import app.lumiether.db.Db;
import app.lumiether.db.Store;
import app.lumiether.domain.Employees;
import app.lumiether.domain.Types.*;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.function.Supplier;

/**
 * Who can sign in, and checking a password. Port of users.ts. No HTTP here, so it can be tested. The bootstrap
 * admin settings come in through a supplier, because the tests change them between calls.
 */
public final class Auth {
  /** ADMIN_EMAIL and ADMIN_PASSWORD_HASH, either may be null. */
  public record Bootstrap(String email, String passwordHash) {}

  /**
   * Why a sign-in failed. For server logs only: the browser always gets the same generic message, so none of
   * these may be shown to the user.
   */
  public enum Failure {
    UNKNOWN_EMAIL("unknown-email"),
    ADMIN_NOT_CONFIGURED("admin-not-configured"),
    BOOTSTRAP_CLOSED("bootstrap-closed"),
    MISSING_ADMIN_HASH("missing-admin-hash"),
    MALFORMED_ADMIN_HASH("malformed-admin-hash"),
    WRONG_PASSWORD("wrong-password");

    public final String code;

    Failure(String code) {
      this.code = code;
    }
  }

  public record Result(SessionUser user, Failure failure) {
    public boolean ok() {
      return user != null;
    }

    static Result ok(SessionUser user) {
      return new Result(user, null);
    }

    static Result fail(Failure f) {
      return new Result(null, f);
    }
  }

  private final Store store;
  private final Supplier<Bootstrap> bootstrap;

  public Auth(Store store, Supplier<Bootstrap> bootstrap) {
    this.store = store;
    this.bootstrap = bootstrap;
  }

  private static SessionUser adminUser(Admin a) {
    return new SessionUser(a.id(), a.name(), a.email(), Role.admin);
  }

  /** The stored password hash for a signed-in user, or "" if there isn't one. */
  public String credentialHashFor(SessionUser user) {
    return user.role() == Role.admin
        ? store.findAdminById(user.id()).map(StoredAdmin::passwordHash).orElse("")
        : store.findEmployeeById(user.id()).map(StoredEmployee::passwordHash).orElse("");
  }

  /**
   * ADMIN_EMAIL and ADMIN_PASSWORD_HASH are only a bootstrap: while the database has no admins at all, they let
   * the first admin sign in, and that admin is then saved as an ordinary admin row. Once any admin exists they're
   * ignored, so removing or changing admins in the app is final.
   */
  private Result bootstrapAdmin(String email, String password) {
    Bootstrap env = bootstrap.get();
    String envEmail = env.email() == null ? "" : env.email().strip().toLowerCase(Locale.ROOT);
    if (envEmail.isEmpty()) return Result.fail(Failure.ADMIN_NOT_CONFIGURED);
    if (!email.equals(envEmail)) return Result.fail(Failure.UNKNOWN_EMAIL);
    if (store.countAdmins() > 0) return Result.fail(Failure.BOOTSTRAP_CLOSED);

    String hash = env.passwordHash();
    boolean hasHash = hash != null && !hash.isEmpty();
    boolean ok = Password.verify(password, hasHash ? hash : Password.DUMMY_HASH);
    if (!hasHash) return Result.fail(Failure.MISSING_ADMIN_HASH);
    if (!Password.isPasswordHash(hash)) return Result.fail(Failure.MALFORMED_ADMIN_HASH);
    if (!ok) return Result.fail(Failure.WRONG_PASSWORD);

    try {
      return Result.ok(adminUser(store.createAdmin(Employees.nameFromEmail(email), email, hash)));
    } catch (RuntimeException error) {
      // Two first sign-ins at the same moment: the other one created the row.
      if (!Db.isUniqueViolation(error)) throw error;
      Optional<StoredAdmin> existing = store.findAdminByEmail(email);
      return existing.map(a -> Result.ok(adminUser(a.toAdmin()))).orElse(Result.fail(Failure.UNKNOWN_EMAIL));
    }
  }

  /** Every path does one password check, so timing doesn't reveal which emails exist. */
  public Result authenticate(String email, String password) {
    String normalized = email.strip().toLowerCase(Locale.ROOT);

    Optional<StoredAdmin> admin = store.findAdminByEmail(normalized);
    if (admin.isPresent()) {
      boolean ok = Password.verify(password, admin.get().passwordHash());
      return ok ? Result.ok(adminUser(admin.get().toAdmin())) : Result.fail(Failure.WRONG_PASSWORD);
    }

    Optional<StoredEmployee> employee = store.findEmployeeByEmail(normalized);
    boolean ok = Password.verify(password, employee.map(StoredEmployee::passwordHash).orElse(Password.DUMMY_HASH));
    if (employee.isPresent()) {
      if (!ok) return Result.fail(Failure.WRONG_PASSWORD);
      Employee e = employee.get().employee();
      return Result.ok(new SessionUser(e.id(), e.name(), e.email(), Role.employee));
    }
    return bootstrapAdmin(normalized, password);
  }

  /** True if this email is an admin's or an employee's, or is the bootstrap ADMIN_EMAIL. */
  public boolean isEmailInUse(String email) {
    String envEmail = bootstrap.get().email() == null ? null : bootstrap.get().email().strip().toLowerCase(Locale.ROOT);
    return email.strip().toLowerCase(Locale.ROOT).equals(envEmail) || store.isEmailTaken(email);
  }

  /**
   * Removes an admin. They're signed out straight away, because a session is looked up on every request. Nobody
   * can remove themselves, and the last admin can't be removed.
   */
  public Store.Result removeAdmin(SessionUser actor, String targetId) {
    if (actor.id().equals(targetId)) return Store.Result.fail("You can't remove your own admin account.");
    List<Admin> admins = store.listAdmins();
    if (admins.stream().noneMatch(a -> a.id().equals(targetId))) return Store.Result.fail("That admin no longer exists.");
    if (admins.size() <= 1) return Store.Result.fail("There has to be at least one admin.");
    return store.deleteAdmin(actor.id(), targetId); // the database enforces the last-admin rule again
  }
}
