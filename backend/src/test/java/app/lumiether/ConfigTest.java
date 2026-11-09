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
        Config.fromEnv(Map.of("ALLOWED_ORIGINS", "https://Leave.Example.com/, http://localhost:5173  https://leave.example.com")).allowedOrigins());
    assertEquals(List.of(), Config.fromEnv(Map.of()).allowedOrigins());
    assertEquals(List.of(), Config.fromEnv(Map.of("ALLOWED_ORIGINS", " , ")).allowedOrigins());
  }

  @Test
  void thereIsNoCorsSetting() {
    assertEquals(0, java.util.Arrays.stream(Config.class.getRecordComponents()).filter(c -> c.getName().toLowerCase().contains("cors")).count());
  }
}
