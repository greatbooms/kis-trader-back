#!/usr/bin/env sh
set -eu

APP_NAME="${APP_NAME:-kis-trader-back}"
DEPLOY_PATH="${DEPLOY_PATH:?DEPLOY_PATH is required}"
IMAGE="${IMAGE:?IMAGE is required}"
DOCKER_BIN="${DOCKER_BIN:-/usr/local/bin/docker}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.yml}"
RUNTIME_ENV_FILE="${RUNTIME_ENV_FILE:-.env.prod}"
DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-.deploy.env}"
USE_SUDO_DOCKER="${USE_SUDO_DOCKER:-true}"

docker_cmd() {
  if [ "$USE_SUDO_DOCKER" = "true" ]; then
    sudo -n "$DOCKER_BIN" "$@"
  else
    "$DOCKER_BIN" "$@"
  fi
}

cd "$DEPLOY_PATH"

if [ ! -f "$RUNTIME_ENV_FILE" ]; then
  echo "[error] Missing runtime env file: ${DEPLOY_PATH}/${RUNTIME_ENV_FILE}"
  exit 1
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "[error] Missing compose file: ${DEPLOY_PATH}/${COMPOSE_FILE}"
  exit 1
fi

printf 'IMAGE=%s\n' "$IMAGE" > "$DEPLOY_ENV_FILE"

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
