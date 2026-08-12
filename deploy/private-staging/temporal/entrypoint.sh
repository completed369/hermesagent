#!/bin/sh
set -eu

POSTGRES_PWD=$(cat /run/secrets/postgres_temporal_password)
[ -n "$POSTGRES_PWD" ] || { echo 'postgres_temporal_password must not be empty' >&2; exit 1; }
export POSTGRES_PWD

broadcast="$(getent hosts "$(hostname)" | awk 'NR==1 {print $1; exit}')"

case "$broadcast" in
  ''|0.0.0.0|127.*)
    echo "STOP: Could not determine a valid Temporal broadcast IP." >&2
    exit 1
    ;;
esac

export TEMPORAL_BROADCAST_ADDRESS="$broadcast"
export BIND_ON_IP="0.0.0.0"

echo "TEMPORAL_NETWORK_BIND=0.0.0.0"
echo "TEMPORAL_NETWORK_BROADCAST=$broadcast"

exec /etc/temporal/entrypoint.sh
