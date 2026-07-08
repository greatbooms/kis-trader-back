#!/usr/bin/env sh
set -eu

APP_NAME="${APP_NAME:-kis-trader-back}"
DEPLOY_PATH="${DEPLOY_PATH:?DEPLOY_PATH is required}"
IMAGE="${IMAGE:?IMAGE is required}"
DOCKER_BIN="${DOCKER_BIN:-/usr/local/bin/docker}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.yml}"
RUNTIME_ENV_FILE="${RUNTIME_ENV_FILE:-.env.prod}"
CONTAINER_ENV_FILE="${CONTAINER_ENV_FILE:-.container.env}"
DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-.deploy.env}"
USE_SUDO_DOCKER="${USE_SUDO_DOCKER:-true}"
DATABASE_HOST_OVERRIDE="${DATABASE_HOST_OVERRIDE:-}"

docker_cmd() {
  if [ "$USE_SUDO_DOCKER" = "true" ]; then
    sudo -n "$DOCKER_BIN" "$@"
  else
    "$DOCKER_BIN" "$@"
  fi
}

cd "$DEPLOY_PATH"

rewrite_database_url_host() {
  database_url="$1"
  database_host="$2"

  case "$database_url" in
    postgresql://*@*)
      before_at="${database_url%@*}"
      after_at="${database_url##*@}"
      case "$after_at" in
        *:*)
          host_suffix=":${after_at#*:}"
          ;;
        */*)
          host_suffix="/${after_at#*/}"
          ;;
        *)
          host_suffix=""
          ;;
      esac
      printf '%s@%s%s\n' "$before_at" "$database_host" "$host_suffix"
      ;;
    *)
      printf '%s\n' "$database_url"
      ;;
  esac
}

render_container_env_file() {
  database_url_found=false
  : > "$CONTAINER_ENV_FILE"
  chmod 600 "$CONTAINER_ENV_FILE"

  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      DATABASE_URL=*)
        database_url_found=true
        database_url="${line#DATABASE_URL=}"
        if [ -n "$DATABASE_HOST_OVERRIDE" ]; then
          database_url="$(rewrite_database_url_host "$database_url" "$DATABASE_HOST_OVERRIDE")"
        fi
        printf 'DATABASE_URL=%s\n' "$database_url" >> "$CONTAINER_ENV_FILE"
        ;;
      *)
        printf '%s\n' "$line" >> "$CONTAINER_ENV_FILE"
        ;;
    esac
  done < "$RUNTIME_ENV_FILE"

  if [ "$database_url_found" != "true" ]; then
    echo "[error] Missing DATABASE_URL in ${DEPLOY_PATH}/${RUNTIME_ENV_FILE}"
    exit 1
  fi
}

if [ ! -f "$RUNTIME_ENV_FILE" ]; then
  echo "[error] Missing runtime env file: ${DEPLOY_PATH}/${RUNTIME_ENV_FILE}"
  exit 1
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "[error] Missing compose file: ${DEPLOY_PATH}/${COMPOSE_FILE}"
  exit 1
fi

render_container_env_file

{
  printf 'IMAGE=%s\n' "$IMAGE"
  printf 'RUNTIME_CONTAINER_ENV_FILE=%s\n' "$CONTAINER_ENV_FILE"
} > "$DEPLOY_ENV_FILE"
chmod 600 "$DEPLOY_ENV_FILE"

echo "[info] Pulling ${IMAGE}"
docker_cmd compose --env-file "$DEPLOY_ENV_FILE" -f "$COMPOSE_FILE" pull

echo "[info] Starting ${APP_NAME}"
docker_cmd compose --env-file "$DEPLOY_ENV_FILE" -f "$COMPOSE_FILE" up -d --remove-orphans

echo "[info] Waiting for container health"
i=1
while [ "$i" -le 60 ]; do
  status="$(docker_cmd inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$APP_NAME" 2>/dev/null || true)"

  if [ "$status" = "healthy" ]; then
    echo "[info] ${APP_NAME} is healthy"
    exit 0
  fi

  echo "[info] ${APP_NAME} status=${status:-unknown}; waiting (${i}/60)"
  i=$((i + 1))
  sleep 2
done

echo "[error] ${APP_NAME} did not become healthy"
docker_cmd ps --filter "name=${APP_NAME}"
docker_cmd logs --tail 120 "$APP_NAME" || true
exit 1
