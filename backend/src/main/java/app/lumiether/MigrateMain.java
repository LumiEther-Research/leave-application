package app.lumiether;

import app.lumiether.db.Db;
import app.lumiether.db.Migrator;
import java.nio.file.Path;

/**
 * Applies db/migrations to DATABASE_URL (or DATABASE_URL_TEST with --test). Same job and same refusals as
 * scripts/migrate.mjs, which stays in place and can be used instead.
 */
public final class MigrateMain {
  private MigrateMain() {}

  public static void main(String[] args) {
    boolean useTest = java.util.Arrays.asList(args).contains("--test");
    String name = useTest ? "DATABASE_URL_TEST" : "DATABASE_URL";
    String url = System.getenv(name);
    if (url == null || url.isBlank()) {
      System.err.println(name + " is not set.");
      System.exit(1);
    }
    if (useTest && url.equals(System.getenv("DATABASE_URL"))) {
      System.err.println("DATABASE_URL_TEST must be a different database from DATABASE_URL.");
      System.exit(1);
    }
    try (Db db = new Db(url)) {
      var applied = Migrator.migrate(db, Path.of(Config.fromEnv(System.getenv()).migrationsDir()));
      applied.forEach(f -> System.out.println("applied " + f));
      System.out.println(applied.isEmpty() ? "Already up to date." : "Done: " + applied.size() + " migration(s) applied.");
    }
  }
}
