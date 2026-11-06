package app.lumiether.auth;

import app.lumiether.auth.Token.Role;
import app.lumiether.db.Store;
import app.lumiether.domain.Employees;
import app.lumiether.domain.Types.SessionUser;
import java.util.LinkedHashMap;
import java.util.Map;

/** Changing your own password. No HTTP here, so it can be tested. */
public final class ChangePassword {
  private final Store store;
  private final Auth auth;

  public ChangePassword(Store store, Auth auth) {
    this.store = store;
    this.auth = auth;
  }

  public record Input(String current, String next, String confirm) {}

  /** Field name to message ("current", "next", "confirm", "form"). Empty when fine. */
  public static Map<String, String> validate(Input input) {
    Map<String, String> errors = new LinkedHashMap<>();
    if (input.current().isEmpty()) errors.put("current", "Enter your current password.");
    if (input.next().length() < Employees.MIN_PASSWORD_LENGTH)
      errors.put("next", "Use at least " + Employees.MIN_PASSWORD_LENGTH + " characters.");
    else if (input.next().length() > Employees.MAX_PASSWORD_LENGTH)
      errors.put("next", "Use at most " + Employees.MAX_PASSWORD_LENGTH + " characters.");
    else if (input.next().equals(input.current())) errors.put("next", "Choose a password you aren't already using.");
    if (!errors.containsKey("next") && !input.confirm().equals(input.next()))
      errors.put("confirm", "The two new passwords don't match.");
    return errors;
  }

  /** Empty map on success, otherwise the field errors. */
  public Map<String, String> change(SessionUser user, Input input) {
    Map<String, String> errors = validate(input);
    // Always check the current password, so the wrong one is reported alongside other problems.
    if (!input.current().isEmpty() && !Password.verify(input.current(), auth.credentialHashFor(user))) {
      errors.put("current", "That isn't your current password.");
    }
    if (!errors.isEmpty()) return errors;

    String hash = Password.hash(input.next());
    boolean saved = user.role() == Role.admin
        ? store.setAdminPasswordHash(user.id(), hash)
        : store.setEmployeePasswordHash(user.id(), hash);
    if (!saved) return Map.of("form", "Your account no longer exists.");
    return Map.of();
  }
}
