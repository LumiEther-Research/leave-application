package app.lumiether.web;

import static org.junit.jupiter.api.Assertions.*;

import java.util.List;
import org.junit.jupiter.api.Test;

/** The CSRF rules, without a server. */
class CsrfGuardTest {
  static final List<String> ALLOWED = List.of("https://leave.example.com", "http://localhost:5173");
  static final String JSON = "application/json";

  static CsrfGuard.Verdict check(String method, String origin, String referer, String contentType) {
    return CsrfGuard.check(method, origin, referer, contentType, ALLOWED);
  }

  @Test
  void readsAreNeverChecked() {
    for (String m : List.of("GET", "HEAD", "OPTIONS")) {
      assertTrue(check(m, "https://evil.example", null, null).allowed(), m);
    }
  }

  @Test
  void stateChangingRequestsFromAnAllowedOriginAsJsonPass() {
    for (String m : List.of("POST", "PUT", "PATCH", "DELETE", "post")) {
      assertTrue(check(m, "https://leave.example.com", null, JSON).allowed(), m);
    }
    assertTrue(check("POST", "http://localhost:5173", null, "application/json; charset=utf-8").allowed());
  }

  @Test
  void aForeignOriginIsRefusedWith403() {
    var v = check("POST", "https://evil.example", null, JSON);
    assertFalse(v.allowed());
    assertEquals(403, v.status());
    for (String origin : List.of("null", "", "https://leave.example.com.evil.example", "http://leave.example.com", "https://leave.example.com:8443")) {
      assertEquals(403, check("DELETE", origin, null, JSON).status(), "origin '" + origin + "'");
    }
  }

  @Test
  void originMatchingIgnoresCaseAndATrailingSlash() {
    assertTrue(check("POST", "HTTPS://Leave.Example.com/", null, JSON).allowed());
  }

  @Test
  void withoutAnOriginTheRefererDecides() {
    assertTrue(check("POST", null, "https://leave.example.com/admin/admins?x=1", JSON).allowed());
    assertEquals(403, check("POST", null, "https://evil.example/page", JSON).status());
    assertEquals(403, check("POST", null, "not a url", JSON).status());
  }

  @Test
  void theOriginWinsOverARefererThatWouldHaveMatched() {
    assertEquals(403, check("POST", "https://evil.example", "https://leave.example.com/", JSON).status());
  }

  @Test
  void aRequestWithNeitherHeaderIsNotFromABrowserAndIsAllowed() {
    assertTrue(check("POST", null, null, JSON).allowed());
  }

  @Test
  void stateChangingRequestsMustBeJsonWith415() {
    for (String type : new String[] {null, "", "text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", "application/jsonx", "text/json"}) {
      var v = check("POST", "https://leave.example.com", null, type);
      assertFalse(v.allowed(), String.valueOf(type));
      assertEquals(415, v.status(), String.valueOf(type));
    }
    assertEquals(415, check("DELETE", "https://leave.example.com", null, null).status());
  }

  @Test
  void theOriginIsCheckedBeforeTheContentType() {
    assertEquals(403, check("POST", "https://evil.example", null, "text/plain").status());
  }

  @Test
  void withNoAllowedOriginsEveryBrowserRequestIsRefused() {
    assertEquals(403, CsrfGuard.check("POST", "https://leave.example.com", null, JSON, List.of()).status());
    assertTrue(CsrfGuard.check("POST", null, null, JSON, List.of()).allowed()); // non-browser callers still work
  }
}
