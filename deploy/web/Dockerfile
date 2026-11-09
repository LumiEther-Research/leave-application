# The React (Vite) build, served by nginx, which also proxies /api to the backend. One origin, so no CORS, and this
# container is the only one a cloud load balancer / Traefik needs to reach. Build the site first (deploy/build.sh).
FROM nginx:1.27-alpine

COPY site/ /usr/share/nginx/html/
# Rendered with envsubst at start-up; BACKEND_URL says where the backend is.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY security-headers.conf /etc/nginx/security-headers.conf
ENV BACKEND_URL=http://backend:8081

EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1
