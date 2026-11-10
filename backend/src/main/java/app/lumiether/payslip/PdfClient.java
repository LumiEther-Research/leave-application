package app.lumiether.payslip;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

/** Sends HTML to the WeasyPrint service (POST /render, unchanged) and returns the PDF bytes. */
public final class PdfClient implements PayslipRenderer {
  public static final String DOWN = "PDF service is not running";

  private final String baseUrl;
  private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

  public PdfClient(String baseUrl) {
    this.baseUrl = baseUrl;
  }

  /** Any failure to reach the service reads "PDF service is not running". */
  public static final class PdfServiceException extends RuntimeException {
    public PdfServiceException() {
      super(DOWN);
    }

    public PdfServiceException(String message) {
      super(message);
    }
  }

  @Override
  public byte[] render(String html) {
    if (baseUrl == null || baseUrl.isBlank()) throw new PdfServiceException();
    HttpResponse<byte[]> response;
    try {
      HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl).resolve("/render"))
          .timeout(Duration.ofSeconds(30))
          .header("Content-Type", "text/html; charset=utf-8")
          .POST(HttpRequest.BodyPublishers.ofString(html, StandardCharsets.UTF_8))
          .build();
      response = http.send(request, HttpResponse.BodyHandlers.ofByteArray());
    } catch (IOException | IllegalArgumentException e) {
      throw new PdfServiceException();
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new PdfServiceException();
    }
    if (response.statusCode() < 200 || response.statusCode() > 299) {
      throw new PdfServiceException("The PDF service couldn't render the payslip (HTTP " + response.statusCode() + ").");
    }
    byte[] pdf = response.body();
    if (pdf.length < 4 || !new String(pdf, 0, 4, StandardCharsets.ISO_8859_1).equals("%PDF")) {
      throw new PdfServiceException("The PDF service returned something that isn't a PDF.");
    }
    return pdf;
  }
}
