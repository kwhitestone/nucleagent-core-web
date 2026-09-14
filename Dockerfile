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

# Baked into the bundle at build time: Vite inlines `import.meta.env.*`, so
# these cannot be changed at container start and must be passed to the build.
ARG VITE_SHELL_URL=http://localhost:26600
ARG VITE_CORE_BACKEND_URL=
ARG VITE_STORAGE_URL=

# Dependency layer first so source edits do not invalidate the npm install.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN VITE_SHELL_URL="${VITE_SHELL_URL}" \
    VITE_CORE_BACKEND_URL="${VITE_CORE_BACKEND_URL}" \
    VITE_STORAGE_URL="${VITE_STORAGE_URL}" \
    npm run build

FROM ${NGINX_IMAGE} AS final
ARG VITE_SHELL_URL=http://localhost:26600

# Backend and CSP settings are resolved at container start.
# Changing the shell origin also requires rebuilding the baked Vite origin.
ARG CORE_UPSTREAM=http://localhost:26680
ENV CORE_UPSTREAM=${CORE_UPSTREAM} \
    SHELL_ORIGIN=${VITE_SHELL_URL}

COPY nginx.conf.template /etc/nginx/templates/nginx.conf.template
COPY docker-entrypoint.d/40-runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh
COPY --from=web-build /build/dist/ /usr/share/nginx/html/
RUN chmod 0555 /docker-entrypoint.d/40-runtime-config.sh

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
