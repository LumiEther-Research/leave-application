"""A tiny HTML-to-PDF service. POST /render with an HTML body returns the PDF bytes. GET /health says ok."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from weasyprint import HTML

MAX_BODY = 5 * 1024 * 1024  # the payslip HTML carries the logo, so allow a few MB


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, body=b"", content_type="text/plain; charset=utf-8"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send(200, b"ok")
        else:
            self._send(404, b"not found")

    def do_POST(self):
        if self.path != "/render":
            return self._send(404, b"not found")
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            return self._send(411, b"Content-Length is required")
        if length <= 0 or length > MAX_BODY:
            return self._send(413, b"HTML must be between 1 byte and 5 MB")
        html = self.rfile.read(length).decode("utf-8", errors="replace")
        try:
            pdf = HTML(string=html).write_pdf()
        except Exception as error:  # a bad document must not stop the server
            return self._send(500, f"render failed: {error}".encode())
        self._send(200, pdf, "application/pdf")


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
