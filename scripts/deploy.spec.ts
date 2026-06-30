import { readFileSync } from 'fs';
import { join } from 'path';

describe('scripts/deploy.sh', () => {
  const script = readFileSync(join(process.cwd(), 'scripts/deploy.sh'), 'utf8');

  it('keeps deploy logs outside the release directory that gets swapped', () => {
    expect(script).toContain('DEPLOY_LOG_DIR=');
    expect(script).toContain('LOG_DIR="$DEPLOY_LOG_DIR"');
    expect(script).not.toContain('LOG_DIR="${DEPLOY_DIR}/logs"');
  });

  it('rotates deploy logs independently from PM2 logrotate', () => {
    expect(script).toContain('DEPLOY_LOG_RETENTION_DAYS="${DEPLOY_LOG_RETENTION_DAYS:-14}"');
    expect(script).toContain('DEPLOY_LOG_STARTED_AT="$(date');
    expect(script).toContain('LOG_FILE="${LOG_DIR}/deploy-${DEPLOY_LOG_STARTED_AT}.log"');
    expect(script).toContain('LATEST_LOG_FILE="${LOG_DIR}/deploy.log"');
    expect(script).toContain('ln -sfn "$(basename "$LOG_FILE")" "$LATEST_LOG_FILE"');
    expect(script).toContain('find "$LOG_DIR" -name \'deploy-*.log\'');
    expect(script).toContain('-mtime +"$DEPLOY_LOG_RETENTION_DAYS"');
  });

  it('repairs and verifies a PM2 process pinned to a stale cwd or script path', () => {
    expect(script).toContain('EXPECTED_PM2_CWD="$DEPLOY_DIR"');
    expect(script).toContain('EXPECTED_PM2_SCRIPT="${DEPLOY_DIR}/dist/main.js"');
    expect(script).toContain('pm2 delete "$APP_NAME"');
    expect(script).toContain('verify_pm2_paths');
  });
});
