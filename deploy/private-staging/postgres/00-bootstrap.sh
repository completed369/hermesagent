#!/bin/sh
set -eu

secret() {
  value=$(cat "/run/secrets/$1")
  [ -n "$value" ] || { echo "$1 must not be empty" >&2; exit 1; }
  printf '%s' "$value"
}

psql --set=ON_ERROR_STOP=1 \
  --set=app_password="$(secret postgres_app_password)" \
  --set=migrator_password="$(secret postgres_migrator_password)" \
  --set=temporal_password="$(secret postgres_temporal_password)" \
  --set=backup_password="$(secret postgres_backup_password)" \
  --file=/opt/ventureos/postgres/10-roles.sql \
  --dbname=postgres \
  --username="$POSTGRES_USER"
