package app.lumiether.auth;

import app.lumiether.db.Store;
import app.lumiether.domain.Types.SessionUser;
import java.time.Instant;
import java.util.Optional;

/**
 * Sessions and role checks. A session is a signed token sent as "Authorization: Bearer ...". The user is looked
 * up fresh from the store on every request, and the role comes from the account, not the token.
 */
public final class Sessions {
  public static final long MAX_AGE_SECONDS = 60L * 60 * 24 * 7;

  /** Thrown when signing in is attempted without a usable SESSION_SECRET. */
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
    if (secret == null) throw new ConfigError("SESSION_SECRET must be set to a random string of at least 32 characters.");
    long exp = Instant.now().getEpochSecond() + MAX_AGE_SECONDS;
    String v = Token.passwordFingerprint(auth.credentialHashFor(user));
    return Token.sign(new Token.Payload(user.id(), user.role(), exp, v), secret);
  }

  /** The signed-in user for an Authorization header value, or empty. */
  public Optional<SessionUser> userFor(String authorizationHeader) {
    if (secret == null || authorizationHeader == null) return Optional.empty();
    String h = authorizationHeader.strip();
    if (h.length() < 8 || !h.regionMatches(true, 0, "Bearer ", 0, 7)) return Optional.empty();
    Token.Payload payload = Token.verify(h.substring(7).strip(), secret, Instant.now().getEpochSecond());
    if (payload == null) return Optional.empty();
    Optional<SessionUser> user = store.sessionUser(payload.sub(), payload.role());
    // A session only lasts until its password changes.
    return user.filter(u -> payload.v().equals(Token.passwordFingerprint(auth.credentialHashFor(u))));
  }
}
