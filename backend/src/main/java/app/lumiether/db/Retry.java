package app.lumiether.db;

import java.io.IOException;
import java.net.UnknownHostException;
import java.sql.SQLException;
import java.util.concurrent.Callable;
import java.util.regex.Pattern;

/** Retrying when the network, not the database, failed. */
public final class Retry {
  private Retry() {}

  private static final Pattern NETWORK_MESSAGE = Pattern.compile(
      "ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|Connection terminated"
          + "|timeout exceeded when trying to connect|Client has encountered a connection error"
          + "|connection attempt failed|Connection refused|Connection reset|Broken pipe"
          + "|Connection is not available, request timed out|I/O error",
      Pattern.CASE_INSENSITIVE);

  /** True when the connection to the database failed or dropped (timeout, DNS, reset), not the query itself. */
  public static boolean isNetworkError(Throwable error) {
    for (Throwable t = error; t != null; t = t.getCause() == t ? null : t.getCause()) {
      if (t instanceof IOException || t instanceof UnknownHostException) return true;
      if (t instanceof SQLException sql && sql.getSQLState() != null && sql.getSQLState().startsWith("08")) {
        return true; // SQLSTATE class 08: connection exception
      }
      String message = t.getMessage();
      if (message != null && NETWORK_MESSAGE.matcher(message).find()) return true;
    }
    return false;
  }

  /**
   * Runs {@code fn}, and runs it again (up to {@code retries} more times, with a short growing pause) if it
   * failed with a network error. Any other error is thrown straight away. Only use this for queries that are
   * safe to repeat, because after a network failure we can't tell whether the database saw the first try.
   */
  public static <T> T retryNetworkErrors(Callable<T> fn, int retries, long pauseMs) {
    for (int attempt = 0; ; attempt++) {
      try {
        return fn.call();
      } catch (Exception error) {
        if (attempt >= retries || !isNetworkError(error)) {
          if (error instanceof RuntimeException re) throw re;
          throw new RuntimeException(error);
        }
        try {
          Thread.sleep(pauseMs * (attempt + 1));
        } catch (InterruptedException interrupted) {
          Thread.currentThread().interrupt();
          throw new RuntimeException(interrupted);
        }
      }
    }
  }
}
