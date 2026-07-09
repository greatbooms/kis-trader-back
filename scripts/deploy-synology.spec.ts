import { readFileSync } from 'fs';
import { join } from 'path';

describe('Synology container deployment', () => {
  const workflow = readFileSync(join(process.cwd(), '.github/workflows/deploy.yml'), 'utf8');
  const compose = readFileSync(join(process.cwd(), 'deploy/compose.yml'), 'utf8');
  const script = readFileSync(join(process.cwd(), 'scripts/deploy-synology.sh'), 'utf8');

  it('builds and pushes the production image to GHCR before deploying', () => {
    expect(workflow).toContain('packages: write');
    expect(workflow).toContain('ghcr.io');
    expect(workflow).toContain('docker/build-push-action');
    expect(workflow).toContain('${{ github.sha }}');
  });

  it('deploys to Synology through Tailscale SSH with a configurable port', () => {
    expect(workflow).toContain('tailscale/github-action');
    expect(workflow).toContain('SYNOLOGY_HOST');
    expect(workflow).toContain('SYNOLOGY_PORT');
    expect(workflow).toContain('Missing required secret');
    expect(workflow).toContain('REMOTE_PORT: ${{ secrets.SYNOLOGY_PORT }}');
    expect(workflow).not.toContain("|| '2008'");
    expect(workflow).toContain('scripts/deploy-synology.sh');
  });

  it('verifies Tailscale and SSH connectivity before building the image', () => {
    const secretsCheckIndex = workflow.indexOf('- name: 배포 시크릿 확인');
    const tailscaleConnectIndex = workflow.indexOf('- name: Tailscale 연결');
    const sshConfigIndex = workflow.indexOf('- name: SSH 설정');
    const connectivityCheckIndex = workflow.indexOf('- name: Tailscale 연결 확인');
    const imageBuildIndex = workflow.indexOf('- name: 이미지 빌드 및 푸시');

    expect(secretsCheckIndex).toBeGreaterThanOrEqual(0);
    expect(tailscaleConnectIndex).toBeGreaterThan(secretsCheckIndex);
    expect(sshConfigIndex).toBeGreaterThan(tailscaleConnectIndex);
    expect(connectivityCheckIndex).toBeGreaterThan(sshConfigIndex);
    expect(imageBuildIndex).toBeGreaterThan(connectivityCheckIndex);
    expect(workflow).toContain('ssh -o ConnectTimeout=10 synology "echo deploy-preflight-ok"');
  });

  it('runs the app on the NAS 20000 port and keeps runtime secrets outside the image', () => {
    expect(compose).toContain('env_file:');
    expect(compose).toContain('.env.prod');
    expect(compose).toContain('network_mode: host');
    expect(compose).toContain('PORT: "20000"');
    expect(compose).not.toContain('"20000:20000"');
    expect(compose).toContain('restart: unless-stopped');
  });

  it('caps Docker json-file logs at 500MB per container', () => {
    expect(compose).toContain('driver: "json-file"');
    expect(compose).toContain('max-size: "100m"');
    expect(compose).toContain('max-file: "5"');
  });

  it('requires the preserved runtime env file and uses sudo docker on Synology', () => {
    expect(script).toContain('RUNTIME_ENV_FILE="${RUNTIME_ENV_FILE:-.env.prod}"');
    expect(script).toContain('sudo -n "$DOCKER_BIN"');
    expect(script).toContain('Missing runtime env file');
    expect(script).toContain('did not become healthy');
  });

  it('removes unused app images after the deployed container is healthy', () => {
    expect(script).toContain('cleanup_unused_app_images');
    expect(script).toContain('docker_cmd images "$repository"');
    expect(script).toContain('docker_cmd rmi "$image_id"');
    expect(script).toContain('[info] ${APP_NAME} is healthy');
  });
});
