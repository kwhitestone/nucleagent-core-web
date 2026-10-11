#!/bin/sh
set -eu

# These values are operator input (build/deploy configuration), never request
# parameters. Validate them before interpolating into the nginx config so a
# malformed value fails the container start instead of silently producing a
# broken — or injected — server block.
valid_origin() {
    # grep matches per line; reject control characters and newlines up front.
    case "$1" in *[![:alnum:].:/-]*) return 1 ;; esac
    printf '%s\n' "$1" | grep -Eq '^https?://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$' || return 1
    authority=${1#*://}
    case "$authority" in
        *:*) port=${authority##*:}; [ "$port" -ge 1 ] && [ "$port" -le 65535 ] ;;
        *) return 0 ;;
    esac
}

for var in CORE_UPSTREAM SHELL_ORIGIN; do
    eval "value=\${$var:-}"
    if ! valid_origin "$value"; then
        printf '%s must be a single HTTP(S) origin (scheme://host[:port]) with no path, query or credentials.\n' "$var" >&2
        exit 1
    fi
done

# Validate all nginx input before writing either output file.
remaining=${FRAME_ANCESTORS-$SHELL_ORIGIN}
FRAME_ANCESTORS=
while :; do
    origin=${remaining%%,*}
    if ! valid_origin "$origin"; then
        printf '%s\n' 'FRAME_ANCESTORS must be a comma-separated list of exact HTTP(S) origins.' >&2
        exit 1
    fi
    FRAME_ANCESTORS="${FRAME_ANCESTORS:+$FRAME_ANCESTORS }$origin"
    case "$remaining" in
        *,*) remaining=${remaining#*,} ;;
        *) break ;;
    esac
done

# Only public browser keys are serialized; never enumerate the environment.
# Validation makes JSON escaping unnecessary (quotes/backslashes are forbidden).
runtime_keys='VITE_CORE_WEB_URL VITE_SHELL_URL VITE_CORE_BACKEND_URL VITE_STORAGE_URL VITE_AUTH_BACKEND_URL VITE_EMBED_HOST_ORIGINS VITE_SHELL_ALLOWED_ORIGINS'
json='{'
separator=
for var in $runtime_keys; do
    eval "value=\${$var-}"
    if [ "$var" = VITE_EMBED_HOST_ORIGINS ] || [ "$var" = VITE_SHELL_ALLOWED_ORIGINS ]; then
        eval "present=\${$var+x}"
        if [ "$var" = VITE_EMBED_HOST_ORIGINS ] && [ "$present" != x ]; then
            printf '%s must be explicitly configured (empty disables host handoff).\n' "$var" >&2
            exit 1
        fi
        remaining=$value
        while [ -n "$remaining" ]; do
            item=${remaining%%,*}
            if ! valid_origin "$item"; then
                printf '%s contains an invalid origin.\n' "$var" >&2
                exit 1
            fi
            case "$remaining" in
                *,) printf '%s contains an empty origin.\n' "$var" >&2; exit 1 ;;
                *,*) remaining=${remaining#*,} ;;
                *) break ;;
            esac
        done
    elif ! valid_origin "$value"; then
        printf '%s must be a single HTTP(S) origin.\n' "$var" >&2
        exit 1
    fi
    json="$json$separator\"$var\":\"$value\""
    separator=,
done
mkdir -p /etc/nucleagent
printf '%s}\n' "$json" > /etc/nucleagent/runtime-config.json
chmod 0644 /etc/nucleagent/runtime-config.json

export CORE_UPSTREAM FRAME_ANCESTORS

# Substitute only our own placeholders — nginx's own $uri, $proxy_host and
# $http_authorization must survive into the generated config untouched.
envsubst '${CORE_UPSTREAM} ${FRAME_ANCESTORS}' \
    < /etc/nginx/runtime.conf.template \
    > /etc/nginx/conf.d/default.conf
