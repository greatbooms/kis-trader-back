# 배포 가이드

Koyeb (무료 서버) + Supabase (무료 DB) + UptimeRobot (Keep-alive)로 **월 $0** 배포.
NestJS가 React 정적 빌드를 직접 서빙하는 단일 배포 구조.

## 1. 아키텍처 개요

```
┌──────────────────────────┐      ┌─────────────────────┐
│  Koyeb (무료)            │─────▶│  Supabase (무료)     │
│  NestJS Server           │      │  PostgreSQL          │
│  + React SPA (정적 서빙) │      │  500MB 스토리지      │
│  0.1 vCPU/512MB          │      └─────────────────────┘
└──────────────────────────┘
        ▲
        │ 5분마다 ping
        │
   ┌────┴──────────────┐
   │  UptimeRobot      │
   │  (Keep-alive)     │
   └───────────────────┘
```

- `GET /health` — 헬스체크
- `POST /graphql` — GraphQL API
- `GET /*` — React SPA (ServeStaticModule)

**Koyeb 무료 인스턴스는 5분 트래픽 없으면 Scale-to-Zero로 슬립됩니다.**
UptimeRobot(무료)으로 5분 간격 `/health` 핑을 보내 슬립을 방지합니다.

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

> 프론트엔드와 백엔드가 같은 서버에서 서빙되므로 `CORS_ORIGIN`은 불필요합니다.

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

# 프론트엔드 (React SPA)
# 브라우저에서 https://<your-app>.koyeb.app

# GraphQL Playground
# 브라우저에서 https://<your-app>.koyeb.app/graphql
```

## 4. UptimeRobot Keep-alive 설정

Koyeb 무료 인스턴스의 Scale-to-Zero를 방지하기 위한 외부 핑 서비스.

### 4-1. UptimeRobot 설정

1. [uptimerobot.com](https://uptimerobot.com/) 가입 (무료)
2. **Add New Monitor** 클릭
3. 설정:
   - Monitor Type: **HTTP(s)**
   - Friendly Name: `kis-trader`
   - URL: `https://<your-app>.koyeb.app/health`
   - Monitoring Interval: **5 minutes**
4. **Create Monitor** 클릭

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

**시크릿 설정**:

| 시크릿 | 설명 |
|--------|------|
| `DATABASE_URL` | Supabase Connection string |
| `KOYEB_TOKEN` | Koyeb API 토큰 (Account → API → Create Token) |

## 6. 로컬 개발

- Terminal 1: `npm run start:dev` (NestJS, port 3000)
- Terminal 2: `npm run client:dev` (Vite, port 5173, proxy → 3000)

프로덕션 빌드 테스트:
```bash
npm run build:all && npm run start:prod
# http://localhost:3000 에서 React 앱 + GraphQL 모두 확인
```

## 7. 운영 체크리스트

- [ ] Supabase DB 생성 + `DATABASE_URL` 확보
- [ ] Koyeb 서비스 생성 + 환경변수 설정
- [ ] 강한 `JWT_SECRET` 설정 (32자 이상 랜덤 문자열)
- [ ] 강한 `ADMIN_PASSWORD` 설정
- [ ] UptimeRobot 모니터 추가 (5분 간격, `/health`)
- [ ] 헬스체크 정상 응답 확인 (`GET /health`)
- [ ] 프론트엔드 접속 확인 (로그인 → 쿠키 인증 동작)
- [ ] Cron 시간 확인 — KST 기준 (`US_MARKET_CRON`, `KR_MARKET_CRON`)
- [ ] (선택) Slack 알림 설정 (`SLACK_ENABLED=true` + 토큰)
- [ ] (선택) Koyeb 커스텀 도메인 설정

## 8. 비용 요약

| 항목 | 서비스 | 월 비용 |
|------|--------|---------|
| 서버 + 프론트엔드 | Koyeb Free (0.1 vCPU, 512MB) | $0 |
| DB | Supabase Free (500MB) | $0 |
| Keep-alive | UptimeRobot (5분 간격 핑) | $0 |
| **합계** | | **$0** |
