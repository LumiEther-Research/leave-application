package app.lumiether.db;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;

class MigratorTest {
  private static final Path DIR = Path.of("..", "db", "migrations");

  @Test
  void runningItAgainAppliesNothing() {
    TestDb.requireDatabase();
    Db db = TestDb.db(); // already migrated once by the harness
    assertEquals(List.of(), Migrator.migrate(db, DIR));
  }

  @Test
  void everyMigrationFileIsRecordedByItsFileNameInTheSameTableTheNodeScriptUses() throws Exception {
    TestDb.requireDatabase();
    Db db = TestDb.db();
    List<String> files;
    try (var s = Files.list(DIR)) {
      files = s.map(p -> p.getFileName().toString()).filter(n -> n.endsWith(".sql")).sorted().toList();
    }
    List<String> recorded = db.query("select name from schema_migrations order by name").stream().map(r -> r.str("name")).toList();
    assertEquals(files, recorded);
    assertEquals(List.of("001_init.sql", "002_categories_permissions.sql", "003_payslips.sql", "004_payslip_drafts.sql"), files);
  }

  @Test
  void theSchemaIsTheOneTheNodeAppExpects() {
    TestDb.requireDatabase();
    Db db = TestDb.db();
    List<String> tables = db.query("select table_name from information_schema.tables where table_schema = 'public' order by table_name")
        .stream().map(r -> r.str("table_name")).toList();
    for (String t : List.of("admins", "employees", "holidays", "leave_categories", "leave_requests", "comp_off_claims", "permissions", "payslips", "schema_migrations")) {
      assertTrue(tables.contains(t), t);
    }
    assertEquals(4, db.query("select * from holidays").size());
  }
}
