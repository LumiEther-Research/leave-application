package app.lumiether.web;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;

/** JSON in and out. Request bodies are read as a flat map of strings, the way form fields were. */
public final class Json {
  private Json() {}

  public static final ObjectMapper MAPPER = new ObjectMapper();

  /** The body as a map, or null if it isn't a JSON object. */
  public static Map<String, Object> parseObject(String body) {
    try {
      return MAPPER.readValue(body == null || body.isBlank() ? "{}" : body, new TypeReference<>() {});
    } catch (Exception e) {
      return null;
    }
  }

  /** A string field, or "" when it is missing or not a string. */
  public static String text(Map<String, Object> body, String key) {
    return body.get(key) instanceof String s ? s : "";
  }

  public static String write(Object value) {
    try {
      return MAPPER.writeValueAsString(value);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }
}
