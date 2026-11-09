package app.lumiether.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.text.Normalizer;
import java.util.Base64;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicInteger;
import org.bouncycastle.crypto.generators.SCrypt;

/**
 * Password hashing, compatible with the Node app: "scrypt:&lt;salt&gt;:&lt;hash&gt;" (base64url, no padding), made by
 * Node's scrypt defaults (N=16384, r=8, p=1), a 64-byte key and the NFKC-normalised password. The separator is ":"
 * because "$" gets expanded inside .env files. Bouncy Castle supplies scrypt, which the JDK does not have.
 */
public final class Password {
  private Password() {}

  private static final int KEY_LENGTH = 64;
  private static final int N = 16384;
  private static final int R = 8;
  private static final int P = 1;
  private static final String PREFIX = "scrypt";
  private static final SecureRandom RANDOM = new SecureRandom();
  private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();

  /**
   * Each scrypt run needs about 16 MiB (128 * N * r bytes) for a moment and a full CPU core. Node ran them on libuv's
   * four-thread pool, which quietly capped how many ran at once. Here every request is its own virtual thread, so
   * without a cap a burst of sign-ins allocates 16 MiB each, all together, and the container is killed for running
   * out of memory (seen in the stress test: 8 concurrent sign-ins on a 768 MB container). Extra requests wait their
   * turn instead; throughput is the same, because the CPU was the limit anyway.
   */
  static final int SLOTS = Integer.getInteger("lumiether.scrypt.slots", Math.max(2, Math.min(4, Runtime.getRuntime().availableProcessors())));
  private static final Semaphore TURNS = new Semaphore(SLOTS);
  private static final AtomicInteger ACTIVE = new AtomicInteger();
  private static final AtomicInteger PEAK = new AtomicInteger();

  /** The most scrypt runs that were ever going at once (for the test). */
  static int peakConcurrent() {
    return PEAK.get();
  }

  private static byte[] derive(String password, byte[] salt) {
    byte[] pw = Normalizer.normalize(password, Normalizer.Form.NFKC).getBytes(StandardCharsets.UTF_8);
    TURNS.acquireUninterruptibly();
    try {
      PEAK.accumulateAndGet(ACTIVE.incrementAndGet(), Math::max);
      return SCrypt.generate(pw, salt, N, R, P, KEY_LENGTH);
    } finally {
      ACTIVE.decrementAndGet();
      TURNS.release();
    }
  }

  public static String hash(String password) {
    byte[] salt = new byte[16];
    RANDOM.nextBytes(salt);
    return PREFIX + ":" + B64.encodeToString(salt) + ":" + B64.encodeToString(derive(password, salt));
  }

  private static byte[] decode(String s) {
    try {
      return Base64.getUrlDecoder().decode(s);
    } catch (IllegalArgumentException e) {
      return null;
    }
  }

  /** Whether {@code stored} looks like a hash made by {@link #hash} ("scrypt:salt:hash"), whatever the password. */
  public static boolean isPasswordHash(String stored) {
    String[] parts = (stored == null ? "" : stored).split(":", -1);
    if (parts.length != 3 || !PREFIX.equals(parts[0]) || parts[1].isEmpty() || parts[2].isEmpty()) return false;
    byte[] key = decode(parts[2]);
    return key != null && key.length == KEY_LENGTH;
  }

  /** False for a wrong password and for anything that isn't a valid stored hash. */
  public static boolean verify(String password, String stored) {
    String[] parts = (stored == null ? "" : stored).split(":", -1);
    if (parts.length != 3 || !PREFIX.equals(parts[0]) || parts[1].isEmpty() || parts[2].isEmpty()) return false;
    byte[] expected = decode(parts[2]);
    byte[] salt = decode(parts[1]);
    if (expected == null || salt == null || expected.length != KEY_LENGTH) return false;
    return MessageDigest.isEqual(derive(password, salt), expected);
  }

  /** A valid-looking hash nobody has the password for, checked when the email is unknown so timing doesn't reveal it. */
  public static final String DUMMY_HASH =
      PREFIX + ":" + B64.encodeToString(new byte[16]) + ":" + B64.encodeToString(new byte[KEY_LENGTH]);
}
