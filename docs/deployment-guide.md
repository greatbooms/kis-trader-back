# 배포 가이드

이 프로젝트의 기본 운영 배포 대상은 Synology NAS Container Manager입니다.
배포는 `GitHub Actions + GHCR + Tailscale + SSH + Docker Compose` 조합으로 동작합니다.

## 배포 구조

흐름:

1. `main` 브랜치에 push 또는 `workflow_dispatch`
2. GitHub Actions 실행
3. Docker 이미지 빌드
4. GHCR에 `latest`와 commit SHA 태그 push
5. Tailscale OAuth로 tailnet 접속
6. Synology NAS에 SSH 접속
7. `deploy/compose.yml`, `scripts/deploy-synology.sh` 업로드
8. NAS에서 `docker compose pull`
9. NAS에서 `docker compose up -d --remove-orphans`
10. Docker healthcheck로 `/health` 확인
11. 현재 실행 중인 이미지를 제외한 이 프로젝트의 예전 GHCR 이미지 정리

관련 파일:

- 워크플로우: [.github/workflows/deploy.yml](/Users/shinsanghoon/workspace/kis-trader-back/.github/workflows/deploy.yml)
- Compose 파일: [deploy/compose.yml](/Users/shinsanghoon/workspace/kis-trader-back/deploy/compose.yml)
- NAS 배포 스크립트: [scripts/deploy-synology.sh](/Users/shinsanghoon/workspace/kis-trader-back/scripts/deploy-synology.sh)
- 컨테이너 이미지 정의: [Dockerfile](/Users/shinsanghoon/workspace/kis-trader-back/Dockerfile)

## 실행 환경

운영 포트:

- 백엔드/Nest: `20000`
- 헬스체크: `http://<NAS_TAILSCALE_IP>:20000/health`
- GraphQL/API: `http://<NAS_TAILSCALE_IP>:20000/graphql`

Synology 배포 컨테이너는 host network를 사용합니다. 앱은 `PORT=20000`으로 NAS 호스트 포트에 직접 바인딩됩니다. NAS의 `.env.prod`에서 `DATABASE_URL` host는 같은 NAS의 Docker PostgreSQL 포트(`15432`)에 접근하도록 `127.0.0.1`을 사용합니다.

개발 포트:

- 백엔드: `10100`
- 프론트 Vite: `10101`

환경파일:

- 개발: `.env.dev`
- 운영: NAS의 `${SYNOLOGY_DEPLOY_PATH}/.env.prod`

중요 설정:

- `.env.dev` → `TRADING_ENABLED=false`
- NAS `.env.prod` → `TRADING_ENABLED=true`
- NAS `.env.prod`에는 `DATABASE_URL`, `ADMIN_PASSWORD`, `JWT_SECRET`, KIS/Slack 토큰 값이 있어야 함
- 운영 DB는 분리된 PostgreSQL database를 사용해야 함

## NAS 사전 준비

필수:

- Synology Container Manager
- Tailscale 설치 및 tailnet 접속
- SSH 활성화
- `eric` 계정 또는 배포 계정으로 SSH 접속 가능
- 배포 계정에서 비밀번호 없이 Docker 실행 가능
- NAS에서 GHCR 로그인 완료

Docker 권한 확인:

```bash
sudo -k
sudo -n /usr/local/bin/docker ps
sudo -n /usr/local/bin/docker compose version
```

GHCR 로그인:

```bash
docker login ghcr.io -u greatbooms
```

배포 디렉터리:

```bash
sudo mkdir -p /volume1/docker/kis-trader-back
sudo chown -R eric:users /volume1/docker/kis-trader-back
```

운영 환경파일:

```bash
vi /volume1/docker/kis-trader-back/.env.prod
```

필수 예시:

```env
DATABASE_URL=postgresql://postgres:<password>@127.0.0.1:15432/kis_trader_back?schema=public
PORT=20000
NODE_ENV=production
TRADING_ENABLED=true
SLACK_ENABLED=true
```

위 예시 외에 기존 운영 `.env.prod`의 `KIS_*`, `JWT_SECRET`, `ADMIN_PASSWORD`, `SLACK_*` 값을 함께 넣습니다.
비밀값은 GitHub 이슈, PR, 채팅, 로그에 남기지 않습니다.

## GitHub Secrets

Repository → `Settings` → `Secrets and variables` → `Actions`

필수 시크릿:

- `TS_OAUTH_CLIENT_ID`
- `TS_OAUTH_SECRET`
- `SYNOLOGY_HOST`
- `SYNOLOGY_PORT`
- `SYNOLOGY_USER`
- `SYNOLOGY_SSH_KEY`
- `SYNOLOGY_DEPLOY_PATH`

설명:

- `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`
  - Tailscale Admin Console의 OAuth Client
  - `auth_keys` writable scope 필요
- `SYNOLOGY_HOST`
  - NAS의 Tailscale IP 또는 hostname
- `SYNOLOGY_PORT`
  - NAS SSH 포트. 현재 환경은 `2008`
- `SYNOLOGY_USER`
  - NAS 배포 계정. 현재 환경은 `eric`
- `SYNOLOGY_SSH_KEY`
  - GitHub Actions가 사용할 private key 전체
- `SYNOLOGY_DEPLOY_PATH`
  - NAS 배포 기준 경로. 현재 환경은 `/volume1/docker/kis-trader-back`

## 수동 배포/재기동 확인

NAS에서 상태 확인:

```bash
cd /volume1/docker/kis-trader-back
sudo -n /usr/local/bin/docker compose --env-file .deploy.env -f compose.yml ps
sudo -n /usr/local/bin/docker logs --tail 120 kis-trader-back
```

헬스체크:

```bash
curl http://localhost:20000/health
```

재기동:

```bash
cd /volume1/docker/kis-trader-back
sudo -n /usr/local/bin/docker compose --env-file .deploy.env -f compose.yml up -d
```

## 트러블슈팅

### GitHub Actions에서 Tailscale 연결 실패

확인:

- `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET` 값 존재 여부
- OAuth Client 권한에 `auth_keys` writable scope 포함 여부
- `tag:ci` 허용 여부
- `SYNOLOGY_HOST`가 tailnet에서 reachable 한지
- `SYNOLOGY_PORT`가 NAS SSH 포트와 일치하는지

### GHCR pull 실패

확인:

```bash
docker login ghcr.io -u greatbooms
sudo -n /usr/local/bin/docker pull ghcr.io/greatbooms/kis-trader-back:latest
```

private package인 경우 NAS에 저장된 GitHub token이 `read:packages` 권한을 가져야 합니다.

### 컨테이너는 떴는데 앱이 unhealthy

확인:

```bash
cd /volume1/docker/kis-trader-back
sudo -n /usr/local/bin/docker inspect kis-trader-back
sudo -n /usr/local/bin/docker logs --tail 200 kis-trader-back
```

자주 보는 원인:

- `.env.prod` 누락
- `DATABASE_URL` 오타 또는 DB 접근 실패
- NAS `.env.prod`의 `DATABASE_URL` host가 `100.89.219.8`처럼 NAS 자기 Tailscale IP를 가리킴. 같은 NAS 내부에서는 `127.0.0.1`을 사용
- `ADMIN_PASSWORD`, `JWT_SECRET` 누락
- KIS/Slack 토큰 오타

### Prisma migration 실패

확인:

- NAS `.env.prod`의 `DATABASE_URL`
- 원격 PostgreSQL 접속 가능 여부
- 대상 DB가 운영용으로 분리되어 있는지

## Legacy: Mac Studio PM2 배포

이전 배포 방식은 `GitHub Actions + Tailscale + SSH + PM2`였습니다.
관련 파일은 호환성과 참고용으로 남겨둡니다.

- [scripts/deploy.sh](/Users/shinsanghoon/workspace/kis-trader-back/scripts/deploy.sh)
- [ecosystem.config.js](/Users/shinsanghoon/workspace/kis-trader-back/ecosystem.config.js)
