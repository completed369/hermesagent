#!/bin/sh
set -eu
POSTGRES_PWD=$(cat /run/secrets/postgres_temporal_password)
[ -n "$POSTGRES_PWD" ] || { echo 'postgres_temporal_password must not be empty' >&2; exit 1; }
export POSTGRES_PWD
exec /etc/temporal/entrypoint.sh
