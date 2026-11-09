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

  public static Config fromEnv(Map<String, String> env) {
    return new Config(
        env.get("DATABASE_URL"),
        env.get("LR_COOKIE_SECRET"),
        flag(env.get("COOKIE_SECURE"), true),
        origins(env.get("ALLOWED_ORIGINS")),
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
}
