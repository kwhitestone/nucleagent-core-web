# Browser Runtime Configuration

The image contains no deployment endpoint defaults. The entrypoint writes
`/runtime-config.json` from an explicit public-key allowlist before nginx starts.
The browser loads it without credentials or caching before importing the app.
Do not put secrets, API keys, passwords or tokens in these values.

Required container variables:

| Key | Value |
| --- | --- |
| `VITE_CORE_WEB_URL` | Canonical HTTPS origin of this site |
| `VITE_SHELL_URL` | Shell HTTPS origin |
| `VITE_CORE_BACKEND_URL` | Core API HTTPS origin; use this site's origin for the nginx `/api` proxy |
| `VITE_STORAGE_URL` | Storage HTTPS origin |
| `VITE_AUTH_BACKEND_URL` | Auth HTTPS origin |
| `VITE_EMBED_HOST_ORIGINS` | Comma-separated trusted embed origins; explicitly empty disables handoff |
| `CORE_UPSTREAM` | Server-side Core HTTP(S) origin for the existing nginx proxy |
| `SHELL_ORIGIN` | Shell origin for the nginx frame policy |
| `FRAME_ANCESTORS` | Optional comma-separated frame origins; omitted uses `SHELL_ORIGIN` |

Browser origins must be exact: no path, trailing slash, credentials, query or
fragment. All public endpoints must share the canonical site's DNS namespace
(everything after the service label). The page must be the canonical origin or
its existing `outerAware` twin. That same helper maps all public endpoints on an
outer page; the bundle is identical for both hosts. Each environment supplies
its own canonical values. Never use another environment as a fallback.

Missing, malformed, unexpected or cross-environment configuration prevents app
mounting and shows an explicit startup error. The existing platform runtime,
user session and host-message origin validation remain the transport authority.
Only public initial handshake metadata is retained during bootstrap; credentials
are not buffered or serialized. CSP frame permission does not enable auth
handoff: configure its public allowlist separately only when authorized.
