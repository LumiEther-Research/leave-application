package app.lumiether.web;

import java.net.URI;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * The CSRF rules for a cookie session. The session cookie is SameSite=Lax, so a browser does not attach it to a
 * cross-site POST, PUT, PATCH or DELETE; this adds two more layers that do not depend on the browser's SameSite
 * support:
 * <ol>
 *   <li>a state-changing request must come from an allowed origin: its {@code Origin} header (or, when there is no
 *       Origin, its {@code Referer}) must be in the allow-list;</li>
 *   <li>it must be sent as {@code Content-Type: application/json}, which a plain HTML form cannot do and which makes a
 *       cross-origin fetch need a CORS preflight that this server never grants.</li>
 * </ol>
 * Browsers always send an Origin on cross-origin and on same-origin POST/PUT/PATCH/DELETE, so a forged browser
 * request cannot get past the first rule by leaving it out. A request with neither header is not from a browser
 * (curl, the stress test, a server-to-server call) and is allowed. {@code Origin: null} is refused.
 */
public final class CsrfGuard {
  private CsrfGuard() {}

  private static final Set<String> UNSAFE = Set.of("POST", "PUT", "PATCH", "DELETE");

  public record Verdict(boolean allowed, int status, String message) {
    static final Verdict OK = new Verdict(true, 0, null);
  }

  /** "https://Leave.Example.com/" becomes "https://leave.example.com"; blank becomes "". */
  public static String normalizeOrigin(String origin) {
    if (origin == null) return "";
    String o = origin.strip().toLowerCase(Locale.ROOT);
    while (o.endsWith("/")) o = o.substring(0, o.length() - 1);
    return o;
  }

  /** The scheme://host[:port] part of a Referer URL, or "" if it isn't a usable URL. */
  static String originOfReferer(String referer) {
    try {
      URI u = URI.create(referer.strip());
      if (u.getScheme() == null || u.getHost() == null) return "";
      return normalizeOrigin(u.getScheme() + "://" + u.getHost() + (u.getPort() == -1 ? "" : ":" + u.getPort()));
    } catch (IllegalArgumentException e) {
      return "";
    }
  }

  static boolean isJson(String contentType) {
    if (contentType == null) return false;
    String main = contentType.split(";", 2)[0].strip().toLowerCase(Locale.ROOT);
    return main.equals("application/json");
  }

  /** Null header values mean "not sent". {@code allowedOrigins} must already be normalised. */
  public static Verdict check(String method, String origin, String referer, String contentType, List<String> allowedOrigins) {
    if (!UNSAFE.contains(method.toUpperCase(Locale.ROOT))) return Verdict.OK; // reads change nothing

    if (origin != null) {
      if (!allowedOrigins.contains(normalizeOrigin(origin))) return forbidden();
    } else if (referer != null) {
      if (!allowedOrigins.contains(originOfReferer(referer))) return forbidden();
    }
    if (!isJson(contentType)) return new Verdict(false, 415, "Requests must be sent as JSON.");
    return Verdict.OK;
  }

  private static Verdict forbidden() {
    return new Verdict(false, 403, "That request was blocked: it did not come from this site.");
  }
}
