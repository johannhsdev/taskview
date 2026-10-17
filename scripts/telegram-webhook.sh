#!/usr/bin/env bash

# Registra el webhook del bot de Telegram contra API_PUBLIC_URL.
# Ejecutar de nuevo si cambia el dominio del API.
#
# Uso:  bash scripts/telegram-webhook.sh            (registrar)
#       bash scripts/telegram-webhook.sh info       (ver estado)

set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT_DIR"

ENV_FILE="$ROOT_DIR/.env"

source "$ROOT_DIR/scripts/_env.sh"

TELEGRAM_BOT_TOKEN="$(env_get TELEGRAM_BOT_TOKEN)"
TELEGRAM_WEBHOOK_SECRET="$(env_get TELEGRAM_WEBHOOK_SECRET)"
API_PUBLIC_URL="$(env_get API_PUBLIC_URL)"

if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$TELEGRAM_WEBHOOK_SECRET" ]; then
    echo "TELEGRAM_BOT_TOKEN y TELEGRAM_WEBHOOK_SECRET deben estar en .env"
    exit 1
fi

case "$API_PUBLIC_URL" in
    https://*) ;;
    *)
        echo "API_PUBLIC_URL debe ser HTTPS publico (actual: $API_PUBLIC_URL)"
        exit 1
        ;;
esac

TELEGRAM_API="https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}"

if [ "$1" = "info" ]; then
    curl -s "$TELEGRAM_API/getWebhookInfo"
    echo
    exit 0
fi

echo "Registering webhook: $API_PUBLIC_URL/module/messaging/telegram/webhook"

curl -s "$TELEGRAM_API/setWebhook" \
    -d "url=$API_PUBLIC_URL/module/messaging/telegram/webhook" \
    -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"

echo
