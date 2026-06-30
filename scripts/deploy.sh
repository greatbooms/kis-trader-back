#!/usr/bin/env bash
set -euo pipefail

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

APP_NAME="${APP_NAME:-kis-trader-back}"
DEPLOY_DIR="${DEPLOY_DIR:-$HOME/publish_kis_trader_back}"
SOURCE_ARCHIVE="${SOURCE_ARCHIVE:?SOURCE_ARCHIVE is required}"
CLONE_DIR="${DEPLOY_DIR}_build"
BACKUP_DIR="${DEPLOY_DIR}_old"
ENV_FILE="${DEPLOY_DIR}/.env.prod"
PM2_LOG_DIR="${PM2_LOG_DIR:-/Users/shinsanghoon/workspace/script/logs/kis-trader-back}"
DEPLOY_LOG_DIR="${DEPLOY_LOG_DIR:-$PM2_LOG_DIR}"
DEPLOY_LOG_RETENTION_DAYS="${DEPLOY_LOG_RETENTION_DAYS:-14}"
DEPLOY_LOG_STARTED_AT="$(date '+%Y-%m-%d_%H-%M-%S')"
LOG_DIR="$DEPLOY_LOG_DIR"
LOG_FILE="${LOG_DIR}/deploy-${DEPLOY_LOG_STARTED_AT}.log"
LATEST_LOG_FILE="${LOG_DIR}/deploy.log"

mkdir -p "$DEPLOY_DIR" "$LOG_DIR" "$PM2_LOG_DIR"
ln -sfn "$(basename "$LOG_FILE")" "$LATEST_LOG_FILE"
find "$LOG_DIR" -name 'deploy-*.log' -type f -mtime +"$DEPLOY_LOG_RETENTION_DAYS" -exec rm -f {} +

exec > >(tee -a "$LOG_FILE") 2>&1

echo ""
echo "=========================================="
echo "Deploy started at $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="

echo "[1/8] Extracting uploaded source archive..."
rm -rf "$CLONE_DIR"
mkdir -p "$CLONE_DIR"
tar -xzf "$SOURCE_ARCHIVE" -C "$CLONE_DIR"

if [ -f "$ENV_FILE" ]; then
  cp "$ENV_FILE" "$CLONE_DIR/.env.prod"
  echo "[info] Preserved .env.prod"
fi

if [ -f "$CLONE_DIR/.env.prod" ]; then
  set -a
  source "$CLONE_DIR/.env.prod"
  set +a
fi

PORT="${PORT:-8888}"
echo "[info] Using PORT=${PORT}"

echo "[2/8] Preparing runtime directories..."
mkdir -p "$CLONE_DIR/logs"

echo "[3/8] Installing root dependencies..."
cd "$CLONE_DIR"
yarn install --frozen-lockfile

echo "[4/8] Installing client dependencies..."
cd "$CLONE_DIR/client"
yarn install --frozen-lockfile

echo "[5/8] Generating Prisma client and applying migrations..."
cd "$CLONE_DIR"
npx prisma generate
npx prisma migrate deploy

echo "[6/8] Building application..."
yarn build:all

echo "[7/8] Swapping build..."
cd "$HOME"
rm -rf "$BACKUP_DIR"
if [ -d "$DEPLOY_DIR" ]; then
  mv "$DEPLOY_DIR" "$BACKUP_DIR"
fi
mv "$CLONE_DIR" "$DEPLOY_DIR"

echo "[8/8] Restarting PM2..."
cd "$DEPLOY_DIR"
mkdir -p "$PM2_LOG_DIR"
export PM2_LOG_DIR

EXPECTED_PM2_CWD="$DEPLOY_DIR"
EXPECTED_PM2_SCRIPT="${DEPLOY_DIR}/dist/main.js"

read_pm2_paths() {
  pm2 jlist | APP_NAME="$APP_NAME" node -e '
const fs = require("fs");
const appName = process.env.APP_NAME;
const input = fs.readFileSync(0, "utf8");
const list = JSON.parse(input);
const app = list.find((item) => item.name === appName);
if (!app) process.exit(0);
const env = app.pm2_env || {};
console.log(`${env.pm_cwd || ""}\t${env.pm_exec_path || ""}`);
'
}

ensure_pm2_release_path() {
  if ! pm2 describe "$APP_NAME" >/dev/null 2>&1; then
    return
  fi

  local paths current_cwd current_script
  paths="$(read_pm2_paths || true)"
  current_cwd="${paths%%$'\t'*}"
  current_script="${paths#*$'\t'}"

  if [ "$current_cwd" != "$EXPECTED_PM2_CWD" ] || [ "$current_script" != "$EXPECTED_PM2_SCRIPT" ]; then
    echo "[warn] Existing PM2 app points to cwd=${current_cwd:-<empty>} script=${current_script:-<empty>}; recreating from current release"
    pm2 delete "$APP_NAME"
  fi
}

verify_pm2_paths() {
  local paths current_cwd current_script
  paths="$(read_pm2_paths)"
  if [ -z "$paths" ]; then
    echo "[error] PM2 app ${APP_NAME} is not registered after restart"
    exit 1
  fi

  current_cwd="${paths%%$'\t'*}"
  current_script="${paths#*$'\t'}"

  if [ "$current_cwd" != "$EXPECTED_PM2_CWD" ] || [ "$current_script" != "$EXPECTED_PM2_SCRIPT" ]; then
    echo "[error] PM2 app ${APP_NAME} points to an unexpected path"
    echo "[error] expected cwd=${EXPECTED_PM2_CWD}"
    echo "[error] actual   cwd=${current_cwd:-<empty>}"
    echo "[error] expected script=${EXPECTED_PM2_SCRIPT}"
    echo "[error] actual   script=${current_script:-<empty>}"
    exit 1
  fi

  echo "[info] PM2 path verified: cwd=${current_cwd}, script=${current_script}"
}

ensure_pm2_release_path
pm2 startOrRestart ecosystem.config.js --only "$APP_NAME" --update-env
verify_pm2_paths
pm2 save

echo "[info] Waiting for health check..."
sleep 5
curl -sf --max-time 10 "http://localhost:${PORT}/health" > /dev/null
echo "[info] Health check passed"

rm -rf "$BACKUP_DIR"

echo ""
echo "Deploy completed at $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="
