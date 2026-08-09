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

check_common() (
  set -Eeuo pipefail
  local image=$1
  local target=$2
  local user
  local container=''
  local python_cmd
  if command -v python >/dev/null 2>&1; then
    python_cmd=python
  else
    python_cmd=python3
  fi
  user=$(docker image inspect --format '{{.Config.User}}' "$image")
  [[ -n "$user" && "$user" != '0' && "$user" != 'root' ]] || {
    echo "$image does not declare a non-root runtime user" >&2
    return 1
  }

  trap '
    if [[ -n "$container" ]]; then
      docker rm --force "$container" >/dev/null 2>&1 || true
    fi
  ' EXIT
  container=$(docker create "$image")
  docker export "$container" | "$python_cmd" scripts/verify-image-rootfs.py "$target"
  docker rm "$container" >/dev/null
  container=''
)

check_common "$api_image" api
check_common "$worker_image" worker
check_common "$web_image" web
check_common "$tools_image" tools
check_common "$ingress_image" ingress

echo 'STAGING_IMAGE_CONTENT_SCAN_PASS'
