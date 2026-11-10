package app.lumiether.payslip;

import static org.junit.jupiter.api.Assertions.*;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** Port of "the PDF service client". A real little HTTP server stands in for the WeasyPrint container. */
class PdfClientTest {
  HttpServer server;

  @AfterEach
  void stop() {
    if (server != null) server.stop(0);
  }

  String serve(int status, byte[] body, AtomicReference<String> seen) throws Exception {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/render", ex -> {
      if (seen != null) {
        seen.set(ex.getRequestMethod() + " " + ex.getRequestURI().getPath() + " " + ex.getRequestHeaders().getFirst("Content-Type") + " " + new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
      }
      ex.sendResponseHeaders(status, body.length);
      ex.getResponseBody().write(body);
      ex.close();
    });
    server.start();
    return "http://127.0.0.1:" + server.getAddress().getPort();
  }

  @Test
  void postsTheHtmlToRenderAndReturnsThePdfBytes() throws Exception {
    var seen = new AtomicReference<String>();
    String base = serve(200, "%PDF-1.4 ok".getBytes(StandardCharsets.UTF_8), seen);
    assertEquals("%PDF-1.4 ok", new String(new PdfClient(base + "/ignored/path").render("<p>hi ₹</p>"), StandardCharsets.UTF_8));
    assertEquals("POST /render text/html; charset=utf-8 <p>hi ₹</p>", seen.get());
  }

  @Test
  void aServiceThatCantBeReachedIsReportedAsNotRunning() {
    var e = assertThrows(PdfClient.PdfServiceException.class, () -> new PdfClient("http://127.0.0.1:1").render("<p>hi</p>"));
    assertEquals("PDF service is not running", e.getMessage());
  }

  @Test
  void noPdfServiceUrlIsReportedAsNotRunningToo() {
    assertEquals("PDF service is not running", assertThrows(PdfClient.PdfServiceException.class, () -> new PdfClient(null).render("x")).getMessage());
    assertEquals("PDF service is not running", assertThrows(PdfClient.PdfServiceException.class, () -> new PdfClient(" ").render("x")).getMessage());
  }

  @Test
  void aFailedRenderNamesTheStatus() throws Exception {
    String base = serve(500, "render failed".getBytes(StandardCharsets.UTF_8), null);
    assertEquals("The PDF service couldn't render the payslip (HTTP 500).", assertThrows(PdfClient.PdfServiceException.class, () -> new PdfClient(base).render("x")).getMessage());
  }

  @Test
  void aReplyThatIsntAPdfIsRefused() throws Exception {
    String base = serve(200, "<html>nope</html>".getBytes(StandardCharsets.UTF_8), null);
    assertEquals("The PDF service returned something that isn't a PDF.", assertThrows(PdfClient.PdfServiceException.class, () -> new PdfClient(base).render("x")).getMessage());
  }
}
