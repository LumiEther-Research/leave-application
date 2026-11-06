package app.lumiether.db;

import java.sql.SQLException;

/** A failed query. The original {@link SQLException} is the cause; use {@link Db#sqlState} to read its code. */
public class DbException extends RuntimeException {
  public DbException(SQLException cause) {
    super(cause.getMessage(), cause);
  }
}
