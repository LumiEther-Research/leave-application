package app.lumiether.auth;

import static org.junit.jupiter.api.Assertions.*;

import app.lumiether.auth.Token.Payload;
import app.lumiether.auth.Token.Role;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;

/** Port of the "session tokens" group and the fingerprint tests of auth.test.ts. */
class TokenTest {
  private static final String SECRET = "a-test-secret-that-is-long-enough-32+";
  private static final long NOW = 1_000_000;
  private static final Payload PAYLOAD = new Payload("abc", Role.employee, NOW + 60, "fingerprint");

  private static String b64(String s) {
    return Base64.getUrlEncoder().withoutPadding().encodeToString(s.getBytes(StandardCharsets.UTF_8));
  }

  private static String hmac(String body, String secret) throws Exception {
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
    return Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal(body.getBytes(StandardCharsets.UTF_8)));
  }

  @Test
  void aSignedTokenVerifiesAndReturnsThePayload() {
    assertEquals(PAYLOAD, Token.verify(Token.sign(PAYLOAD, SECRET), SECRET, NOW));
  }

  @Test
  void anExpiredTokenIsRejected() {
    assertNull(Token.verify(Token.sign(PAYLOAD, SECRET), SECRET, NOW + 61));
  }

  @Test
  void aTokenSignedWithAnotherSecretIsRejected() {
    assertNull(Token.verify(Token.sign(PAYLOAD, "another-secret-another-secret-123456"), SECRET, NOW));
  }

  @Test
  void changingTheRoleInThePayloadBreaksTheSignature() {
    String signature = Token.sign(PAYLOAD, SECRET).split("\\.")[1];
    String forged = b64("{\"sub\":\"abc\",\"role\":\"admin\",\"exp\":" + (NOW + 60) + ",\"v\":\"fingerprint\"}");
    assertNull(Token.verify(forged + "." + signature, SECRET, NOW));
  }

  @Test
  void missingEmptyAndMalformedTokensAreRejected() {
    for (String bad : new String[] {null, "", "abc", "a.b.c", "."}) assertNull(Token.verify(bad, SECRET, NOW), String.valueOf(bad));
  }

  @Test
  void aValidlySignedTokenWithABadRoleIsRejected() throws Exception {
    String body = b64("{\"sub\":\"abc\",\"role\":\"root\",\"exp\":" + (NOW + 60) + ",\"v\":\"f\"}");
    assertNull(Token.verify(body + "." + hmac(body, SECRET), SECRET, NOW));
  }

  @Test
  void aSessionTokenWithoutAFingerprintIsNotAccepted() throws Exception {
    String body = b64("{\"sub\":\"a\",\"role\":\"employee\",\"exp\":99}");
    assertNull(Token.verify(body + "." + hmac(body, SECRET), SECRET, 1));
  }

  @Test
  void theFingerprintIsStableDiffersPerHashAndDoesntLeakTheHash() {
    assertEquals(Token.passwordFingerprint("same"), Token.passwordFingerprint("same"));
    assertNotEquals(Token.passwordFingerprint("scrypt:a:b"), Token.passwordFingerprint("scrypt:a:c"));
    assertFalse(Token.passwordFingerprint("scrypt:a:b").contains("scrypt"));
    assertEquals(16, Token.passwordFingerprint("scrypt:a:b").length());
  }

  /** The token format is the Node app's: a token made by the Node code (fixed here) must verify. */
  @Test
  void aTokenMadeByTheNodeAppVerifies() throws Exception {
    String body = b64("{\"sub\":\"11111111-1111-4111-8111-111111111111\",\"role\":\"admin\",\"exp\":2000000000,\"v\":\"0123456789abcdef\"}");
    Payload p = Token.verify(body + "." + hmac(body, SECRET), SECRET, 1_700_000_000L);
    assertNotNull(p);
    assertEquals(Role.admin, p.role());
  }
}
