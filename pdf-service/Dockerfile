FROM python:3.12-slim

# Pango draws the text; the fonts need to include the rupee sign (₹).
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpango-1.0-0 libpangoft2-1.0-0 fonts-inter fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir weasyprint==70.0

WORKDIR /app
COPY server.py .

# Run as nobody: the service only turns HTML into PDF.
USER nobody
EXPOSE 8080
CMD ["python", "server.py"]
