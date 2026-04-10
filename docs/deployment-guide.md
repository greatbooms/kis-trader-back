# 배포 가이드

이 프로젝트는 self-hosted macOS 서버 기준으로 배포할 수 있습니다.  
배포는 `GitHub Actions + Tailscale + SSH + PM2` 조합을 기준으로 구성되어 있습니다.

## 배포 구조

흐름:

1. `main` 브랜치에 push
2. GitHub Actions 실행
3. Tailscale OAuth로 tailnet 접속
4. 운영 서버에 SSH 접속
5. 소스 아카이브 업로드
6. 원격 `scripts/deploy.sh` 실행
7. 의존성 설치, Prisma migration, `yarn build:all`
8. `pm2 startOrRestart ecosystem.config.js --only kis-trader-back`
9. `http://localhost:8888/health` 헬스체크

관련 파일:

- 워크플로우: [deploy.yml](/Users/shinsanghoon/workspace/kis-trader-back/.github/workflows/deploy.yml)
- 원격 배포 스크립트: [deploy.sh](/Users/shinsanghoon/workspace/kis-trader-back/scripts/deploy.sh)
- PM2 설정: [ecosystem.config.js](/Users/shinsanghoon/workspace/kis-trader-back/ecosystem.config.js)

## 실행 환경

운영 포트:

- 백엔드/Nest: `8888`

개발 포트:

- 백엔드: `10100`
- 프론트 Vite: `10101`

환경파일:

- 개발: `.env.dev`
- 운영: `.env.prod`

중요 설정:

- `.env.dev` → `TRADING_ENABLED=false`
- `.env.prod` → `TRADING_ENABLED=true`
- `.env.prod`에는 `ADMIN_PASSWORD`, `JWT_SECRET`가 반드시 있어야 함

## 운영 서버 사전 준비

필수:

- Node.js 20+
- Yarn 1.x
- PostgreSQL 또는 Docker 기반 Postgres
- `pm2` 설치
- Tailscale 로그인 완료
- GitHub Actions용 SSH 공개키 등록

PM2 설치:

```bash
npm install -g pm2
```

운영 환경파일 배치:

```bash
mkdir -p <DEPLOY_PATH>
cp .env.prod <DEPLOY_PATH>/.env.prod
```

`DEPLOY_PATH/.env.prod`는 배포 시 계속 보존됩니다.

예시:

- `DEPLOY_PATH=/opt/apps/kis-trader-back`
- 또는 `DEPLOY_PATH=$HOME/apps/kis-trader-back`

## GitHub Secrets

Repository → `Settings` → `Secrets and variables` → `Actions`

필수 시크릿:

- `TS_OAUTH_CLIENT_ID`
- `TS_OAUTH_SECRET`
- `MAC_STUDIO_HOST`
- `MAC_STUDIO_USER`
- `MAC_STUDIO_SSH_KEY`
- `DEPLOY_PATH`

설명:

- `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`
  - Tailscale Admin Console의 OAuth Client
  - `auth_keys` writable scope 필요
- `MAC_STUDIO_HOST`
  - 운영 서버의 Tailscale hostname 또는 100.x IP
- `MAC_STUDIO_USER`
  - 운영 서버 로그인 사용자명
- `MAC_STUDIO_SSH_KEY`
  - GitHub Actions가 사용할 SSH private key
- `DEPLOY_PATH`
  - 운영 서버 내 배포 기준 경로

참고:

- 시크릿 이름은 현재 워크플로우 기준입니다.
- 이름에 `MAC_STUDIO`가 들어가도 실제 대상은 같은 역할의 운영 서버면 됩니다.

## Tailscale 설정

GitHub Actions는 `tailscale/github-action@v4`를 사용합니다.

필요 사항:

- OAuth Client 생성
- `auth_keys` writable scope 허용
- `tag:ci` 사용 가능해야 함

워크플로우는 현재 `tags: tag:ci`로 동작합니다.

## 자동 시작

운영 서버에서는 부팅/로그인 시 아래 절차가 자동 실행되도록 별도 startup script와 launchd 또는 동등한 프로세스 매니저를 구성할 수 있습니다.

권장 순서:

1. Docker Desktop 또는 Postgres 준비
2. `yarn build:all`
3. `pm2 startOrRestart ecosystem.config.js --only kis-trader-back`

## 수동 배포/재기동 확인

배포 후 상태 확인:

```bash
pm2 list
curl http://localhost:8888/health
```

PM2 상세:

```bash
pm2 describe kis-trader-back
pm2 logs kis-trader-back
```

## 로그 위치

배포 스크립트 로그:

- `${DEPLOY_PATH}/logs/deploy.log`

PM2 앱 로그:

- `PM2_LOG_DIR/pm2.out.log`
- `PM2_LOG_DIR/pm2.error.log`

기본적으로 `ecosystem.config.js`는 `PM2_LOG_DIR` 값을 우선 사용합니다.

## 트러블슈팅

### GitHub Actions에서 Tailscale 연결 실패

확인:

- `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET` 값
- OAuth Client 권한에 `auth_keys` writable scope 포함 여부
- `tag:ci` 허용 여부
- `MAC_STUDIO_HOST`가 tailnet에서 실제 reachable 한지

### 배포는 됐는데 앱이 안 뜰 때

확인:

```bash
pm2 list
pm2 logs kis-trader-back --lines 200
curl http://localhost:8888/health
```

### Prisma migration 실패

확인:

- `.env.prod`의 `DATABASE_URL`
- 운영 서버에서 DB 접근 가능 여부

### 운영 서버 부팅 후 자동 시작 실패

확인:

- startup script 로그
- PM2 로그
- `pm2 list`
