#!/usr/bin/env bash

set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="$ROOT_DIR/backups"

mkdir -p "$BACKUP_DIR"

cd "$ROOT_DIR"

ENV_FILE="$ROOT_DIR/.env"

source "$ROOT_DIR/scripts/_env.sh"

DB_USER="$(env_get DB_USER)"
DB_NAME="$(env_get DB_NAME)"

TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
FILE="$BACKUP_DIR/taskview_${TIMESTAMP}.dump"
FILES_ARCHIVE="$BACKUP_DIR/taskview_files_${TIMESTAMP}.tar.gz"

echo "Creating PostgreSQL backup..."

docker compose exec -T postgres \
    pg_dump \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    -Fc > "$FILE"

echo "Creating attachments backup..."

docker compose exec -T taskview-api-server \
    tar -czf - -C /usr/src/app/data files > "$FILES_ARCHIVE"

echo "Backups created:"
echo "$FILE"
echo "$FILES_ARCHIVE"
