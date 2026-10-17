#!/usr/bin/env bash

set -e

if [ -z "$1" ]; then
    echo "Usage:"
    echo "./scripts/restore.sh backups/file.dump [backups/files.tar.gz]"
    exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_FILE="$1"
FILES_ARCHIVE="$2"

cd "$ROOT_DIR"

set -a
source .env
set +a

if [ ! -f "$BACKUP_FILE" ]; then
    echo "Backup not found: $BACKUP_FILE"
    exit 1
fi

echo "Restoring PostgreSQL database..."

docker compose exec -T postgres \
    pg_restore \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    --clean \
    --if-exists \
    < "$BACKUP_FILE"

if [ -n "$FILES_ARCHIVE" ]; then

    echo "Restoring attachments..."

    docker compose exec -T taskview-api-server \
        tar -xzf - -C /usr/src/app/data < "$FILES_ARCHIVE"

fi

echo "Restore completed."
