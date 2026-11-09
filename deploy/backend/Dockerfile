# The Helidon backend. Build the jar and the libs/ folder first (deploy/build.sh does this and stages the context).
FROM eclipse-temurin:21-jre-alpine

RUN addgroup -S app && adduser -S -G app app
WORKDIR /app

COPY libs/ libs/
COPY app.jar app.jar
# The same db/migrations the Node app uses, unchanged. Applied on start when RUN_MIGRATIONS=1.
COPY db/migrations/ db/migrations/
COPY entrypoint.sh entrypoint.sh
RUN chmod 0555 entrypoint.sh && chown -R app:app /app

ENV PORT=8081 \
    MIGRATIONS_DIR=/app/db/migrations \
    JAVA_OPTS="-XX:MaxRAMPercentage=60 -XX:+ExitOnOutOfMemoryError"

USER app
EXPOSE 8081
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1
ENTRYPOINT ["/app/entrypoint.sh"]
