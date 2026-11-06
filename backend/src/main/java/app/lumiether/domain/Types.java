package app.lumiether.domain;

import app.lumiether.auth.Token.Role;
import java.util.List;
import java.util.Map;

/** Plain data types and policy constants. */
public final class Types {
  private Types() {}

  public static final List<String> CATEGORIES = List.of("contractor", "employee", "intern", "student");

  public record Admin(String id, String name, String email) {}

  public record StoredAdmin(String id, String name, String email, String passwordHash) {
    public Admin toAdmin() {
      return new Admin(id, name, email);
    }
  }

  /** {@code leaveAllowance} is the days an admin set for the employee's category. Never sent to employees. */
  public record Employee(String id, String name, String email, String category, int leaveAllowance, String joiningDate) {}

  public record StoredEmployee(Employee employee, String passwordHash) {}

  public record LeaveCategory(String category, int daysPerYear) {}

  public record Holiday(String name, int month, int day) {}

  public record SessionUser(String id, String name, String email, Role role) {}

  /** Field name to message. Empty when valid. */
  public static Map<String, String> noErrors() {
    return Map.of();
  }
}
