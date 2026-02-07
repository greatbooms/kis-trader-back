# KIS Auto-Trading Backend

한국투자증권(KIS) Open Trading API를 활용한 국내+해외 주식 자동매매 서비스 백엔드.

## 주요 기능

- **국내 주식**: KRX (코스피/코스닥) 시세 조회, 매수/매도, 잔고 조회
- **해외 주식**: NASD, NYSE, AMEX, SEHK, SHAA, SZAA, TKSE, HASE, VNSE 지원
- **자동매매 스케줄러**: 설정 간격(기본 30초)으로 시세 확인 및 전략 실행
- **장 운영시간 자동 감지**: 거래소별 운영시간 체크, 장 외 시간 자동 스킵
- **감시 종목 관리**: GraphQL API로 종목 추가/수정/삭제
- **매매 기록**: 모든 주문 이력 DB 저장 및 조회
- **포지션 동기화**: KIS 잔고와 DB 포지션 자동 동기화
- **대시보드**: 수익률, 거래 횟수, 승률 요약
- **Slack 알림**: 매매 체결, 에러 등 실시간 알림 (선택)

## 기술 스택

- **NestJS** — 백엔드 프레임워크
- **GraphQL** (Apollo, Code-First) — API
- **Prisma 7** — ORM (PostgreSQL)
- **Passport + JWT** — 인증
- **Slack Bolt** — 알림 봇 (선택)

## 요구사항

- Node.js 20+
- PostgreSQL 15+
- KIS 실전투자 계좌
- (선택) Slack 워크스페이스

## 빠른 시작

### 1. 클론 및 설치

```bash
git clone <repository-url>
cd kis-trader-back
npm install
```

### 2. 환경변수 설정

```bash
cp .env.example .env
```

`.env` 파일을 편집하여 값을 설정합니다.

#### KIS API

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `KIS_APP_KEY` | KIS 앱 키 | (필수) |
| `KIS_APP_SECRET` | KIS 앱 시크릿 | (필수) |
| `KIS_ACCOUNT_NO` | 계좌번호 (10자리) | (필수) |
| `KIS_PROD_CODE` | 상품코드 | `01` |
| `KIS_ENV` | `prod` (실전) | `prod` |

#### 데이터베이스

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `DATABASE_URL` | PostgreSQL 접속 URL | (필수) |

#### 인증

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `ADMIN_USERNAME` | 관리자 아이디 | `admin` |
| `ADMIN_PASSWORD` | 관리자 비밀번호 | (필수) |
| `JWT_SECRET` | JWT 시크릿 키 | (필수) |

#### 스케줄러

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `TRADING_INTERVAL_MS` | 매매 체크 간격 (ms) | `30000` |

#### Slack (선택)

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `SLACK_BOT_TOKEN` | Slack Bot OAuth 토큰 | |
| `SLACK_APP_TOKEN` | Slack App-Level 토큰 | |
| `SLACK_CHANNEL` | 알림 채널 | `#trading-alerts` |
| `SLACK_ENABLED` | Slack 활성화 여부 | `false` |

#### 서버

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `PORT` | 서버 포트 | `3000` |

#### KIS API 키 발급 방법

1. [한국투자증권 홈페이지](https://www.truefriend.com/) 가입
2. KIS Developers ([https://apiportal.koreainvestment.com/](https://apiportal.koreainvestment.com/)) 접속
3. **API 신청** → 실전투자 앱 키 발급 (`APP_KEY`, `APP_SECRET`)
4. 발급받은 키를 `.env`의 `KIS_APP_KEY`, `KIS_APP_SECRET`에 입력

### 3. PostgreSQL 설정

#### macOS (Homebrew)

```bash
brew install postgresql@15
brew services start postgresql@15
createdb kis_trader
```

#### Docker

```bash
docker run -d --name kis-postgres \
  -e POSTGRES_USER=user \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=kis_trader \
  -p 5432:5432 \
  postgres:15-alpine
```

위 설정 기준 `DATABASE_URL`:
```
postgresql://user:password@localhost:5432/kis_trader
```

### 4. DB 마이그레이션

```bash
npx prisma migrate dev --name init
```

### 5. 서버 실행

```bash
# 개발 모드 (watch)
npm run start:dev

# 프로덕션
npm run build
npm run start:prod
```

서버 시작 후:
- GraphQL Playground: `http://localhost:3000/graphql`
- 헬스체크: `http://localhost:3000/health`

## Slack 알림 설정 (선택)

Slack Bot 설정 방법은 [Slack 설정 가이드](docs/slack-setup-guide.md)를 참고하세요.

## 프로젝트 구조

```
src/
├── main.ts                      # 앱 진입점
├── app.module.ts                # 루트 모듈
├── prisma.service.ts            # Prisma DB 클라이언트
├── config/
│   └── configuration.ts         # 환경변수 설정
├── kis/                         # KIS API 모듈
│   ├── kis.module.ts
│   ├── kis-auth.service.ts      # 토큰 발급/갱신
│   ├── kis-base.service.ts      # 공통 HTTP 헬퍼
│   ├── kis-domestic.service.ts  # 국내 주식 API
│   ├── kis-overseas.service.ts  # 해외 주식 API
│   └── types/
├── trading/                     # 매매 엔진
│   ├── trading.module.ts
│   ├── trading.service.ts       # 매매 실행
│   ├── trading.scheduler.ts     # 스케줄러
│   └── strategy/
├── watch-stock/                 # 감시 종목 CRUD
├── trade-record/                # 매매 기록 + 포지션 + 대시보드
├── notification/                # Slack 알림
│   ├── notification.module.ts
│   ├── slack.service.ts
│   └── slack-commands.service.ts
├── auth/                        # JWT 인증
└── health/                      # 헬스체크
```

## 문서

- [아키텍처](docs/architecture.md)
- [배포 가이드](docs/deployment-guide.md)
- [Slack 설정 가이드](docs/slack-setup-guide.md)
- [무한매수법 전략 설계](docs/infinite-buy-strategy-design.md)

## 라이선스

ISC
