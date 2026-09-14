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

export CORE_UPSTREAM SHELL_ORIGIN

# Substitute only our own placeholders — nginx's own $uri, $proxy_host and
# $http_authorization must survive into the generated config untouched.
envsubst '${CORE_UPSTREAM} ${SHELL_ORIGIN}' \
    < /etc/nginx/templates/nginx.conf.template \
    > /etc/nginx/conf.d/default.conf
