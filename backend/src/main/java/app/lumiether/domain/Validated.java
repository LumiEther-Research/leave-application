package app.lumiether.domain;

import java.util.Map;

/** Either a cleaned value, or one message per bad field. */
public record Validated<V>(V value, Map<String, String> errors) {
  public boolean ok() {
    return errors.isEmpty();
  }

  public static <V> Validated<V> valid(V value) {
    return new Validated<>(value, Map.of());
  }

  public static <V> Validated<V> invalid(Map<String, String> errors) {
    return new Validated<>(null, errors);
  }
}
