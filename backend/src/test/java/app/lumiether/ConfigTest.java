package app.lumiether;

import static org.junit.jupiter.api.Assertions.*;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Environment parsing. SESSION_SECRET is retired: it must never be read. */
class ConfigTest {
  @Test
  void theCookieSecretComesFromLrCookieSecretAndSessionSecretIsIgnored() {
    Config c = Config.fromEnv(Map.of("LR_COOKIE_SECRET", "cookie-secret", "SESSION_SECRET", "old-node-app-secret"));
    assertEquals("cookie-secret", c.cookieSecret());
    assertNull(Config.fromEnv(Map.of("SESSION_SECRET", "old-node-app-secret")).cookieSecret());
  }

  @Test
  void cookieSecureDefaultsToOnAndAcceptsTheUsualOffWords() {
    assertTrue(Config.fromEnv(Map.of()).cookieSecure());
    assertTrue(Config.fromEnv(Map.of("COOKIE_SECURE", "true")).cookieSecure());
    assertTrue(Config.fromEnv(Map.of("COOKIE_SECURE", "")).cookieSecure());
    for (String off : List.of("false", "FALSE", "0", "no", "off")) assertFalse(Config.fromEnv(Map.of("COOKIE_SECURE", off)).cookieSecure(), off);
  }

  @Test
  void allowedOriginsAreSplitNormalisedAndDeduplicated() {
    assertEquals(List.of("https://leave.example.com", "http://localhost:5173"),
        Config.fromEnv(Map.of("COOKIE_SECURE", "false", "ALLOWED_ORIGINS", "https://Leave.Example.com/, http://localhost:5173  https://leave.example.com")).allowedOrigins());
    assertEquals(List.of("https://leave.example.com"),
        Config.fromEnv(Map.of("ALLOWED_ORIGINS", "https://Leave.Example.com/ https://leave.example.com")).allowedOrigins());
    assertEquals(List.of(), Config.fromEnv(Map.of()).allowedOrigins());
    assertEquals(List.of(), Config.fromEnv(Map.of("ALLOWED_ORIGINS", " , ")).allowedOrigins());
  }

  @Test
  void thereIsNoCorsSetting() {
    assertEquals(0, java.util.Arrays.stream(Config.class.getRecordComponents()).filter(c -> c.getName().toLowerCase().contains("cors")).count());
  }

  // ---- the production guard: COOKIE_SECURE=true refuses development origins

  @Test
  void withSecureCookiesALocalOriginStopsStartupWithAClearMessage() {
    for (String bad : List.of("http://localhost:5173", "http://127.0.0.1:5173", "http://[::1]:5173", "https://localhost",
        "HTTP://LOCALHOST:5173/", "https://leave.example.com, http://localhost:5173")) {
      for (Map<String, String> env : List.of(Map.of("ALLOWED_ORIGINS", bad), Map.of("COOKIE_SECURE", "true", "ALLOWED_ORIGINS", bad))) {
        Config.Invalid e = assertThrows(Config.Invalid.class, () -> Config.fromEnv(env), bad);
        assertTrue(e.getMessage().contains("ALLOWED_ORIGINS") && e.getMessage().contains("COOKIE_SECURE"), e.getMessage());
        assertTrue(e.getMessage().toLowerCase().contains("localhost"), e.getMessage());
      }
    }
  }

  @Test
  void localOriginsAreStillAllowedForLocalDevelopmentWithSecureCookiesOff() {
    Config c = Config.fromEnv(Map.of("COOKIE_SECURE", "false", "ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://[::1]:5173"));
    assertEquals(3, c.allowedOrigins().size());
  }

  @Test
  void aPublicOriginThatMerelyContainsTheWordLocalhostIsNotRefused() {
    for (String ok : List.of("https://leave.example.com", "https://localhost.example.com", "https://my-localhost.dev:8443", "https://127.0.0.1.example.com")) {
      assertEquals(List.of(ok), Config.fromEnv(Map.of("ALLOWED_ORIGINS", ok)).allowedOrigins(), ok);
    }
  }
}
