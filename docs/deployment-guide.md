# 배포 가이드

Koyeb (무료 서버) + Supabase (무료 DB) + Vercel (무료 프론트엔드) + UptimeRobot (Keep-alive)로 **월 $0** 배포.

## 1. 아키텍처 개요

```
┌──────────────────┐      ┌─────────────────────┐
│  Koyeb (무료)    │─────▶│  Supabase (무료)     │
│  NestJS Server   │      │  PostgreSQL          │
│  0.1 vCPU/512MB  │      │  500MB 스토리지      │
└──────────────────┘      └─────────────────────┘
        ▲       ▲
        │       │ 5분마다 ping
        │       │
        │  ┌────┴──────────────┐
        │  │  UptimeRobot      │
        │  │  (Keep-alive)     │
        │  └───────────────────┘
        │
        │  /graphql (rewrite proxy)
        │
┌───────┴──────────┐
│  Vercel (무료)   │
│  React SPA       │
│  프론트엔드      │
└──────────────────┘
        │
        ├── GET /health       (헬스체크)
        ├── POST /graphql     (API - Vercel → Koyeb 프록시)
        └── Slack 알림 (선택)
```

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
| `CORS_ORIGIN` | `https://<your-app>.vercel.app` |
| `PORT` | `3000` |
| `SLACK_ENABLED` | `true` (Slack 사용 시) |
| `SLACK_BOT_TOKEN` | Slack Bot OAuth 토큰 |
| `SLACK_APP_TOKEN` | Slack App-Level 토큰 |
| `SLACK_CHANNEL` | `#trading-alerts` |

> `CORS_ORIGIN`: Vercel rewrite 방식을 사용하면 브라우저에서 같은 오리진으로 인식되므로 CORS가 직접적 문제는 아니지만, GraphQL Playground 등에서 백엔드에 직접 접근할 때 필요합니다.

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

## 4. UptimeRobot Keep-alive 설정

Koyeb 무료 인스턴스의 Scale-to-Zero를 방지하기 위한 외부 핑 서비스.

> **왜 GitHub Actions cron이 아닌가?**
> Koyeb 무료 인스턴스의 슬립 타임아웃이 **5분**으로 변경되었습니다. GitHub Actions cron은 최소 5분 간격이지만 실행 지연이 있어 정확한 5분 보장이 어렵습니다. UptimeRobot은 무료 계정에서 5분 간격 모니터를 제공하며, 안정적으로 슬립을 방지합니다.

### 4-1. UptimeRobot 설정

1. [uptimerobot.com](https://uptimerobot.com/) 가입 (무료)
2. **Add New Monitor** 클릭
3. 설정:
   - Monitor Type: **HTTP(s)**
   - Friendly Name: `kis-trader`
   - URL: `https://<your-app>.koyeb.app/health`
   - Monitoring Interval: **5 minutes**
4. **Create Monitor** 클릭

이것만으로 5분마다 자동으로 `/health` 엔드포인트에 요청을 보내 슬립을 방지합니다.

### 4-2. GitHub Actions cron 대비 장점

| 항목 | UptimeRobot | GitHub Actions cron |
|------|-------------|-------------------|
| 최소 간격 | 5분 (정확) | 5분 (지연 가능) |
| 무료 사용량 | 50개 모니터 | Public 2,000분/월, Private 500분/월 |
| 설정 | 웹 UI에서 1분 | YAML 작성 + 시크릿 설정 |
| 안정성 | 전용 모니터링 서비스 | CI/CD 도구의 부가 기능 |

## 5. 프론트엔드(Vercel) 배포

### 5-1. 사전 준비

프론트엔드 프로젝트에 `vercel.json`이 포함되어 있습니다:

```json
{
  "rewrites": [
    { "source": "/graphql", "destination": "https://<your-app>.koyeb.app/graphql" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

- `/graphql` 요청을 Koyeb 백엔드로 프록시 → cross-origin 쿠키 문제 해결
- `/(.*)`은 SPA 라우팅을 위한 catch-all (React Router 새로고침 시 404 방지)

> **배포 전 반드시** `vercel.json`의 `<your-app>` 부분을 실제 Koyeb 앱 URL로 변경하세요.

### 5-2. Vercel 배포

1. [vercel.com](https://vercel.com/) 가입 (GitHub 연동 권장)
2. **Add New Project** → GitHub 레포(`kis-trader-front`) 연결
3. 빌드 설정:
   - Framework Preset: **Vite**
   - Build Command: `npm run build`
   - Output Directory: `dist`
4. **Deploy** 클릭

### 5-3. 배포 확인

```bash
# 프론트엔드 접속
# 브라우저에서 https://<your-app>.vercel.app

# GraphQL 프록시 확인
curl https://<your-app>.vercel.app/graphql
```

### 5-4. 쿠키 인증 동작 방식

프론트엔드(`xxx.vercel.app`)와 백엔드(`xxx.koyeb.app`)는 서로 다른 도메인이므로, 일반적으로 cross-origin 쿠키가 차단됩니다.

**Vercel rewrite**를 사용하면:
- 브라우저는 `/graphql` 요청을 `xxx.vercel.app/graphql`로 보냄
- Vercel이 서버 측에서 `xxx.koyeb.app/graphql`로 프록시
- 브라우저 입장에서는 **같은 오리진** → `sameSite: 'strict'` 쿠키 정상 작동

따라서 `apollo.ts`의 `uri: '/graphql'`과 `auth.resolver.ts`의 `sameSite: 'strict'`는 변경 불필요합니다.

## 6. CI/CD (GitHub Actions)

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

## 7. 운영 체크리스트

- [ ] Supabase DB 생성 + `DATABASE_URL` 확보
- [ ] Koyeb 서비스 생성 + 환경변수 설정
- [ ] 강한 `JWT_SECRET` 설정 (32자 이상 랜덤 문자열)
- [ ] 강한 `ADMIN_PASSWORD` 설정
- [ ] `CORS_ORIGIN`에 Vercel 도메인 설정
- [ ] UptimeRobot 모니터 추가 (5분 간격, `/health`)
- [ ] 헬스체크 정상 응답 확인 (`GET /health`)
- [ ] Vercel 프로젝트 생성 + `vercel.json`의 rewrite destination 설정
- [ ] 프론트엔드 배포 확인 (로그인 → 쿠키 인증 동작)
- [ ] Cron 시간 확인 — KST 기준 (`US_MARKET_CRON`, `KR_MARKET_CRON`)
- [ ] (선택) Slack 알림 설정 (`SLACK_ENABLED=true` + 토큰)
- [ ] (선택) Koyeb 커스텀 도메인 설정

## 8. 비용 요약

| 항목 | 서비스 | 월 비용 |
|------|--------|---------|
| 서버 | Koyeb Free (0.1 vCPU, 512MB) | $0 |
| DB | Supabase Free (500MB) | $0 |
| 프론트엔드 | Vercel Free (React SPA) | $0 |
| Keep-alive | UptimeRobot (5분 간격 핑) | $0 |
| **합계** | | **$0** |
