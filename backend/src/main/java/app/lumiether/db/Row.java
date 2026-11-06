package app.lumiether.db;

import java.util.Map;

/** One result row, keyed by the column label exactly as the query named it. */
public record Row(Map<String, Object> values) {
  public String str(String column) {
    Object v = values.get(column);
    return v == null ? null : v.toString();
  }

  public boolean bool(String column) {
    return Boolean.TRUE.equals(values.get(column));
  }

  public int integer(String column) {
    return ((Number) values.get(column)).intValue();
  }

  public byte[] bytes(String column) {
    return (byte[]) values.get(column);
  }

  public Object get(String column) {
    return values.get(column);
  }
}
