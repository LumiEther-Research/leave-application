package app.lumiether.db;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The one Postgres connection pool, reading DATABASE_URL (a postgres:// URL such as Neon's pooled string, or a
 * jdbc:postgresql:// URL). Max 5 connections. SQL is written with $1, $2, ... exactly as in the Node app and
 * is rewritten to JDBC placeholders here, so the queries can be compared line for line.
 */
public final class Db implements AutoCloseable {
  /** The most connections one server instance holds open. */
  public static final int MAX_CONNECTIONS = 5;

  private static final Pattern PLACEHOLDER = Pattern.compile("\\$(\\d+)");
  private static final Pattern IS_READ = Pattern.compile("^\\s*(select|with)\\b", Pattern.CASE_INSENSITIVE);
  private static final Pattern IS_WRITE = Pattern.compile("\\b(insert|update|delete)\\b", Pattern.CASE_INSENSITIVE);
  private static final Pattern UUID = Pattern.compile("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", Pattern.CASE_INSENSITIVE);

  private final HikariDataSource pool;

  public Db(String databaseUrl) {
    if (databaseUrl == null || databaseUrl.isBlank()) {
      throw new IllegalStateException("DATABASE_URL is not set. Add your Postgres connection string to the environment.");
    }
    HikariConfig config = new HikariConfig();
    applyUrl(config, databaseUrl);
    config.setMaximumPoolSize(MAX_CONNECTIONS);
    config.setMinimumIdle(0); // open lazily, like the Node pool
    config.setConnectionTimeout(10_000);
    config.setIdleTimeout(30_000);
    config.setPoolName("lumiether");
    this.pool = new HikariDataSource(config);
  }

  /** Accepts postgres://user:pass@host:port/db?sslmode=require or an existing jdbc: URL. */
  static void applyUrl(HikariConfig config, String url) {
    if (url.startsWith("jdbc:")) {
      config.setJdbcUrl(url);
    } else {
      URI uri = URI.create(url.replaceFirst("^postgres(ql)?://", "http://"));
      String query = uri.getRawQuery() == null ? "" : uri.getRawQuery();
      if (uri.getRawUserInfo() != null) {
        String[] parts = uri.getRawUserInfo().split(":", 2);
        config.setUsername(URLDecoder.decode(parts[0], StandardCharsets.UTF_8));
        if (parts.length > 1) config.setPassword(URLDecoder.decode(parts[1], StandardCharsets.UTF_8));
      }
      int port = uri.getPort() == -1 ? 5432 : uri.getPort();
      config.setJdbcUrl("jdbc:postgresql://" + uri.getHost() + ":" + port + uri.getRawPath() + (query.isEmpty() ? "" : "?" + query));
    }
    // node-pg sends every parameter as untyped text and lets Postgres infer the type; this does the same, so the
    // SQL can be copied over unchanged. prepareThreshold=0 keeps it safe behind a transaction-mode pooler (Neon).
    config.addDataSourceProperty("stringtype", "unspecified");
    config.addDataSourceProperty("prepareThreshold", "0");
  }

  /**
   * Runs one parameterised query ($1, $2, ...) and returns its rows. A read (select) that fails because the
   * network dropped is tried again a couple of times; a write never is, so it can't run twice.
   */
  public List<Row> query(String sql, Object... params) {
    boolean read = IS_READ.matcher(sql).find() && !IS_WRITE.matcher(sql).find();
    return read ? Retry.retryNetworkErrors(() -> run(sql, params), 2, 200) : run(sql, params);
  }

  private List<Row> run(String sql, Object[] params) {
    List<Object> ordered = new ArrayList<>();
    Matcher m = PLACEHOLDER.matcher(sql);
    StringBuilder jdbc = new StringBuilder();
    while (m.find()) {
      ordered.add(params[Integer.parseInt(m.group(1)) - 1]);
      m.appendReplacement(jdbc, "?");
    }
    m.appendTail(jdbc);
    try (Connection c = pool.getConnection(); PreparedStatement st = c.prepareStatement(jdbc.toString())) {
      for (int i = 0; i < ordered.size(); i++) st.setObject(i + 1, ordered.get(i));
      boolean hasResult = st.execute();
      List<Row> rows = new ArrayList<>();
      if (!hasResult) return rows;
      try (ResultSet rs = st.getResultSet()) {
        ResultSetMetaData md = rs.getMetaData();
        while (rs.next()) {
          Map<String, Object> row = new LinkedHashMap<>();
          for (int i = 1; i <= md.getColumnCount(); i++) {
            Object v = rs.getObject(i);
            row.put(md.getColumnLabel(i), v instanceof java.util.UUID u ? u.toString() : v);
          }
          rows.add(new Row(row));
        }
      }
      return rows;
    } catch (SQLException e) {
      throw new DbException(e);
    }
  }

  /** Runs a block on one connection inside a transaction (used by the migration runner). */
  public <T> T inTransaction(TransactionBody<T> body) {
    try (Connection c = pool.getConnection()) {
      c.setAutoCommit(false);
      try {
        T result = body.run(c);
        c.commit();
        return result;
      } catch (Exception e) {
        c.rollback();
        if (e instanceof SQLException sql) throw new DbException(sql);
        if (e instanceof RuntimeException re) throw re;
        throw new RuntimeException(e);
      }
    } catch (SQLException e) {
      throw new DbException(e);
    }
  }

  @FunctionalInterface
  public interface TransactionBody<T> {
    T run(Connection connection) throws Exception;
  }

  /** The SQLSTATE of a failed query, e.g. "23505" for a unique violation, or null. */
  public static String sqlState(Throwable error) {
    for (Throwable t = error; t != null; t = t.getCause() == t ? null : t.getCause()) {
      if (t instanceof SQLException sql && sql.getSQLState() != null) return sql.getSQLState();
    }
    return null;
  }

  /** True for a unique-constraint violation. */
  public static boolean isUniqueViolation(Throwable error) {
    return "23505".equals(sqlState(error));
  }

  /** Ids are uuids. Anything else can't exist, and would make Postgres throw if used in a query. */
  public static boolean isUuid(Object value) {
    return value instanceof String s && UUID.matcher(s).matches();
  }

  @Override
  public void close() {
    pool.close();
  }
}
