#!/usr/bin/env bash
set -Eeuo pipefail

stop() {
  printf 'STOP: %s\n' "$*" >&2
  exit 1
}

if [ "$#" -ne 8 ]; then
  stop 'Expected source SHA, inbox path, and five immutable image digests plus workflow run id.'
fi

SOURCE_SHA="$1"
INBOX_DIR="$2"
API_DIGEST="$3"
WEB_DIGEST="$4"
WORKER_DIGEST="$5"
TOOLS_DIGEST="$6"
INGRESS_DIGEST="$7"
WORKFLOW_RUN_ID="$8"

[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || stop 'Invalid source SHA.'
for digest in "$API_DIGEST" "$WEB_DIGEST" "$WORKER_DIGEST" "$TOOLS_DIGEST" "$INGRESS_DIGEST"; do
  [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || stop "Invalid immutable image digest: $digest"
done
[[ "$INBOX_DIR" == "$HOME"/ventureos-deploy-inbox/* ]] || stop 'Unexpected deployment inbox path.'
[[ "$WORKFLOW_RUN_ID" =~ ^[0-9]+$ ]] || stop 'Invalid workflow run id.'

test -f "$INBOX_DIR/source.tgz" || stop 'Missing staged source archive.'
test -f "$INBOX_DIR/ventureos-images.json" || stop 'Missing staged image manifest.'

disk_kb="$(df -Pk "$HOME" | awk 'NR==2 {print $4}')"
[[ "$disk_kb" =~ ^[0-9]+$ ]] || stop 'Could not determine free disk.'
[ "$disk_kb" -ge 2097152 ] || stop 'At least 2 GiB free disk is required before deployment.'

CURRENT_CONTAINER='ventureos-private-staging-api-1'
docker inspect "$CURRENT_CONTAINER" >/dev/null 2>&1 || stop 'Current private-staging API container is not present.'
CURRENT_COMPOSE_DIR="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' "$CURRENT_CONTAINER")"
case "$CURRENT_COMPOSE_DIR" in
  "$HOME"/ventureos-releases/*/deploy/private-staging) ;;
  *) stop "Unexpected current Compose directory: $CURRENT_COMPOSE_DIR" ;;
esac
CURRENT_RELEASE_DIR="${CURRENT_COMPOSE_DIR%/deploy/private-staging}"
test -f "$CURRENT_COMPOSE_DIR/.env" || stop 'Current release .env is missing.'

RELEASE_DIR="$HOME/ventureos-releases/$SOURCE_SHA"
RELEASE_COMPOSE_DIR="$RELEASE_DIR/deploy/private-staging"

if [ -e "$RELEASE_DIR" ]; then
  test -f "$RELEASE_DIR/.ventureos-source-sha" || stop 'Target release exists without source marker.'
  test "$(cat "$RELEASE_DIR/.ventureos-source-sha")" = "$SOURCE_SHA" || stop 'Target release source marker mismatch.'
else
  PENDING_DIR="${RELEASE_DIR}.pending.${WORKFLOW_RUN_ID}.$$"
  trap 'rm -rf "${PENDING_DIR:-}"' EXIT
  mkdir -p "$PENDING_DIR"
  tar -xzf "$INBOX_DIR/source.tgz" -C "$PENDING_DIR"
  test -f "$PENDING_DIR/deploy/private-staging/docker-compose.yml" || stop 'Staged release is missing canonical private-staging Compose.'
  printf '%s\n' "$SOURCE_SHA" > "$PENDING_DIR/.ventureos-source-sha"
  mv "$PENDING_DIR" "$RELEASE_DIR"
  PENDING_DIR=''
  trap - EXIT
fi

test -d "$RELEASE_COMPOSE_DIR" || stop 'Release Compose directory is missing.'
cp "$CURRENT_COMPOSE_DIR/.env" "$RELEASE_COMPOSE_DIR/.env"
chmod 600 "$RELEASE_COMPOSE_DIR/.env"
cp "$INBOX_DIR/ventureos-images.json" "$RELEASE_DIR/ventureos-images.json"
chmod 644 "$RELEASE_DIR/ventureos-images.json"

set_env() {
  local key="$1"
  local value="$2"
  local file="$3"
  if grep -q "^${key}=" "$file"; then
    sed -i "s#^${key}=.*#${key}=${value}#" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

set_env VENTUREOS_API_DIGEST "$API_DIGEST" "$RELEASE_COMPOSE_DIR/.env"
set_env VENTUREOS_WEB_DIGEST "$WEB_DIGEST" "$RELEASE_COMPOSE_DIR/.env"
set_env VENTUREOS_WORKER_DIGEST "$WORKER_DIGEST" "$RELEASE_COMPOSE_DIR/.env"
set_env VENTUREOS_TOOLS_DIGEST "$TOOLS_DIGEST" "$RELEASE_COMPOSE_DIR/.env"
set_env VENTUREOS_INGRESS_DIGEST "$INGRESS_DIGEST" "$RELEASE_COMPOSE_DIR/.env"
set_env COMPOSE_FILE docker-compose.yml "$RELEASE_COMPOSE_DIR/.env"

for key in STAGING_API_ORIGIN STAGING_WEB_ORIGIN AUTH_COOKIE_DOMAIN SECRET_ROOT; do
  value="$(sed -n "s/^${key}=//p" "$RELEASE_COMPOSE_DIR/.env" | tail -n 1)"
  [ -n "$value" ] || stop "Required release setting is empty: $key"
done

SECRET_ROOT="$(sed -n 's/^SECRET_ROOT=//p' "$RELEASE_COMPOSE_DIR/.env" | tail -n 1)"
test -d "$SECRET_ROOT" || stop 'Configured SECRET_ROOT does not exist.'

cd "$RELEASE_COMPOSE_DIR"
docker compose --env-file .env config --quiet
printf 'COMPOSE_CONFIG=PASS\n'

docker compose --env-file .env --profile upgrade --profile migrate pull
printf 'IMAGE_PULL=PASS\n'

POSTGRES_CONTAINER='ventureos-private-staging-postgres-1'
postgres_health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$POSTGRES_CONTAINER" 2>/dev/null || true)"
[ "$postgres_health" = healthy ] || stop "PostgreSQL must already be healthy before maintenance; got: $postgres_health"
printf 'POSTGRES_HEALTH_PRE_MAINTENANCE=PASS\n'

# Existing staging is already initialized. Never run the initialize profile here.
# --no-deps prevents maintenance jobs from recreating the already-running database.
docker compose --env-file .env --profile upgrade run --rm --no-deps temporal-schema-upgrade
printf 'TEMPORAL_SCHEMA_UPGRADE=PASS\n'

docker compose --env-file .env --profile migrate run --rm --no-deps migrate
printf 'APP_MIGRATION=PASS\n'

# File-backed Compose secrets retain host filesystem ownership/mode. Execute the
# reviewed grants through the already-running PostgreSQL container, which already
# has approved access to the bootstrap secret, and stream this release's SQL.
test -f ./postgres/20-privileges.sql || stop 'Runtime grants SQL is missing.'
docker compose --env-file .env exec -T -u 0 postgres sh -ec \
  'export PGPASSWORD="$(cat /run/secrets/postgres_bootstrap_password)"; exec psql --host=127.0.0.1 --username=ventureos_bootstrap --dbname=postgres --set=ON_ERROR_STOP=1 --file=-' \
  < ./postgres/20-privileges.sql
printf 'RUNTIME_GRANTS=PASS\n'

ROLLBACK_NEEDED=0
rollback() {
  local rc=$?
  if [ "$rc" -ne 0 ] && [ "$ROLLBACK_NEEDED" -eq 1 ]; then
    printf 'ROLLBACK=START\n' >&2
    if cd "$CURRENT_COMPOSE_DIR" && docker compose --env-file .env up -d --no-deps temporal api worker web api-ingress web-ingress; then
      printf 'ROLLBACK=COMMAND_ACCEPTED\n' >&2
    else
      printf 'ROLLBACK=FAILED\n' >&2
    fi
  fi
  exit "$rc"
}
trap rollback EXIT

wait_healthy() {
  local container="$1"
  local timeout_seconds="$2"
  local waited=0
  local status
  while [ "$waited" -lt "$timeout_seconds" ]; do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container" 2>/dev/null || true)"
    case "$status" in
      healthy) return 0 ;;
      unhealthy) stop "$container became unhealthy." ;;
      *) sleep 5; waited=$((waited + 5)) ;;
    esac
  done
  stop "$container did not become healthy within ${timeout_seconds}s."
}

ROLLBACK_NEEDED=1

docker compose --env-file .env up -d --no-deps temporal
wait_healthy ventureos-private-staging-temporal-1 180
printf 'TEMPORAL_HEALTH=PASS\n'

docker compose --env-file .env up -d --no-deps api worker
wait_healthy ventureos-private-staging-api-1 120
wait_healthy ventureos-private-staging-worker-1 120
printf 'API_WORKER_HEALTH=PASS\n'

docker compose --env-file .env up -d --no-deps web
wait_healthy ventureos-private-staging-web-1 120
printf 'WEB_HEALTH=PASS\n'

docker compose --env-file .env up -d --no-deps api-ingress web-ingress
wait_healthy ventureos-private-staging-api-ingress-1 120
wait_healthy ventureos-private-staging-web-ingress-1 120
printf 'INGRESS_HEALTH=PASS\n'

expect_image() {
  local container="$1"
  local expected="$2"
  local actual
  actual="$(docker inspect -f '{{.Config.Image}}' "$container")"
  [ "$actual" = "$expected" ] || stop "$container image mismatch: $actual"
}

expect_image ventureos-private-staging-api-1 "ghcr.io/completed369/ventureos-api@$API_DIGEST"
expect_image ventureos-private-staging-worker-1 "ghcr.io/completed369/ventureos-worker@$WORKER_DIGEST"
expect_image ventureos-private-staging-web-1 "ghcr.io/completed369/ventureos-web@$WEB_DIGEST"
expect_image ventureos-private-staging-api-ingress-1 "ghcr.io/completed369/ventureos-ingress@$INGRESS_DIGEST"
expect_image ventureos-private-staging-web-ingress-1 "ghcr.io/completed369/ventureos-ingress@$INGRESS_DIGEST"
printf 'IMAGE_IDENTITY=PASS\n'

TEMPORAL_CONFIG_FILES="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.config_files" }}' ventureos-private-staging-temporal-1)"
[ "$TEMPORAL_CONFIG_FILES" = "$RELEASE_COMPOSE_DIR/docker-compose.yml" ] || stop "Temporal is not using canonical-only Compose: $TEMPORAL_CONFIG_FILES"
printf 'TEMPORAL_CANONICAL_CONFIG=PASS\n'

ln -sfn "$RELEASE_DIR" "$HOME/ventureos-current"
printf '%s\n' "$WORKFLOW_RUN_ID" > "$RELEASE_DIR/.ventureos-deployment-run-id"
printf 'DEPLOYED_SOURCE_SHA=%s\n' "$SOURCE_SHA"
printf 'PREVIOUS_RELEASE=%s\n' "$CURRENT_RELEASE_DIR"
printf 'CURRENT_RELEASE=%s\n' "$RELEASE_DIR"
printf 'PRIVATE_STAGING_DEPLOYMENT=PASS\n'

ROLLBACK_NEEDED=0
rm -rf "$INBOX_DIR"
trap - EXIT
