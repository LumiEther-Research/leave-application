package app.lumiether;

import java.util.Map;

/** Everything comes from the environment, as in the Node app (see .env.example). */
public record Config(
    String databaseUrl,
    String sessionSecret,
    String adminEmail,
    String adminPasswordHash,
    String pdfServiceUrl,
    String cronSecret,
    int port,
    String migrationsDir,
    String corsOrigin) {

  public static Config fromEnv(Map<String, String> env) {
    return new Config(
        env.get("DATABASE_URL"),
        env.get("SESSION_SECRET"),
        env.get("ADMIN_EMAIL"),
        env.get("ADMIN_PASSWORD_HASH"),
        env.get("PDF_SERVICE_URL"),
        env.get("CRON_SECRET"),
        Integer.parseInt(env.getOrDefault("PORT", "8080")),
        env.getOrDefault("MIGRATIONS_DIR", "../db/migrations"),
        env.get("CORS_ORIGIN"));
  }
}
