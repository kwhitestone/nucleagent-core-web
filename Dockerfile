# syntax=docker/dockerfile:1
#
# Self-contained build — the context is this repository's root, with no
# dependency on a surrounding workspace. The Prism Fusion plugin runtime that
# used to be a workspace-relative `file:` dependency is vendored under
# src/vendor/prism-fusion-plugin-runtime (see its VENDORED.md).
#
#   docker build -t nucleagent-core-web .
#
ARG NODE_IMAGE=node:22-alpine
ARG NGINX_IMAGE=nginx:1.27-alpine

FROM ${NODE_IMAGE} AS web-build
WORKDIR /build

# Dependency layer first so source edits do not invalidate the npm install.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

FROM ${NGINX_IMAGE} AS final
# Browser endpoints, backend and CSP are required at container start.

# Only our validated runtime hook renders this template.
COPY nginx.conf.template /etc/nginx/runtime.conf.template
COPY docker-entrypoint.d/40-runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh
COPY --from=web-build /build/dist/ /usr/share/nginx/html/
RUN chmod 0555 /docker-entrypoint.d/40-runtime-config.sh

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
