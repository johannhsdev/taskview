#!/bin/sh

set -eu

export PGPASSWORD="$DB_ADMIN_PASSWORD"

PSQL="psql -h $DB_HOST -p $DB_PORT -U $DB_ADMIN_USER -d $DB_ADMIN_DATABASE -v ON_ERROR_STOP=1"

echo "Checking PostgreSQL..."

until pg_isready \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_ADMIN_USER"
do
    sleep 1
done

echo "PostgreSQL available."

ROLE_EXISTS=$($PSQL -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'")

if [ "$ROLE_EXISTS" = "1" ]; then

    echo "Role '$DB_USER' already exists."

else

    echo "Creating role '$DB_USER'..."

    $PSQL -c "CREATE ROLE \"$DB_USER\" LOGIN PASSWORD '$DB_PASSWORD';"

    echo "Role '$DB_USER' created."

fi

DATABASE_EXISTS=$($PSQL -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'")

if [ "$DATABASE_EXISTS" = "1" ]; then

    echo "Database '$DB_NAME' already exists."

else

    echo "Creating database '$DB_NAME'..."

    $PSQL -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$DB_USER\";"

    echo "Database '$DB_NAME' created."

fi
