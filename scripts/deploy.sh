#!/usr/bin/env bash

# Despliegue completo de TaskView en el VPS.
#
# Primera vez (desde la carpeta donde quieres el proyecto):
#   curl -fsSL https://raw.githubusercontent.com/johannhsdev/taskview/main/scripts/deploy.sh | bash
#
# Siguientes veces (actualizar / aplicar cambios del .env):
#   cd taskview && bash scripts/deploy.sh
#
# Hace todo lo automatizable:
#   - clona o actualiza el repo
#   - crea .env desde .env.example y genera todos los secretos
#   - pide solo lo manual: token de Cloudflare Tunnel y SMTP
#   - ajusta PASSWORD_CHANGE_CONFIRMATION segun haya SMTP o no
#   - pull + up, espera la migracion y el API
#   - registra el webhook de Telegram si hay bot configurado

set -euo pipefail

REPO_URL="https://github.com/johannhsdev/taskview.git"


# ------------------------------------------------
# 1. Repo: clonar si se ejecuta fuera del proyecto
# ------------------------------------------------

SCRIPT_PATH="${BASH_SOURCE[0]:-}"

if [ -n "$SCRIPT_PATH" ] && [ -f "$(dirname "$SCRIPT_PATH")/../compose.yml" ]; then
    ROOT_DIR="$(cd "$(dirname "$SCRIPT_PATH")/.." && pwd)"
else
    ROOT_DIR="$PWD/taskview"

    if [ ! -d "$ROOT_DIR/.git" ]; then
        echo "Cloning $REPO_URL..."
        git clone "$REPO_URL" "$ROOT_DIR"
    fi

    exec bash "$ROOT_DIR/scripts/deploy.sh" "$@"
fi

cd "$ROOT_DIR"

ENV_FILE="$ROOT_DIR/.env"

# shellcheck source=scripts/_env.sh
source "$ROOT_DIR/scripts/_env.sh"

if ! git rev-parse --abbrev-ref '@{u}' > /dev/null 2>&1; then
    echo "No upstream branch, skipping git pull."
elif [ -z "$(git status --porcelain --untracked-files=no)" ]; then
    echo "Updating repository..."
    git pull --ff-only || echo "git pull failed, continuing with local copy."
else
    echo "Local changes in tracked files, skipping git pull."
fi


# ------------------------------------------------
# 2. .env y secretos
# ------------------------------------------------

if [ ! -f "$ENV_FILE" ]; then
    echo "Creating .env from .env.example..."
    cp .env.example "$ENV_FILE"
fi

chmod 600 "$ENV_FILE"

bash scripts/generate-secrets.sh > /dev/null
echo "Secrets ready."

mkdir -p logs secrets backups


# ------------------------------------------------
# 3. Valores manuales (se piden solo si faltan)
# ------------------------------------------------

HAS_TTY=0
if { : < /dev/tty; } 2> /dev/null; then
    HAS_TTY=1
fi

ask() {
    local key="$1"
    local label="$2"
    local secret="${3:-0}"
    local value=""

    if [ "$secret" = "1" ]; then
        read -rsp "$label: " value < /dev/tty
        echo > /dev/tty
    else
        read -rp "$label: " value < /dev/tty
    fi

    env_set "$key" "$value"
}

if env_missing CLOUDFLARE_TUNNEL_TOKEN && [ "$HAS_TTY" = "1" ]; then
    echo
    echo "Cloudflare Zero Trust -> Networks -> Tunnels -> taskview -> token"
    ask CLOUDFLARE_TUNNEL_TOKEN "CLOUDFLARE_TUNNEL_TOKEN" 1
fi

if [ "$(env_get SMTP_HOST)" = "change-me" ] && [ "$HAS_TTY" = "1" ]; then
    echo
    echo "SMTP (deja el host vacio para continuar sin correo)"
    ask SMTP_HOST "SMTP_HOST"

    if [ -n "$(env_get SMTP_HOST)" ]; then
        read -rp "SMTP_PORT [587]: " port < /dev/tty
        env_set SMTP_PORT "${port:-587}"

        read -rp "SMTP_ENCRYPTION tls/ssl [tls]: " encryption < /dev/tty
        env_set SMTP_ENCRYPTION "${encryption:-tls}"

        ask SMTP_USERNAME "SMTP_USERNAME"
        ask SMTP_PASSWORD "SMTP_PASSWORD" 1
        ask SMTP_FROM_EMAIL "SMTP_FROM_EMAIL"
    fi
fi

# Sin SMTP: el cambio de contrasena se confirma con la contrasena actual.
if env_missing SMTP_HOST; then
    for key in SMTP_HOST SMTP_USERNAME SMTP_PASSWORD SMTP_FROM_EMAIL; do
        if env_missing "$key"; then
            env_set "$key" ""
        fi
    done
    env_set PASSWORD_CHANGE_CONFIRMATION "password"
    env_set INVITE_EMAIL_ENABLED "false"
    echo "No SMTP: PASSWORD_CHANGE_CONFIRMATION=password, invite emails off."
else
    env_set PASSWORD_CHANGE_CONFIRMATION "email"
fi

if env_missing CLOUDFLARE_TUNNEL_TOKEN; then
    echo
    echo "Falta CLOUDFLARE_TUNNEL_TOKEN en $ENV_FILE"
    echo "Editalo (nano .env) y vuelve a ejecutar: bash scripts/deploy.sh"
    exit 1
fi

PENDING="$(grep -nE '=change-me$' "$ENV_FILE" || true)"
if [ -n "$PENDING" ]; then
    echo
    echo "Valores pendientes en .env:"
    echo "$PENDING"
    exit 1
fi


# ------------------------------------------------
# 4. Levantar
# ------------------------------------------------

echo
echo "Pulling images..."
docker compose pull --quiet

echo "Starting containers..."
docker compose up -d --remove-orphans

echo "Waiting for database migration..."
for _ in $(seq 1 60); do
    STATE="$(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' taskview_migration 2>/dev/null || echo "missing 0")"
    case "$STATE" in
        "exited 0") echo "Migration OK."; break ;;
        exited*)
            echo "Migration failed:"
            docker compose logs --tail 30 migration
            exit 1
            ;;
    esac
    sleep 2
done

echo "Waiting for API..."
API_OK=0
for _ in $(seq 1 45); do
    if docker compose exec -T taskview-webapp \
        wget -qO /dev/null http://taskview-api-server:1401/module/auth/login-options 2>/dev/null; then
        API_OK=1
        break
    fi
    sleep 2
done

if [ "$API_OK" = "1" ]; then
    echo "API OK."
else
    echo "API did not answer in time:"
    docker compose logs --tail 30 taskview-api-server
    exit 1
fi


# ------------------------------------------------
# 5. Post-deploy
# ------------------------------------------------

if ! env_missing TELEGRAM_BOT_TOKEN; then
    echo "Registering Telegram webhook..."
    bash scripts/telegram-webhook.sh || echo "Telegram webhook failed (revisa el tunel y el token)."
fi

API_PUBLIC_URL="$(env_get API_PUBLIC_URL)"
APP_URL="$(env_get APP_URL)"
MCP_PUBLIC_URL="$(env_get MCP_PUBLIC_URL)"

echo
echo "Public API check..."
if curl -fsS -o /dev/null --max-time 15 "$API_PUBLIC_URL/module/auth/login-options"; then
    echo "Public API OK."
else
    echo "No responde $API_PUBLIC_URL (revisa los Public Hostnames del tunel)."
fi

status() {
    if env_missing "$2"; then
        printf "  %-16s off\n" "$1"
    else
        printf "  %-16s on\n" "$1"
    fi
}

echo
echo "Integrations:"
status "SMTP" SMTP_HOST
status "Google login" GOOGLE_CLIENT_ID
status "GitHub login" GITHUB_CLIENT_ID
status "Apple login" APPLE_CLIENT_ID
status "GitHub repos" GITHUB_INTEGRATION_CLIENT_ID
status "GitLab repos" GITLAB_INTEGRATION_CLIENT_ID
status "Gitea repos" GITEA_INTEGRATION_CLIENT_ID
status "Telegram" TELEGRAM_BOT_TOKEN
status "Slack" SLACK_CLIENT_ID
status "Firebase push" FIREBASE_CREDENTIALS_PATH

echo
docker compose ps --format 'table {{.Name}}\t{{.Status}}'

echo
echo "TaskView: $APP_URL"
echo "API:      $API_PUBLIC_URL"
echo "MCP:      $MCP_PUBLIC_URL"
echo
echo "Para activar una integracion: llena sus variables en .env y vuelve a ejecutar"
echo "  bash scripts/deploy.sh"
