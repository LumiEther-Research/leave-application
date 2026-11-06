package app.lumiether.db;

import static org.junit.jupiter.api.Assertions.*;

import java.net.UnknownHostException;
import java.sql.SQLException;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

/** Port of retry.test.ts: retrying reads when the network fails, without a database. */
class RetryTest {
  private static SQLException networkError() {
    return new SQLException("connect ETIMEDOUT 10.0.0.1:5432", "08001");
  }

  @Test
  void aTimeoutAResetADroppedOrUnreachableConnectionAreNetworkErrorsADatabaseErrorIsNot() {
    assertTrue(Retry.isNetworkError(networkError()));
    assertTrue(Retry.isNetworkError(new RuntimeException("read ECONNRESET")));
    assertTrue(Retry.isNetworkError(new RuntimeException("Connection terminated unexpectedly")));
    assertTrue(Retry.isNetworkError(new RuntimeException("timeout exceeded when trying to connect")));
    assertTrue(Retry.isNetworkError(new UnknownHostException("getaddrinfo")));
    assertTrue(Retry.isNetworkError(new DbException(new SQLException("An I/O error occurred while sending to the backend.", "08006"))));
    assertFalse(Retry.isNetworkError(new RuntimeException("duplicate key value violates unique constraint \"admins_email_key\"")));
    assertFalse(Retry.isNetworkError(new RuntimeException("password authentication failed for user")));
    assertFalse(Retry.isNetworkError(null));
    assertFalse(Retry.isNetworkError(new SQLException("duplicate key", "23505")));
  }

  @Test
  void returnsTheFirstSuccessWithoutRetrying() {
    AtomicInteger calls = new AtomicInteger();
    assertEquals("ok", Retry.retryNetworkErrors(() -> { calls.incrementAndGet(); return "ok"; }, 2, 1));
    assertEquals(1, calls.get());
  }

  @Test
  void triesAgainAfterANetworkErrorAndReturnsTheLaterSuccess() {
    AtomicInteger calls = new AtomicInteger();
    String result = Retry.retryNetworkErrors(() -> {
      if (calls.incrementAndGet() < 3) throw networkError();
      return "recovered";
    }, 2, 1);
    assertEquals("recovered", result);
    assertEquals(3, calls.get());
  }

  @Test
  void givesUpAfterTheRetriesAndThrowsTheNetworkError() {
    AtomicInteger calls = new AtomicInteger();
    Exception e = assertThrows(Exception.class, () -> Retry.retryNetworkErrors(() -> { calls.incrementAndGet(); throw networkError(); }, 2, 1));
    assertTrue(e.getMessage().contains("ETIMEDOUT"));
    assertEquals(3, calls.get()); // the first try and two retries
  }

  @Test
  void neverRetriesADatabaseError() {
    AtomicInteger calls = new AtomicInteger();
    Exception e = assertThrows(Exception.class, () -> Retry.retryNetworkErrors(() -> { calls.incrementAndGet(); throw new RuntimeException("syntax error"); }, 2, 1));
    assertTrue(e.getMessage().contains("syntax error"));
    assertEquals(1, calls.get());
  }
}
