package app.lumiether.auth;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

/** Cookie parsing and the Set-Cookie strings, without a server. */
class SessionsCookieTest {
  @Test
  void findsTheSessionCookieAmongOthers() {
    assertEquals("abc.def", Sessions.cookieValue("theme=dark; lr_session=abc.def; other=1", "lr_session"));
    assertEquals("abc.def", Sessions.cookieValue("lr_session=abc.def", "lr_session"));
    assertEquals("abc.def", Sessions.cookieValue("  a=1 ;   lr_session = abc.def  ", "lr_session"));
  }

  @Test
  void doesNotMatchSimilarNamesOrMissingCookies() {
    assertNull(Sessions.cookieValue("xlr_session=1; lr_session2=2; session=3", "lr_session"));
    assertNull(Sessions.cookieValue("", "lr_session"));
    assertNull(Sessions.cookieValue(null, "lr_session"));
    assertNull(Sessions.cookieValue("lr_session", "lr_session")); // no value
  }

  @Test
  void theFirstOfTwoCookiesWithTheSameNameWins() {
    assertEquals("first", Sessions.cookieValue("lr_session=first; lr_session=second", "lr_session"));
  }

  @Test
  void theCookieIsNamedLrSessionNotSession() {
    assertEquals("lr_session", Sessions.COOKIE_NAME);
    assertNull(Sessions.cookieValue("session=abc", Sessions.COOKIE_NAME));
  }

  @Test
  void theSetCookieValueHasEverySecurityAttribute() {
    String c = Sessions.setCookie("tok.en", true);
    assertTrue(c.startsWith("lr_session=tok.en;"));
    for (String attr : new String[] {"Path=/", "Max-Age=604800", "HttpOnly", "SameSite=Lax", "Secure"}) assertTrue(c.contains(attr), attr);
    assertFalse(Sessions.setCookie("tok.en", false).contains("Secure"));
    assertTrue(Sessions.setCookie("tok.en", false).contains("HttpOnly"));
  }

  @Test
  void clearingUsesTheSameNameAndPathAndExpiresNow() {
    String c = Sessions.clearCookie(true);
    assertTrue(c.startsWith("lr_session=;"));
    for (String attr : new String[] {"Path=/", "Max-Age=0", "Expires=Thu, 01 Jan 1970", "HttpOnly", "SameSite=Lax", "Secure"}) assertTrue(c.contains(attr), attr);
  }
}
