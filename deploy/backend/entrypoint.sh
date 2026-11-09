#!/bin/sh
# Optionally applies db/migrations (same table as scripts/migrate.mjs, so either tool can run first), then starts the
# server. The database may still be starting (a fresh compose stack, a Neon branch waking up), so the migration step
# retries for up to a minute before giving up; a wrong URL or password still fails, just after the last attempt.
set -eu
JAVA_FLAGS="$JAVA_OPTS ${JAVA_OPTS_EXTRA:-}"
if [ "${RUN_MIGRATIONS:-0}" = "1" ]; then
  attempt=1
  max="${MIGRATION_ATTEMPTS:-30}"
  until java $JAVA_FLAGS -cp "app.jar:libs/*" app.lumiether.MigrateMain 2>/tmp/migrate.err; do
    if [ "$attempt" -ge "$max" ]; then
      echo "Migrations failed after $attempt attempts:" >&2
      grep -v '^SLF4J' /tmp/migrate.err | head -5 >&2
      exit 1
    fi
    echo "Database not ready (attempt $attempt of $max); retrying in 2s..."
    attempt=$((attempt + 1))
    sleep 2
  done
fi
# shellcheck disable=SC2086
exec java $JAVA_FLAGS -jar app.jar
