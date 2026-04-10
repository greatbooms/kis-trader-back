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
LOG_DIR="${DEPLOY_DIR}/logs"
LOG_FILE="${LOG_DIR}/deploy.log"
PM2_LOG_DIR="${PM2_LOG_DIR:-/Users/shinsanghoon/workspace/script/logs/kis-trader-back}"

mkdir -p "$DEPLOY_DIR" "$LOG_DIR" "$PM2_LOG_DIR"

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
yarn prisma:generate
yarn prisma:migrate:prod

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
mkdir -p logs
export PM2_LOG_DIR
pm2 startOrRestart ecosystem.config.js --only "$APP_NAME" --update-env
pm2 save

echo "[info] Waiting for health check..."
sleep 5
curl -sf --max-time 10 "http://localhost:${PORT}/health" > /dev/null
echo "[info] Health check passed"

rm -rf "$BACKUP_DIR"

echo ""
echo "Deploy completed at $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="
