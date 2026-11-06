package app.lumiether.db;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Applies db/migrations/*.sql, oldest first. Same behaviour as scripts/migrate.mjs, which stays in place: each
 * file runs as one transaction, statements are separated by a line holding only "-- split", and the file name is
 * recorded in the same schema_migrations table, so either tool can run after the other and nothing repeats.
 */
public final class Migrator {
  private static final Pattern SPLIT = Pattern.compile("^-- split\\s*$", Pattern.MULTILINE);

  private Migrator() {}

  /** Names of the files applied by this call. */
  public static List<String> migrate(Db db, Path dir) {
    db.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
    Set<String> done = new HashSet<>();
    for (Row r : db.query("select name from schema_migrations")) done.add(r.str("name"));

    List<Path> files;
    try (Stream<Path> s = Files.list(dir)) {
      files = s.filter(p -> p.getFileName().toString().endsWith(".sql")).sorted().toList();
    } catch (IOException e) {
      throw new IllegalStateException("Can't read migrations in " + dir + ": " + e.getMessage(), e);
    }

    List<String> applied = new ArrayList<>();
    for (Path file : files) {
      String name = file.getFileName().toString();
      if (done.contains(name)) continue;
      String content;
      try {
        content = Files.readString(file);
      } catch (IOException e) {
        throw new IllegalStateException("Can't read " + file + ": " + e.getMessage(), e);
      }
      List<String> statements = SPLIT.splitAsStream(content).map(String::strip).filter(x -> !x.isEmpty()).toList();
      db.inTransaction(c -> {
        for (String statement : statements) {
          try (Statement st = c.createStatement()) {
            st.execute(statement);
          }
        }
        try (var st = c.prepareStatement("insert into schema_migrations (name) values (?)")) {
          st.setString(1, name);
          st.executeUpdate();
        }
        return null;
      });
      applied.add(name);
    }
    return applied;
  }
}
