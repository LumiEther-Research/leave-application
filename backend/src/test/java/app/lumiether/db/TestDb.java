package app.lumiether.db;

import java.io.IOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Assumptions;

/**
 * Test harness for the database-backed suites, the counterpart of test-db.ts. They run against a separate test
 * database, never the real one: the connection string must be in DATABASE_URL_TEST (shell or ../.env.local), it
 * must point somewhere other than DATABASE_URL, and the tests empty its tables. The schema is applied with the
 * Java migration runner, which is a no-op when it is already there.
 */
public final class TestDb {
  private TestDb() {}

  private static String env(String name) {
    String v = System.getenv(name);
    if (v != null) return v;
    Path file = Path.of("..", ".env.local");
    if (Files.exists(file)) {
      try {
        Pattern line = Pattern.compile("^\\s*" + name + "\\s*=\\s*(.*?)\\s*$");
        for (String l : Files.readAllLines(file)) {
          Matcher m = line.matcher(l);
          if (m.find()) return m.group(1).replaceAll("^([\"'])(.*)\\1$", "$2");
        }
      } catch (IOException ignored) {
        // fall through
      }
    }
    return null;
  }

  private static String host(String url) {
    try {
      return URI.create(url.replaceFirst("^(jdbc:)?postgres(ql)?://", "http://")).getHost();
    } catch (Exception e) {
      return null;
    }
  }

  /** Why the database suites can't run, or null if they can. */
  public static final String SKIP_REASON = reason();

  private static String reason() {
    String test = env("DATABASE_URL_TEST");
    String real = env("DATABASE_URL");
    if (test == null || test.isBlank()) {
      return "DATABASE_URL_TEST is not set. Point it at a test database (for example a Neon test branch) to run these tests.";
    }
    if (real != null && !real.isBlank() && (test.equals(real) || java.util.Objects.equals(host(test), host(real)))) {
      return "DATABASE_URL_TEST points at the same database as DATABASE_URL. Refusing to run: these tests empty the tables.";
    }
    return null;
  }

  private static Db shared;

  public static synchronized Db db() {
    if (shared == null) {
      shared = new Db(env("DATABASE_URL_TEST"));
      Migrator.migrate(shared, Path.of("..", "db", "migrations"));
    }
    return shared;
  }

  /** Skips the calling test when there is no safe test database. */
  public static void requireDatabase() {
    if (SKIP_REASON != null) System.err.println("\n⚠️  Skipping the database tests. " + SKIP_REASON + "\n");
    Assumptions.assumeTrue(SKIP_REASON == null, SKIP_REASON);
  }

  /** Empties every table the tests write to and puts the category days back to the seeded 24. Seeded holidays stay. */
  public static Db reset() {
    requireDatabase();
    Db db = db();
    db.query("truncate permissions, leave_requests, comp_off_claims, employees, admins restart identity cascade");
    db.query("update leave_categories set days_per_year = 24");
    return db;
  }
}
