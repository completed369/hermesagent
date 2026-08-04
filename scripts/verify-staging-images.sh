#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE=${1:-.staging/phase15.env}
set -a
# Generated locally from synthetic hex-only values.
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

project=${COMPOSE_PROJECT_NAME:-ventureos-phase15}
api_image="${project}-api:local"
worker_image="${project}-worker:local"
web_image="${project}-web:local"
tools_image="${project}-tools:local"
ingress_image="${project}-ingress:local"

check_common() {
  local image=$1
  local user
  user=$(docker image inspect --format '{{.Config.User}}' "$image")
  [[ -n "$user" && "$user" != '0' && "$user" != 'root' ]] || {
    echo "$image does not declare a non-root runtime user" >&2
    return 1
  }
  docker run --rm --entrypoint sh "$image" -ec '
    ! find /app -type d -name .git -print -quit | grep -q .
    ! find /app -type f \( -name .env -o -name ".env.*" \) -print -quit | grep -q .
    ! find /app -type f \( -name "*.test.*" -o -name "*.spec.*" \) -print -quit | grep -q .
    ! grep -RIlE --exclude-dir=node_modules "BEGIN [A-Z ]*PRIVATE KEY|gh[pousr]_[A-Za-z0-9]{20}|sk-ant-[A-Za-z0-9_-]{20}" /app | grep -q .
    test ! -e /app/node_modules/vitest
  '
}

check_common "$api_image"
docker run --rm --entrypoint sh "$api_image" -ec 'test -s /app/dist/main.js'

check_common "$worker_image"
docker run --rm --entrypoint sh "$worker_image" -ec 'test -s /app/dist/index.js'

check_common "$web_image"
docker run --rm --entrypoint sh "$web_image" -ec 'test -s /app/apps/web/server.js; test -d /app/apps/web/.next/static'

check_common "$tools_image"
docker run --rm --entrypoint sh "$tools_image" -ec '
  test -s /app/prisma/schema.prisma
  test -s /app/node_modules/prisma/build/index.js
  test ! -d /app/src
'

check_common "$ingress_image"
docker run --rm --entrypoint sh "$ingress_image" -ec 'test -s /app/staging-ingress-proxy.mjs'

echo 'STAGING_IMAGE_CONTENT_SCAN_PASS'
