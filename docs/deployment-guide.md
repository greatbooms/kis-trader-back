# 배포 가이드

Koyeb (무료 서버) + Supabase (무료 DB) + GitHub Actions (Keep-alive)로 **월 $0** 배포.

## 1. 아키텍처 개요

```
┌──────────────────┐      ┌─────────────────────┐
│  Koyeb (무료)    │─────▶│  Supabase (무료)     │
│  NestJS Server   │      │  PostgreSQL          │
│  0.1 vCPU/512MB  │      │  500MB 스토리지      │
└──────────────────┘      └─────────────────────┘
        │       ▲
        │       │ 50분마다 ping
        │       │
        │  ┌────┴──────────────┐
        │  │  GitHub Actions   │
        │  │  (Keep-alive)     │
        │  └───────────────────┘
        │
        ├── GET /health       (헬스체크)
        ├── POST /graphql     (API)
        └── Slack 알림 (선택)
```

**Koyeb 무료 인스턴스는 1시간 트래픽 없으면 Scale-to-Zero로 슬립됩니다.**
GitHub Actions cron으로 50분마다 `/health`에 요청을 보내 슬립을 방지합니다.

## 2. Supabase PostgreSQL 설정

1. [supabase.com](https://supabase.com/) 가입
2. **New Project** 생성 (Region: Northeast Asia 권장)
3. Project Settings → Database → **Connection string (URI)** 복사

`DATABASE_URL` 형식:
```
postgresql://postgres.[project-ref]:[password]@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres
```

> Supabase 무료 플랜: 500MB 스토리지, 7일 미접속 시 pause (이 앱은 상시 접속하므로 해당 없음)

## 3. Koyeb 서버 배포

### 3-1. 계정 생성

[koyeb.com](https://www.koyeb.com/) 가입 (GitHub 연동 권장)

### 3-2. Web Service 생성

1. Apps → **Create App** → Web Service
2. Source: **GitHub** → 레포 연결
3. Builder: **Dockerfile**
4. Region: **Washington, D.C.** 또는 **Frankfurt**
5. Instance: **Free** (0.1 vCPU, 512MB RAM)

### 3-3. 환경변수 설정

Settings → Environment Variables:

| 변수 | 값 |
|------|------|
| `DATABASE_URL` | Supabase에서 복사한 Connection string |
| `KIS_APP_KEY` | KIS 앱 키 |
| `KIS_APP_SECRET` | KIS 앱 시크릿 |
| `KIS_ACCOUNT_NO` | 계좌번호 (10자리) |
| `KIS_PROD_CODE` | `01` |
| `KIS_ENV` | `prod` |
| `ADMIN_USERNAME` | 관리자 아이디 |
| `ADMIN_PASSWORD` | 관리자 비밀번호 |
| `JWT_SECRET` | JWT 시크릿 키 (32자 이상 랜덤 문자열) |
| `PORT` | `3000` |
| `SLACK_ENABLED` | `true` (Slack 사용 시) |
| `SLACK_BOT_TOKEN` | Slack Bot OAuth 토큰 |
| `SLACK_APP_TOKEN` | Slack App-Level 토큰 |
| `SLACK_CHANNEL` | `#trading-alerts` |

### 3-4. Health Check 설정

- Path: `/health`
- Protocol: HTTP
- Port: 3000

### 3-5. 배포

**Deploy** 클릭 → Dockerfile 빌드 → 자동 배포. 완료 시 HTTPS URL 제공.

배포 확인:
```bash
# 헬스체크
curl https://<your-app>.koyeb.app/health

# GraphQL Playground
# 브라우저에서 https://<your-app>.koyeb.app/graphql
```

## 4. GitHub Actions Keep-alive 설정

Koyeb 무료 인스턴스의 Scale-to-Zero를 방지하기 위한 워크플로우.

`.github/workflows/keep-alive.yml`:

```yaml
name: Keep Alive

on:
  schedule:
    # 50분마다 실행 (Koyeb 슬립 타임아웃: 1시간)
    - cron: "*/50 * * * *"
  workflow_dispatch: # 수동 실행

jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: Ping health endpoint
        run: |
          curl -sf --max-time 30 "${{ secrets.APP_URL }}/health" || echo "Ping failed"
```

**시크릿 설정** (GitHub → Settings → Secrets and variables → Actions):

| 시크릿 | 값 |
|--------|------|
| `APP_URL` | `https://<your-app>.koyeb.app` |

> GitHub Actions 무료 사용량: Public 레포 2,000분/월, Private 레포 500분/월.
> 50분 간격 ping은 월 ~240분 소모 — Private 레포도 충분.

## 5. CI/CD (GitHub Actions)

### 배포 워크플로우

main 브랜치에 push하면 자동으로 빌드 + DB 마이그레이션 + Koyeb 배포.

`.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - run: npm ci

      - run: npm run build

      - name: Run DB migration
        run: npx prisma migrate deploy
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}

      - name: Deploy to Koyeb
        uses: koyeb/action-git-deploy@v1
        with:
          app-name: kis-trader
          service-name: kis-trader
        env:
          KOYEB_TOKEN: ${{ secrets.KOYEB_TOKEN }}
```

**추가 시크릿 설정**:

| 시크릿 | 설명 |
|--------|------|
| `DATABASE_URL` | Supabase Connection string |
| `KOYEB_TOKEN` | Koyeb API 토큰 (Account → API → Create Token) |

### CI 워크플로우 (선택)

PR 시 빌드 체크.

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - run: npm ci

      - run: npm run build
```

## 6. 운영 체크리스트

- [ ] Supabase DB 생성 + `DATABASE_URL` 확보
- [ ] Koyeb 서비스 생성 + 환경변수 설정
- [ ] 강한 `JWT_SECRET` 설정 (32자 이상 랜덤 문자열)
- [ ] 강한 `ADMIN_PASSWORD` 설정
- [ ] GitHub Actions keep-alive 워크플로우 추가 + `APP_URL` 시크릿 설정
- [ ] 헬스체크 정상 응답 확인 (`GET /health`)
- [ ] Cron 시간 확인 — KST 기준 (`US_MARKET_CRON`, `KR_MARKET_CRON`)
- [ ] (선택) Slack 알림 설정 (`SLACK_ENABLED=true` + 토큰)
- [ ] (선택) Koyeb 커스텀 도메인 설정

## 7. 비용 요약

| 항목 | 서비스 | 월 비용 |
|------|--------|---------|
| 서버 | Koyeb Free (0.1 vCPU, 512MB) | $0 |
| DB | Supabase Free (500MB) | $0 |
| Keep-alive | GitHub Actions cron | $0 |
| **합계** | | **$0** |
