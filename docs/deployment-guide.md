# 배포 가이드

Koyeb (무료 서버 + DB) + UptimeRobot (Keep-alive)으로 **월 $0** 배포.
NestJS가 React 정적 빌드를 직접 서빙하는 단일 배포 구조입니다.

## 1. 아키텍처 개요

```
┌───────────────────────────────┐
│  Koyeb (무료)                 │
│  ┌─────────────────────────┐  │
│  │  NestJS Server          │  │
│  │  + React SPA (정적 서빙)│  │
│  │  0.1 vCPU / 512MB       │  │
│  └──────────┬──────────────┘  │
│             │                 │
│  ┌──────────▼──────────────┐  │
│  │  PostgreSQL (무료)      │  │
│  │  Koyeb 내장 DB          │  │
│  └─────────────────────────┘  │
└───────────────────────────────┘
        ▲
        │ 5분마다 ping
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

## 2. Koyeb 계정 생성

1. [koyeb.com](https://www.koyeb.com/) 가입 (GitHub 연동 권장)
2. 무료 플랜 확인 (Free tier: 1 Web Service + 1 PostgreSQL)

## 3. PostgreSQL 데이터베이스 생성

1. Koyeb 대시보드 → **Databases** → **Create Database**
2. 설정:
   - Name: `kis-trader-db`
   - Region: **Washington, D.C.** (서버와 동일 리전 권장)
3. **Create** 클릭
4. 생성 완료 후 **Connection string** 복사

`DATABASE_URL` 형식:
```
postgresql://username:password@ep-xxxxx.us-east-2.pg.koyeb.app/koyebdb?sslmode=require
```

> Koyeb 무료 PostgreSQL: 단일 사용자 자동매매 데이터에 충분한 용량입니다.
> 앱과 DB가 같은 플랫폼에 있어 네트워크 지연도 최소화됩니다.

## 4. 웹 서비스 배포

### 4-1. Web Service 생성

1. Apps → **Create App** → **Web Service**
2. Source: **GitHub** → 레포 연결 (`kis-trader-back`)
3. Builder: **Dockerfile**
4. Region: **Washington, D.C.** (DB와 동일 리전)
5. Instance: **Free** (0.1 vCPU, 512MB RAM)

### 4-2. 환경변수 설정

Settings → Environment Variables:

| 변수 | 값 | 비고 |
|------|------|------|
| `DATABASE_URL` | Koyeb DB Connection string | 3단계에서 복사 |
| `KIS_APP_KEY` | KIS 앱 키 | [키 발급 가이드](kis-api-setup.md) 참고 |
| `KIS_APP_SECRET` | KIS 앱 시크릿 | |
| `KIS_ACCOUNT_NO` | 계좌번호 (10자리) | |
| `KIS_PROD_CODE` | `01` | |
| `KIS_ENV` | `prod` | |
| `ADMIN_USERNAME` | 관리자 아이디 | |
| `ADMIN_PASSWORD` | 관리자 비밀번호 | 강한 비밀번호 사용 |
| `JWT_SECRET` | JWT 시크릿 키 | 32자 이상 랜덤 문자열 |
| `PORT` | `3000` | |
| `SLACK_ENABLED` | `true` 또는 `false` | Slack 사용 시 `true` |
| `SLACK_BOT_TOKEN` | Slack Bot OAuth 토큰 | [Slack 가이드](slack-setup-guide.md) 참고 |
| `SLACK_APP_TOKEN` | Slack App-Level 토큰 | |
| `SLACK_CHANNEL` | `#trading-alerts` | |

> 프론트엔드와 백엔드가 같은 서버에서 서빙되므로 `CORS_ORIGIN`은 불필요합니다.

### 4-3. Health Check 설정

- Path: `/health`
- Protocol: HTTP
- Port: 3000

### 4-4. 배포

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

## 5. UptimeRobot Keep-alive 설정

Koyeb 무료 인스턴스의 Scale-to-Zero를 방지하기 위한 외부 핑 서비스.

1. [uptimerobot.com](https://uptimerobot.com/) 가입 (무료)
2. **Add New Monitor** 클릭
3. 설정:
   - Monitor Type: **HTTP(s)**
   - Friendly Name: `kis-trader`
   - URL: `https://<your-app>.koyeb.app/health`
   - Monitoring Interval: **5 minutes**
4. **Create Monitor** 클릭

## 6. CI/CD (GitHub Actions)

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

      - run: yarn install --frozen-lockfile

      - run: yarn build

      - name: Run DB migration
        run: yarn prisma migrate deploy
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

**GitHub Secrets 설정** (Settings → Secrets and variables → Actions):

| 시크릿 | 설명 |
|--------|------|
| `DATABASE_URL` | Koyeb DB Connection string |
| `KOYEB_TOKEN` | Koyeb API 토큰 (Account → API → Create Token) |

## 7. 로컬 개발

```bash
# Terminal 1: 백엔드 (port 3000)
yarn start:dev

# Terminal 2: 프론트엔드 (port 5173, proxy → 3000)
yarn client:dev
```

프로덕션 빌드 테스트:
```bash
yarn build:all && yarn start:prod
# http://localhost:3000 에서 React 앱 + GraphQL 모두 확인
```

## 8. 운영 체크리스트

- [ ] Koyeb DB 생성 + `DATABASE_URL` 확보
- [ ] Koyeb 서비스 생성 + 환경변수 설정
- [ ] 강한 `JWT_SECRET` 설정 (32자 이상 랜덤 문자열)
- [ ] 강한 `ADMIN_PASSWORD` 설정
- [ ] UptimeRobot 모니터 추가 (5분 간격, `/health`)
- [ ] 헬스체크 정상 응답 확인 (`GET /health`)
- [ ] 프론트엔드 접속 확인 (로그인 → 쿠키 인증 동작)
- [ ] (선택) Slack 알림 설정 (`SLACK_ENABLED=true` + 토큰)
- [ ] (선택) Koyeb 커스텀 도메인 설정

## 9. 비용 요약

| 항목 | 서비스 | 월 비용 |
|------|--------|---------|
| 서버 + 프론트엔드 | Koyeb Free (0.1 vCPU, 512MB) | $0 |
| 데이터베이스 | Koyeb PostgreSQL (무료) | $0 |
| Keep-alive | UptimeRobot (5분 간격 핑) | $0 |
| **합계** | | **$0** |

## 10. 트러블슈팅

### 배포 실패 시
- Koyeb 대시보드 → 서비스 → **Logs** 탭에서 빌드/런타임 로그 확인
- Dockerfile 빌드 에러: 로컬에서 `docker build .` 테스트

### DB 연결 실패 시
- `DATABASE_URL`에 `?sslmode=require` 포함 확인
- Koyeb DB와 서비스가 동일 리전인지 확인

### 슬립 후 첫 요청이 느린 경우
- UptimeRobot이 정상 작동 중인지 확인 (Monitor → Status: Up)
- 핑 간격이 5분 이하인지 확인
