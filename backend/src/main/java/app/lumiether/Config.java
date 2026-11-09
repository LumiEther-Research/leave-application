package app.lumiether;

import app.lumiether.web.CsrfGuard;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * Everything comes from the environment (see deploy/.env.example).
 *
 * <p>{@code SESSION_SECRET} is retired for the rebuild: the Node app used it, this backend does not read it. User
 * sessions are signed with {@code LR_COOKIE_SECRET}, a separate secret.
 */
public record Config(
    String databaseUrl,
    String cookieSecret,
    boolean cookieSecure,
    List<String> allowedOrigins,
    String adminEmail,
    String adminPasswordHash,
    String pdfServiceUrl,
    String cronSecret,
    int port,
    String migrationsDir) {

  /** Thrown at startup when the settings are unsafe. The message says what to change. */
  public static final class Invalid extends IllegalStateException {
    public Invalid(String message) {
      super(message);
    }
  }

  public static Config fromEnv(Map<String, String> env) {
    boolean secure = flag(env.get("COOKIE_SECURE"), true);
    List<String> origins = origins(env.get("ALLOWED_ORIGINS"));
    if (secure) rejectLocalOrigins(origins);
    return new Config(
        env.get("DATABASE_URL"),
        env.get("LR_COOKIE_SECRET"),
        secure,
        origins,
        env.get("ADMIN_EMAIL"),
        env.get("ADMIN_PASSWORD_HASH"),
        env.get("PDF_SERVICE_URL"),
        env.get("CRON_SECRET"),
        Integer.parseInt(env.getOrDefault("PORT", "8080")),
        env.getOrDefault("MIGRATIONS_DIR", "../db/migrations"));
  }

  /** Unset or blank gives the default; "false", "0", "no" and "off" are false; anything else is true. */
  static boolean flag(String value, boolean dflt) {
    if (value == null || value.isBlank()) return dflt;
    return !List.of("false", "0", "no", "off").contains(value.strip().toLowerCase());
  }

  /** A comma or space separated list, normalised (lower case, no trailing slash), blanks dropped. */
  static List<String> origins(String value) {
    if (value == null) return List.of();
    return Arrays.stream(value.split("[,\\s]+")).map(CsrfGuard::normalizeOrigin).filter(s -> !s.isEmpty()).distinct().toList();
  }

  /**
   * With COOKIE_SECURE=true (production) a development origin such as the Vite server's http://localhost:5173 must not be
   * trusted: any page a visitor opens on their own machine's localhost would pass the CSRF check. Refuse to start.
   */
  static void rejectLocalOrigins(List<String> origins) {
    List<String> local = origins.stream().filter(Config::isLocalOrigin).toList();
    if (!local.isEmpty()) {
      throw new Invalid("ALLOWED_ORIGINS contains " + String.join(", ", local) + ", but COOKIE_SECURE is true (production). "
          + "Remove localhost, 127.0.0.1 and [::1] from ALLOWED_ORIGINS and use only the public https address, "
          + "or set COOKIE_SECURE=false for local development.");
    }
  }

  /** True for a host of exactly localhost, 127.0.0.1 or [::1], with any scheme or port. */
  static boolean isLocalOrigin(String origin) {
    String rest = origin.contains("://") ? origin.substring(origin.indexOf("://") + 3) : origin;
    int slash = rest.indexOf('/');
    if (slash >= 0) rest = rest.substring(0, slash);
    String host = rest.startsWith("[") ? rest.substring(0, rest.indexOf(']') < 0 ? rest.length() : rest.indexOf(']') + 1)
        : rest.contains(":") ? rest.substring(0, rest.indexOf(':')) : rest;
    return List.of("localhost", "127.0.0.1", "[::1]").contains(host);
  }
}
