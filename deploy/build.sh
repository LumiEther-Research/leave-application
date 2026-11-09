#!/usr/bin/env bash
# Builds the backend jar and its Docker image, and, once the React frontend exists (frontend/, a Vite project), the
# frontend and the web image too. Contexts are staged under deploy/.build. Tags: the git short sha, and latest.
set -euo pipefail
cd "$(dirname "$0")/.."
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}"
TAG="${TAG:-$(git rev-parse --short HEAD)$(git diff --quiet HEAD -- . && [ -z "$(git ls-files --others --exclude-standard)" ] || echo -dirty)}"

echo "== backend jar"
(cd backend && mvn -q -DskipTests clean package)

rm -rf deploy/.build && mkdir -p deploy/.build/backend
cp backend/target/leave-backend-*.jar deploy/.build/backend/app.jar
cp -r backend/target/libs deploy/.build/backend/libs
mkdir -p deploy/.build/backend/db && cp -r db/migrations deploy/.build/backend/db/migrations
cp deploy/backend/Dockerfile deploy/backend/entrypoint.sh deploy/.build/backend/

echo "== backend image"
docker build -q -t "lumiether-backend:$TAG" -t lumiether-backend:latest deploy/.build/backend

if [ -d frontend ]; then
  echo "== frontend (Vite build; the API is on the same origin, so no API URL is baked in)"
  (cd frontend && npm ci && npm run build)
  mkdir -p deploy/.build/web
  cp -r frontend/dist deploy/.build/web/site
  cp deploy/web/Dockerfile deploy/web/nginx.conf.template deploy/web/security-headers.conf deploy/.build/web/
  echo "== web image"
  docker build -q -t "lumiether-web:$TAG" -t lumiether-web:latest deploy/.build/web
else
  echo "== web image skipped: frontend/ does not exist yet (the React frontend is not built)"
fi

docker images --format '{{.Repository}}:{{.Tag}}  {{.Size}}' | grep -E '^lumiether-(backend|web):' || true
