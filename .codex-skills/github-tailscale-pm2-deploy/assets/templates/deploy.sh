#!/usr/bin/env bash
set -euo pipefail

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

APP_NAME="${APP_NAME:-my-app}"
DEPLOY_DIR="${DEPLOY_DIR:-$HOME/apps/$APP_NAME}"
SOURCE_ARCHIVE="${SOURCE_ARCHIVE:?SOURCE_ARCHIVE is required}"
BUILD_DIR="${DEPLOY_DIR}_build"
BACKUP_DIR="${DEPLOY_DIR}_old"
STATE_DIR="${STATE_DIR:-${DEPLOY_DIR}_shared}"
LOG_DIR="${LOG_DIR:-$STATE_DIR/logs}"
LOG_FILE="${LOG_DIR}/deploy.log"
PM2_LOG_DIR="${PM2_LOG_DIR:-$LOG_DIR/pm2}"

mkdir -p "$DEPLOY_DIR" "$STATE_DIR" "$LOG_DIR" "$PM2_LOG_DIR"

exec > >(tee -a "$LOG_FILE") 2>&1

echo ""
echo "=========================================="
echo "Deploy started at $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="

echo "[1/8] Extracting uploaded source archive..."
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
tar -xzf "$SOURCE_ARCHIVE" -C "$BUILD_DIR"

cd "$BUILD_DIR"

if [ -f ".env.prod" ]; then
  set -a
  source ".env.prod"
  set +a
  echo "[info] Loaded .env.prod from release archive"
else
  echo "[warn] .env.prod was not found in release archive"
fi

PORT="${PORT:-8888}"
echo "[info] Using PORT=${PORT}"

echo "[2/8] Preparing runtime directories..."
mkdir -p logs

echo "[3/8] Installing root dependencies..."
yarn install --frozen-lockfile

echo "[4/8] Installing client dependencies if present..."
if [ -f "client/package.json" ]; then
  cd "$BUILD_DIR/client"
  yarn install --frozen-lockfile
  cd "$BUILD_DIR"
else
  echo "[info] client/package.json not found; skipping client install"
fi

echo "[5/8] Running database/code generation commands..."
if yarn run | grep -q "prisma:generate"; then
  yarn prisma:generate
else
  echo "[info] prisma:generate script not found; skipping"
fi

if yarn run | grep -q "prisma:migrate:prod"; then
  yarn prisma:migrate:prod
else
  echo "[info] prisma:migrate:prod script not found; skipping"
fi

echo "[6/8] Building application..."
if yarn run | grep -q "build:all"; then
  yarn build:all
else
  yarn build
fi

echo "[7/8] Swapping release..."
cd "$HOME"
rm -rf "$BACKUP_DIR"
if [ -d "$DEPLOY_DIR" ]; then
  mv "$DEPLOY_DIR" "$BACKUP_DIR"
fi
mv "$BUILD_DIR" "$DEPLOY_DIR"
rm -rf "$DEPLOY_DIR/logs"
ln -s "$LOG_DIR" "$DEPLOY_DIR/logs"

echo "[8/8] Restarting PM2..."
cd "$DEPLOY_DIR"
export PM2_LOG_DIR
pm2 startOrRestart ecosystem.config.js --only "$APP_NAME" --update-env
if ! pm2 module:list | grep -q "pm2-logrotate"; then
  echo "[info] Installing pm2-logrotate..."
  pm2 install pm2-logrotate
fi
pm2 set pm2-logrotate:max_size "${PM2_LOGROTATE_MAX_SIZE:-10M}"
pm2 set pm2-logrotate:retain "${PM2_LOGROTATE_RETAIN:-14}"
pm2 set pm2-logrotate:compress "${PM2_LOGROTATE_COMPRESS:-true}"
pm2 save

echo "[info] Waiting for health check..."
sleep 5
curl -sf --max-time 10 "http://localhost:${PORT}/health" > /dev/null
echo "[info] Health check passed"

rm -rf "$BACKUP_DIR"

echo ""
echo "Deploy completed at $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="
