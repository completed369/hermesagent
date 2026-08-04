#!/bin/sh
set -eu
secret_root=${VENTUREOS_SECRET_ROOT:-/run/secrets}
password=$(cat "$secret_root/postgres_temporal_password")
[ -n "$password" ] || { echo 'postgres_temporal_password must not be empty' >&2; exit 1; }
mode=${TEMPORAL_SCHEMA_MODE:?TEMPORAL_SCHEMA_MODE must be initialize or upgrade}
case "$mode" in
  initialize | upgrade) ;;
  *) echo 'TEMPORAL_SCHEMA_MODE must be initialize or upgrade' >&2; exit 1 ;;
esac

setup() {
  database=$1
  schema=$2
  if [ "$mode" = initialize ]; then
    temporal-sql-tool --ep postgres -p 5432 -u ventureos_temporal --pw "$password" --pl postgres12 --db "$database" setup-schema -v 0.0
  fi
  temporal-sql-tool --ep postgres -p 5432 -u ventureos_temporal --pw "$password" --pl postgres12 --db "$database" update-schema -d "$schema"
}

setup temporal /etc/temporal/schema/postgresql/v12/temporal/versioned
setup temporal_visibility /etc/temporal/schema/postgresql/v12/visibility/versioned
