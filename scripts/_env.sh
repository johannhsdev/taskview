#!/usr/bin/env bash

# Helpers para leer/escribir .env sin hacer "source"
# (un SMTP_PASSWORD con $ o espacios romperia el source).

env_get() {
    local key="$1"
    local file="${2:-$ENV_FILE}"

    grep -E "^${key}=" "$file" | tail -n 1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'
}

env_set() {
    local key="$1"
    local value="$2"
    local file="${3:-$ENV_FILE}"
    local tmp

    tmp="$(mktemp)"

    awk -v k="$key" -v v="$value" '
        BEGIN { done = 0 }
        $0 ~ "^" k "=" { print k "=" v; done = 1; next }
        { print }
        END { if (!done) print k "=" v }
    ' "$file" > "$tmp"

    cat "$tmp" > "$file"
    rm -f "$tmp"
}

# Vacio o "change-me" = sin configurar.
env_missing() {
    local value

    value="$(env_get "$1")"

    [ -z "$value" ] || [ "$value" = "change-me" ]
}
