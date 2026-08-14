# 배포 가이드

이 프로젝트의 기본 운영 배포 대상은 Synology NAS Container Manager입니다.
배포는 `GitHub Actions + GHCR + Tailscale + SSH + Docker Compose` 조합으로 동작합니다.

## 배포 구조

흐름:

1. `main` 브랜치에 push 또는 `workflow_dispatch`
2. GitHub Actions 실행
3. Tailscale OAuth로 tailnet 접속
4. Synology NAS Tailscale/SSH 연결 preflight 확인
5. Docker 이미지 빌드
6. GHCR에 `latest`와 commit SHA 태그 push
7. `deploy/compose.yml`, `scripts/deploy-synology.sh` 업로드
8. Synology NAS에 SSH 접속해 배포 스크립트 실행
9. NAS에서 `docker compose pull`
10. NAS에서 `docker compose up -d --remove-orphans`
11. Docker healthcheck로 `/health` 확인
12. 현재 실행 중인 이미지를 제외한 이 프로젝트의 예전 GHCR 이미지 정리

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
- Slack 승인·복구 운영 시 `SLACK_APPROVER_USER_IDS`에 허용할 Slack user ID를 명시해야 함. 누락·빈값은 승인/복구 액션이 fail-closed
- 운영 DB는 분리된 PostgreSQL database를 사용해야 함

## 실거래 프로세스 및 시작 인계

`deploy/compose.yml`은 `container_name: kis-trader-back`인 `app` 서비스 하나만 실행하고, Dockerfile의 production command도 migration 후 `node dist/main` 하나만 시작합니다. 이 단일 활성 프로세스가 실전 주문의 전제입니다.

- live trading에 Docker replica/scale, PM2 cluster, Node cluster 또는 별도 worker를 추가하지 않습니다.
- 새 프로세스는 남아 있는 주문 `SUBMITTING`과 취소 `SUBMITTING` 상태를 먼저 인계합니다.
- 실제 KIS 호출이 시작된 주문은 `SUBMISSION_UNKNOWN`, 시작 전 주문은 `CANCELLED`, 미완료 취소는 `UNKNOWN`으로 보수적으로 전환합니다.
- 인계가 완료될 때까지 trading/order-sync/portfolio-sync/regime cron callback은 대기합니다. 인계 실패 시 callback은 계속 차단됩니다.
- KIS 주문·취소 POST는 네트워크 오류나 5xx에도 자동 재시도하지 않습니다. 불명확한 결과는 Slack과 웹의 공용 복구 흐름에서 KIS GET으로만 확인합니다.

시작 인계는 Slack에 확인 필요 총건수를 한 번만 best-effort로 알립니다. 포트폴리오의 `확인 필요 주문` 카드가 authoritative queue이며, Slack 메시지 실패가 DB 상태를 되돌리지는 않습니다.

### 최초 안전 롤아웃

1. NAS `.env.prod`의 `TRADING_ENABLED=false`로 배포합니다.
2. migration과 서버 시작 인계가 끝났는지 로그에서 확인합니다.
3. 포트폴리오 `확인 필요 주문` 또는 Slack `/확인필요주문`으로 모든 불명확한 주문·취소를 조회하고 처리합니다.
4. 확인 필요 항목이 해소된 뒤에만 `TRADING_ENABLED=true`로 변경하고 컨테이너를 재시작합니다.

`TRADING_ENABLED=false`인 동안에도 인증된 GraphQL/웹 복구와 허용된 Slack 복구는 동작합니다. 새 주문·취소 POST와 거래 cron만 차단됩니다.

### 멀티 브로커 migration 롤아웃

`20260814163000_drop_legacy_brokerless_uniques`(migration 28)는 **one-way boundary**입니다. 이 migration이 적용된 뒤에는 pre-broker(pre-Phase-0/1) binary rollback을 지원하지 않습니다.

중요한 점은 현재 production boot 경로가 `yarn prisma migrate deploy && node dist/main` 이라서, `prisma/migrations`에 있는 migration은 배포 시 자동 적용된다는 것입니다. 그래서 migration 28은 평소에는 `prisma/deferred-migrations`에 두고 auto-migrate 대상에서 제외합니다.

운영 적용은 **반드시 2-release flow**로 진행합니다.

1. Release 1 전 `TRADING_ENABLED=false`로 거래를 중지합니다.
2. 운영 DB를 백업합니다.
3. Release 1에서는 migration 27 `20260814110203_add_broker_dimension`까지만 `prisma/migrations`에 둡니다.
4. Release 1의 Phase 3 binary를 배포해 auto-migrate로 migration 27만 적용합니다. 이때 TOSS는 비활성 상태로 둡니다.
5. Phase 3 stability window 동안 KIS-only 주문·동기화, broker-scoped 데이터, approval/recovery, cash dual-write를 확인합니다.
6. 이 기간에는 migration 28을 계속 deferred 상태로 유지합니다.
7. **이미 KIS에 보유한 종목을 TOSS에도 보유/등록하려는 Release 2 직전**에만 migration 28을 `prisma/migrations`로 승격합니다.
8. Release 2를 배포해 다음 boot의 auto-migrate로 migration 28을 적용합니다.
9. 그 다음에만 TOSS broker switch를 활성화합니다.

| Binary | migration 27 전 | Release 1: migration 27 적용, 28 deferred | Release 2: migration 28 적용 후 |
|---|---|---|---|
| pre-broker (pre-Phase-0/1) | OK | OK | 지원하지 않음 |
| Phase 0-2 | migration 27 필요 | OK | OK |
| Phase 3 | migration 27 필요 | OK; KIS-only 안정화, 기존 KIS 보유 종목의 cross-broker 중복 등록은 아직 금지 | OK; 동일 종목을 KIS/TOSS 양쪽에 보유 가능 |

Migration 28 이후 legacy unique index를 재생성해야 하는 비상 복구에서는 먼저 거래를 중지하고 DB를 백업합니다. 그 다음 `positions`, `watch_stocks`, `risk_snapshots`, `strategy_allocations`의 legacy key 기준 broker 간 중복을 병합·제거해야 합니다. 이 절차는 지원되는 pre-broker rollback이 아닙니다.

Binary rollback 전에는 legacy `account_status_cache` row가 최신 KIS 잔고인지 확인하고 필요하면 재시드합니다. Phase 3 호환 기간에는 KIS refresh가 broker-scoped row와 legacy row를 같은 transaction에서 갱신하지만, Phase 2 binary가 더 이상 rollback target이 아니어서 dual-write를 제거한 뒤에는 수동 재시드가 필수입니다. TOSS cash는 legacy row에 기록하지 않습니다.

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
  - NAS SSH 포트. 환경마다 다르므로 GitHub Secret에 명시적으로 설정합니다.
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

재기동 후 단일 컨테이너인지 확인합니다. `kis-trader-back`이 둘 이상이거나 별도 Node trading worker가 있으면 `TRADING_ENABLED=true`로 운영하지 않습니다.

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

## Removed: Mac Studio PM2 배포

이전 `GitHub Actions + Tailscale + SSH + PM2` 배포 파일은 Synology Docker 배포 안정화 후 제거했습니다.
현재 운영 배포는 GitHub Actions에서 GHCR 이미지를 빌드한 뒤 NAS의 Docker Compose 프로젝트를 갱신합니다.
