package app.lumiether.auth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Signed session tokens: base64url(JSON payload) + "." + HMAC-SHA256 signature. Same format as the Node app.
 * Only the user id and the role at login are in the token; the server re-reads the user on every request, so a
 * removed account stops working immediately.
 */
public final class Token {
  private Token() {}

  public enum Role {
    admin,
    employee;

    public static Role parse(String s) {
      for (Role r : values()) if (r.name().equals(s)) return r;
      return null;
    }
  }

  /** {@code v} fingerprints the password the session was issued under. {@code exp} is unix seconds. */
  public record Payload(String sub, Role role, long exp, String v) {}

  private static final ObjectMapper JSON = new ObjectMapper();
  private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();

  /** A short, non-reversible tag for a stored password hash. It only has to change when the hash does. */
  public static String passwordFingerprint(String storedHash) {
    try {
      byte[] digest = MessageDigest.getInstance("SHA-256").digest(storedHash.getBytes(StandardCharsets.UTF_8));
      return HexFormat.of().formatHex(digest).substring(0, 16);
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException(e);
    }
  }

  private static String sign(String body, String secret) {
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
      return B64.encodeToString(mac.doFinal(body.getBytes(StandardCharsets.UTF_8)));
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException(e);
    }
  }

  public static String sign(Payload payload, String secret) {
    Map<String, Object> map = new LinkedHashMap<>();
    map.put("sub", payload.sub());
    map.put("role", payload.role().name());
    map.put("exp", payload.exp());
    map.put("v", payload.v());
    try {
      String body = B64.encodeToString(JSON.writeValueAsBytes(map));
      return body + "." + sign(body, secret);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  /** The payload if the signature is valid and it hasn't expired, otherwise null. */
  public static Payload verify(String token, String secret, long nowSeconds) {
    String[] parts = (token == null ? "" : token).split("\\.", -1);
    if (parts.length != 2 || parts[0].isEmpty() || parts[1].isEmpty()) return null;
    byte[] expected = sign(parts[0], secret).getBytes(StandardCharsets.UTF_8);
    byte[] given = parts[1].getBytes(StandardCharsets.UTF_8);
    if (!MessageDigest.isEqual(expected, given)) return null;
    try {
      JsonNode n = JSON.readTree(Base64.getUrlDecoder().decode(parts[0]));
      Role role = n.path("role").isTextual() ? Role.parse(n.path("role").asText()) : null;
      if (!n.path("sub").isTextual() || role == null || !n.path("exp").isNumber() || !n.path("v").isTextual()) {
        return null;
      }
      long exp = n.path("exp").asLong();
      return exp > nowSeconds ? new Payload(n.path("sub").asText(), role, exp, n.path("v").asText()) : null;
    } catch (Exception e) {
      return null;
    }
  }
}
