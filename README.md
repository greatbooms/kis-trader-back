# KIS Trader

한국투자증권(KIS) Open API 기반 **국내+해외 주식 자동매매 플랫폼**.
NestJS 백엔드와 React 프론트엔드가 하나의 레포에 통합된 풀스택 서비스입니다.

> 실시간 시세 및 계좌 정보는 한국투자증권 Open API를 통해 제공됩니다.
> 시뮬레이션은 자체 가상 매매 데이터입니다.

## 주요 기능

### 자동매매
- **7가지 매매 전략** 탑재 — 무한매수법, 모멘텀 돌파, 그리드 평균회귀, 보수형, 추세추종, 가치팩터, 일별 분할매수
- **거래소별 장 운영시간 자동 감지** — 장 외 시간 자동 스킵
- **30초 간격 자동 매매** — 스케줄러가 시세 확인 후 전략 실행
- **리스크 관리** — 시장 레짐 분석, 포지션 한도, 손절 자동 실행

### 지원 시장
- **국내**: KRX (코스피/코스닥)
- **해외**: NASD, NYSE, AMEX (미국) / SEHK (홍콩) / SHAA, SZAA (중국) / TKSE (일본) / HASE, VNSE (베트남)

### 종목 스크리닝
- 기술적 분석 + 펀더멘탈 + 모멘텀 멀티팩터 점수 산출
- 거래소별 자동 스크리닝 스케줄러 (장 시작 30분 후 실행)
- ETF/개별주 분리 평가, 전략 매칭 추천

### 시뮬레이션
- 가상 자본으로 전략 백테스트
- 실현/미실현 손익 구분 추적
- 일별 스냅샷 기반 자산 곡선 차트
- 승률, 최대 낙폭, 샤프 비율, Profit Factor 등 성과 지표

### 포트폴리오
- 실시간 보유 포지션 및 평가 손익 조회
- 실현 손익 / 미실현 손익 구분 표시
- 수동 매도 기능 (2단계 확인)
- 매매 기록 필터링 (기간, 매수/매도, 시장)

### Slack 알림
- 매수/매도 체결 알림 (종목, 수량, 가격, 전략 상세)
- **손절 매도 시 Slack 승인 요청** — 승인 후 자동 매도 실행
- 일일 포트폴리오 요약
- 슬래시 명령어: `/잔고`, `/요약`, `/종목 [코드]`

### 웹 대시보드
- 포트폴리오 개요 및 핵심 지표
- 종목 스크리닝 결과
- 전략 가이드 (전략별 설명, 리스크, 수익률)
- 감시 종목 관리 (추가/수정/삭제)
- 시세 조회 (국내/해외)
- 시뮬레이션 관리
- 설정 (스크리닝 국가 설정)

## 기술 스택

| 영역 | 기술 |
|------|------|
| Backend | NestJS 11, TypeScript 5.9, Express 5 |
| API | GraphQL (Apollo Server 5, Code-First) |
| Database | PostgreSQL 15+, Prisma 7 |
| Frontend | React 19, Vite 7, TailwindCSS 4, Apollo Client 4 |
| Chart | Recharts 3 |
| Auth | Passport + JWT (Cookie 기반) |
| Notification | Slack Bolt 4 (Socket Mode) |
| Deploy | Docker (Multi-stage build) |

## 요구사항

- Node.js 20+
- PostgreSQL 15+
- KIS 실전투자 계좌 ([키 발급 가이드](docs/kis-api-setup.md))
- (선택) Slack 워크스페이스 ([설정 가이드](docs/slack-setup-guide.md))

## 빠른 시작

### 1. 클론 및 설치

```bash
git clone https://github.com/greatbooms/kis-trader-back.git
cd kis-trader-back
yarn install
cd client && yarn install && cd ..
```

### 2. 환경변수 설정

```bash
cp .env.example .env
```

`.env` 파일을 편집합니다:

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `KIS_APP_KEY` | KIS 앱 키 | (필수) |
| `KIS_APP_SECRET` | KIS 앱 시크릿 | (필수) |
| `KIS_ACCOUNT_NO` | 계좌번호 (10자리) | (필수) |
| `KIS_PROD_CODE` | 상품코드 | `01` |
| `KIS_ENV` | 환경 (`prod` / `paper`) | `prod` |
| `DATABASE_URL` | PostgreSQL 접속 URL | (필수) |
| `ADMIN_USERNAME` | 관리자 아이디 | `admin` |
| `ADMIN_PASSWORD` | 관리자 비밀번호 | (필수) |
| `JWT_SECRET` | JWT 시크릿 키 (32자 이상) | (필수) |
| `TRADING_INTERVAL_MS` | 매매 체크 간격 (ms) | `30000` |
| `PORT` | 서버 포트 | `3000` |
| `SLACK_ENABLED` | Slack 활성화 | `false` |
| `SLACK_BOT_TOKEN` | Slack Bot OAuth 토큰 | |
| `SLACK_APP_TOKEN` | Slack App-Level 토큰 | |
| `SLACK_CHANNEL` | 알림 채널 | `#trading-alerts` |

### 3. 데이터베이스 설정

```bash
# macOS (Homebrew)
brew install postgresql@15
brew services start postgresql@15
createdb kis_trader

# 또는 Docker
docker run -d --name kis-postgres \
  -e POSTGRES_USER=user \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=kis_trader \
  -p 5432:5432 \
  postgres:15-alpine
```

### 4. DB 마이그레이션

```bash
yarn prisma migrate dev --name init
```

### 5. 실행

```bash
# 개발 모드 (터미널 2개)
yarn start:dev           # 백엔드 (port 3000)
yarn client:dev          # 프론트엔드 (port 5173)

# 프로덕션 빌드
yarn build:all
yarn start:prod          # http://localhost:3000
```

- GraphQL Playground: `http://localhost:3000/graphql`
- 헬스체크: `http://localhost:3000/health`

## 매매 전략

| 전략 | 설명 | 리스크 | 매매 빈도 |
|------|------|--------|-----------|
| 무한매수법 | 하락 시 분할매수, T 기반 동적 익절 | 중간 | 하루 1회 |
| 모멘텀 돌파 | 52주 신고가 돌파 시 매수 | 높음 | 주 1~2회 |
| 그리드 평균회귀 | 가격 밴드 내 반복 매매 | 낮음 | 주 2~3회 |
| 보수형 | 저변동성 우량주 중심 | 낮음 | 월 1~2회 |
| 추세추종 | MA 크로스 기반 추세 매매 | 중간 | 주 1회 |
| 가치팩터 | PER/PBR 저평가 종목 투자 | 중간 | 월 1~2회 |
| 일별 분할매수 | 매일 균등 분할 적립식 매수 | 낮음 | 매일 |

## 프로젝트 구조

```
kis-trader-back/
├── src/
│   ├── main.ts                      # 앱 진입점
│   ├── app.module.ts                # 루트 모듈
│   ├── prisma.service.ts            # DB 클라이언트
│   ├── kis/                         # KIS API 연동
│   │   ├── kis-auth.service.ts      #   토큰 발급/갱신
│   │   ├── kis-domestic.service.ts  #   국내 주식 API
│   │   └── kis-overseas.service.ts  #   해외 주식 API
│   ├── trading/                     # 매매 엔진
│   │   ├── trading.service.ts       #   매매 실행
│   │   ├── trading.scheduler.ts     #   스케줄러
│   │   ├── risk.service.ts          #   리스크 관리
│   │   └── strategy/                #   7개 전략 구현
│   ├── screening/                   # 종목 스크리닝
│   ├── simulation/                  # 시뮬레이션 엔진
│   ├── watch-stock/                 # 감시 종목 CRUD
│   ├── trade-record/                # 매매 기록 + 포지션 + 대시보드
│   ├── stock-master/                # 종목 마스터 데이터
│   ├── notification/                # Slack 알림
│   ├── auth/                        # JWT 인증
│   └── health/                      # 헬스체크
├── client/                          # React 프론트엔드
│   └── src/
│       ├── pages/                   #   페이지 컴포넌트
│       ├── components/              #   공통 UI 컴포넌트
│       ├── graphql/                 #   GraphQL 쿼리/뮤테이션
│       └── lib/                     #   유틸리티
├── prisma/                          # DB 스키마 + 마이그레이션
├── docs/                            # 문서
└── Dockerfile                       # 프로덕션 빌드
```

## 주요 스크립트

| 명령어 | 설명 |
|--------|------|
| `yarn start:dev` | 백엔드 개발 서버 (watch 모드) |
| `yarn client:dev` | 프론트엔드 개발 서버 |
| `yarn build:all` | 프론트엔드 + 백엔드 전체 빌드 |
| `yarn start:prod` | 프로덕션 실행 |
| `yarn client:codegen` | GraphQL 타입 코드 생성 |
| `yarn test` | 테스트 실행 |
| `yarn prisma:studio` | Prisma DB 관리 UI |

## 문서

- [KIS API 키 발급 가이드](docs/kis-api-setup.md)
- [배포 가이드](docs/deployment-guide.md) — Koyeb 무료 배포
- [Slack 설정 가이드](docs/slack-setup-guide.md)

## 라이선스

ISC

---

Developed by Eric
