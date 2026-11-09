package app.lumiether.auth;

import app.lumiether.db.Store;
import app.lumiether.domain.Types.SessionUser;
import java.time.Instant;
import java.util.Optional;

/**
 * Sessions and role checks. A session is a signed token kept in an httpOnly cookie named {@value #COOKIE_NAME}, so no
 * script on the page can read it. The user is looked up fresh from the store on every request, and the role comes from
 * the account, not the token. The token is signed with LR_COOKIE_SECRET, which is not the Node app's SESSION_SECRET,
 * so a session from the Node app is not accepted and everyone signs in again at cutover.
 */
public final class Sessions {
  public static final String COOKIE_NAME = "lr_session";
  public static final long MAX_AGE_SECONDS = 60L * 60 * 24 * 7;

  /** Thrown when signing in is attempted without a usable LR_COOKIE_SECRET. */
  public static final class ConfigError extends RuntimeException {
    public ConfigError(String message) {
      super(message);
    }
  }

  private final Store store;
  private final Auth auth;
  private final String secret;

  /** {@code secret} may be null or short, which means nobody can be signed in. */
  public Sessions(Store store, Auth auth, String secret) {
    this.store = store;
    this.auth = auth;
    this.secret = secret != null && secret.length() >= 32 ? secret : null;
  }

  public String start(SessionUser user) {
    if (secret == null) throw new ConfigError("LR_COOKIE_SECRET must be set to a random string of at least 32 characters.");
    long exp = Instant.now().getEpochSecond() + MAX_AGE_SECONDS;
    String v = Token.passwordFingerprint(auth.credentialHashFor(user));
    return Token.sign(new Token.Payload(user.id(), user.role(), exp, v), secret);
  }

  /** The signed-in user for a Cookie request header, or empty. */
  public Optional<SessionUser> userForCookie(String cookieHeader) {
    String token = cookieValue(cookieHeader, COOKIE_NAME);
    if (secret == null || token == null || token.isEmpty()) return Optional.empty();
    Token.Payload payload = Token.verify(token, secret, Instant.now().getEpochSecond());
    if (payload == null) return Optional.empty();
    Optional<SessionUser> user = store.sessionUser(payload.sub(), payload.role());
    // A session only lasts until its password changes.
    return user.filter(u -> payload.v().equals(Token.passwordFingerprint(auth.credentialHashFor(u))));
  }

  /** The value of one cookie in a Cookie header ("a=1; lr_session=xyz; b=2"), or null. The first one wins. */
  public static String cookieValue(String cookieHeader, String name) {
    if (cookieHeader == null) return null;
    for (String part : cookieHeader.split(";")) {
      String p = part.strip();
      int eq = p.indexOf('=');
      if (eq > 0 && p.substring(0, eq).strip().equals(name)) return p.substring(eq + 1).strip();
    }
    return null;
  }

  /** The Set-Cookie value that starts a session: httpOnly, SameSite=Lax, seven days, Secure when asked. */
  public static String setCookie(String token, boolean secure) {
    return COOKIE_NAME + "=" + token + "; Path=/; Max-Age=" + MAX_AGE_SECONDS + "; HttpOnly; SameSite=Lax" + (secure ? "; Secure" : "");
  }

  /** The Set-Cookie value that ends it: same name, path and attributes, empty, already expired. */
  public static String clearCookie(boolean secure) {
    return COOKIE_NAME + "=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax" + (secure ? "; Secure" : "");
  }
}
