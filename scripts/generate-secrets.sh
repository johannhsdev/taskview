#!/usr/bin/env bash

# Reemplaza en .env los secretos que siguen en "change-me" por valores aleatorios.
# No toca los que ya tienen valor. Ejecutar una sola vez tras: cp .env.example .env

set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
    echo "No existe .env (cp .env.example .env)"
    exit 1
fi

replace() {
    local key="$1"
    local value="$2"

    if grep -q "^${key}=change-me$" "$ENV_FILE"; then
        sed -i "s|^${key}=change-me$|${key}=${value}|" "$ENV_FILE"
        echo "Generated ${key}"
    fi
}

replace DB_PASSWORD "$(openssl rand -hex 24)"
replace JWT_SIGN "$(openssl rand -hex 64)"
replace ENCRYPTION_KEY "$(openssl rand -hex 32)"
replace CENTRIFUGO_API_KEY "$(openssl rand -hex 32)"
replace CENTRIFUGO_TOKEN_SECRET "$(openssl rand -hex 32)"
replace TELEGRAM_WEBHOOK_SECRET "$(openssl rand -hex 32)"

echo
echo "Pending values to fill by hand:"
grep -n "=change-me$" "$ENV_FILE" || echo "none"
