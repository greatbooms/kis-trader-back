# KIS 자동매매 서비스 - 백엔드 프로젝트 설계

## Context
한국투자증권(KIS) Open Trading API를 활용한 **국내+해외 주식** 자동매매 서비스 백엔드를 구축한다. 일정 주기마다 시세를 조회하고, 사용자 정의 알고리즘에 따라 매수/매도를 자동 실행하며, 매매 기록을 DB에 저장한다. 단일 사용자(본인)용으로 개발하되, README에 배포 가이드를 상세히 작성하여 누구나 자신의 환경에 배포할 수 있도록 한다. **이번 단계에서는 백엔드만 구현한다.**

### 지원 시장
- **국내**: KRX (코스피/코스닥) — 09:00~15:30 KST
- **해외**: NASD(나스닥), NYSE(뉴욕), AMEX(아멕스), SEHK(홍콩), SHAA(중국상해), SZAA(중국심천), TKSE(일본), HASE(베트남하노이), VNSE(베트남호치민)

---

## 1. 핵심 기술 결정

### 프레임워크: NestJS
- `@nestjs/schedule` — 주기적 시세 조회 스케줄러에 필수
- DI(Dependency Injection)로 모듈 간 의존성 관리
- Prisma 통합이 자연스러움
- Guards로 API 인증 처리 용이
- 프로젝트 규모(API 서버 + 스케줄러 + DB + 인증)에 적합

### 배포 전략

| 구분 | 서비스 | 이유 |
|------|--------|------|
| **백엔드** | **Koyeb** (free tier) | 무료 always-on (슬립 없음), 신용카드 불필요, 512MB RAM, Docker/Git 배포 지원 |
| **DB** | **Koyeb Postgres** (free tier) | Koyeb에서 무료 Postgres 1개 제공. 별도 DB 서비스 불필요 |
| **프론트엔드** (추후) | **Vercel** (free tier) | Next.js 최적화, 무료 SSL, 자동 배포 |

> **대안:** Render(무료 750시간/월) + UptimeRobot(무료 5분 간격 핑으로 슬립 방지) + Supabase(무료 PostgreSQL 500MB) 조합도 가능. README에 두 가지 배포 방법 모두 문서화.

### ORM: Prisma
- 타입 안전성 우수 (자동 생성 타입)
- 마이그레이션 관리 편리
- NestJS와 통합이 잘 됨

---

## 2. 프로젝트 구조

단일 사용자용이므로 별도 frontend 디렉토리 없이 backend만 구성. 추후 frontend는 별도 프로젝트로 분리.

```
kis-trader-back/
├── src/
│   ├── main.ts                          # 앱 진입점
│   ├── app.module.ts                    # 루트 모듈
│   ├── prisma.service.ts                # Prisma 클라이언트 서비스
│   ├── config/
│   │   └── configuration.ts             # 환경변수 설정
│   ├── kis/                             # KIS API 모듈
│   │   ├── kis.module.ts
│   │   ├── kis-auth.service.ts          # 토큰 발급/갱신 관리
│   │   ├── kis-domestic.service.ts      # 국내 주식 API (시세, 주문, 잔고)
│   │   ├── kis-overseas.service.ts      # 해외 주식 API (시세, 주문, 잔고)
│   │   ├── kis-base.service.ts          # 공통 HTTP 호출 헬퍼
│   │   └── types/
│   │       ├── kis-api.types.ts         # API 요청/응답 타입 (국내+해외)
│   │       └── kis-config.types.ts      # 설정 타입, 거래소 코드 enum
│   ├── trading/                         # 매매 엔진 모듈
│   │   ├── trading.module.ts
│   │   ├── trading.service.ts           # 매매 실행 로직
│   │   ├── trading.scheduler.ts         # 주기적 실행 (cron/interval)
│   │   └── strategy/
│   │       ├── strategy.interface.ts    # 전략 인터페이스
│   │       └── noop.strategy.ts         # 빈 전략 (placeholder)
│   ├── watch-stock/                     # 감시 종목 모듈 (DB 관리)
│   │   ├── watch-stock.module.ts
│   │   ├── watch-stock.service.ts       # DB CRUD
│   │   └── watch-stock.resolver.ts      # GraphQL resolver
│   ├── trade-record/                    # 매매 기록 모듈
│   │   ├── trade-record.module.ts
│   │   ├── trade-record.service.ts      # DB CRUD
│   │   └── trade-record.resolver.ts     # GraphQL resolver
│   ├── auth/                            # 인증 모듈 (단일 유저, 환경변수 기반)
│   │   ├── auth.module.ts
│   │   ├── auth.service.ts              # JWT 발급/검증
│   │   ├── auth.resolver.ts             # GraphQL resolver (login mutation)
│   │   ├── jwt.strategy.ts              # Passport JWT 전략
│   │   └── auth.guard.ts               # GqlAuthGuard (GraphQL 전용)
│   └── health/
│       └── health.controller.ts         # 헬스체크 엔드포인트
├── prisma/
│   ├── schema.prisma                    # DB 스키마
│   └── prisma.config.ts                 # Prisma 7 설정
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── nest-cli.json
├── .env.example
├── .gitignore
├── docs/
│   ├── architecture.md                  # 이 설계 문서
│   └── infinitebuystock-analysis.md     # InfiniteBuyStock 분석
├── Dockerfile                           # Koyeb/Render 배포용
└── README.md                            # 배포 가이드 포함
```

---

## 3. 데이터베이스 스키마 (Prisma)

단일 유저이므로 users 테이블 불필요. KIS 인증정보는 환경변수로 관리.

```prisma
model TradeRecord {
  id            String      @id @default(uuid())
  market        Market                                // DOMESTIC | OVERSEAS
  exchangeCode  String?     @map("exchange_code")     // 거래소 (KRX, NASD, NYSE, SEHK 등)
  stockCode     String      @map("stock_code")        // 종목코드 (005930 / AAPL)
  stockName     String      @map("stock_name")        // 종목명
  side          Side                                   // BUY | SELL
  orderType     OrderType   @map("order_type")        // MARKET | LIMIT
  quantity      Int                                    // 주문수량
  price         Decimal                                // 주문가
  executedPrice Decimal?    @map("executed_price")     // 체결가
  executedQty   Int?        @map("executed_qty")       // 체결수량
  orderNo       String?     @map("order_no")           // KIS 주문번호
  status        OrderStatus                            // PENDING | FILLED | FAILED ...
  strategyName  String?     @map("strategy_name")      // 전략명
  reason        String?                                // 매매 사유
  createdAt     DateTime    @default(now()) @map("created_at")
  updatedAt     DateTime    @updatedAt @map("updated_at")

  @@map("trade_records")
}

model Position {
  id           String   @id @default(uuid())
  market       Market                                  // DOMESTIC | OVERSEAS
  exchangeCode String?  @map("exchange_code")          // 거래소
  stockCode    String   @map("stock_code")
  stockName    String   @map("stock_name")
  quantity     Int
  avgPrice     Decimal  @map("avg_price")
  currentPrice Decimal  @map("current_price")
  profitLoss   Decimal  @map("profit_loss")
  profitRate   Decimal  @map("profit_rate")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@unique([market, stockCode])
  @@map("positions")
}

model WatchStock {
  id           String   @id @default(uuid())
  market       Market                                  // DOMESTIC | OVERSEAS
  exchangeCode String?  @map("exchange_code")          // 해외: NASD, NYSE 등
  stockCode    String   @map("stock_code")             // 005930, AAPL
  stockName    String   @map("stock_name")             // 삼성전자, Apple
  isActive     Boolean  @default(true) @map("is_active") // 활성/비활성
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@unique([market, stockCode])
  @@map("watch_stocks")
}

enum Market { DOMESTIC OVERSEAS }
enum Side { BUY SELL }
enum OrderType { MARKET LIMIT }
enum OrderStatus { PENDING FILLED PARTIAL CANCELLED FAILED }
```

---

## 4. 핵심 모듈 설계

### 4-1. KIS Auth Service (`kis-auth.service.ts`)
- 토큰 발급: POST `/oauth2/tokenP` (appkey + appsecret)
- 토큰 캐싱: 메모리에 저장, 만료 시 자동 재발급 (24시간 유효, 23시간 후 갱신)
- 환경변수: `KIS_APP_KEY`, `KIS_APP_SECRET`, `KIS_ACCOUNT_NO`, `KIS_PROD_CODE`
- `KIS_ENV` (prod | paper) — 실전/모의투자 분기

### 4-2. KIS Domestic Service (`kis-domestic.service.ts`)
- `getPrice(stockCode)` — 국내 현재가 조회
  - GET `/uapi/domestic-stock/v1/quotations/inquire-price`, tr_id: `FHKST01010100`
  - params: `FID_COND_MRKT_DIV_CODE=J`, `FID_INPUT_ISCD=종목코드`
- `orderBuy(stockCode, qty, price?)` — 국내 매수
  - POST `/uapi/domestic-stock/v1/trading/order-cash`, tr_id: `TTTC0012U` (모의: `VTTC0012U`)
- `orderSell(stockCode, qty, price?)` — 국내 매도
  - POST `/uapi/domestic-stock/v1/trading/order-cash`, tr_id: `TTTC0011U` (모의: `VTTC0011U`)
- `getBalance()` — 국내 잔고 조회
  - GET `/uapi/domestic-stock/v1/trading/inquire-balance-rlz-pl`, tr_id: `TTTC8494R`
  - 페이지네이션 지원 (CTX_AREA_FK100/NK100, 최대 10회)

### 4-3. KIS Overseas Service (`kis-overseas.service.ts`)
- `getPrice(exchangeCode, symbol)` — 해외 현재가 조회
  - GET `/uapi/overseas-price/v1/quotations/price`, tr_id: `HHDFS00000300`
  - params: `EXCD=거래소코드(NAS,NYS,AMS...)`, `SYMB=종목코드(AAPL...)`
- `orderBuy(exchangeCode, symbol, qty, price)` — 해외 매수
  - POST `/uapi/overseas-stock/v1/trading/order`, tr_id: 거래소별 상이
  - 미국(NASD/NYSE/AMEX): `TTTT1002U`, 홍콩: `TTTS1002U`, 일본: `TTTS0308U` 등
  - 모의투자: 첫 글자 T→V (`VTTT1002U`)
- `orderSell(exchangeCode, symbol, qty, price)` — 해외 매도
  - POST `/uapi/overseas-stock/v1/trading/order`, tr_id: 거래소별 상이
  - 미국: `TTTT1006U`, 홍콩: `TTTS1001U`, 일본: `TTTS0307U` 등
- `getBalance(nationCode?)` — 해외 잔고 조회
  - GET `/uapi/overseas-stock/v1/trading/inquire-present-balance`, tr_id: `CTRP6504R`
  - 페이지네이션 지원 (CTX_AREA_FK200/NK200, 최대 10회)

### 4-4. KIS Base Service (`kis-base.service.ts`)
- 공통 헤더 구성: Authorization, appkey, appsecret, tr_id, custtype
- GET/POST 요청 래퍼
- Rate limiting: 호출 간 50ms sleep (production), 500ms (paper)
- 에러 핸들링 (rt_cd 체크, '0' = 성공)

### 4-5. Trading Scheduler (`trading.scheduler.ts`)
```
매 30초 (configurable via env TRADING_INTERVAL_MS)
├─ KIS 토큰 유효성 확인
├─ DB에서 활성 감시 종목(watch_stocks) 조회
├─ [국내] 장 운영시간 확인 (09:00~15:30 KST, 평일)
│   ├─ 국내 감시 종목 시세 조회 (kis-domestic)
│   ├─ 국내 포지션 조회 → DB 동기화
│   ├─ 전략 실행 → 주문 → 기록 저장
├─ [해외] 장 운영시간 확인 (거래소별 상이, 미국 23:30~06:00 KST 등)
│   ├─ 해외 감시 종목 시세 조회 (kis-overseas)
│   ├─ 해외 포지션 조회 → DB 동기화
│   ├─ 전략 실행 → 주문 → 기록 저장
└─ 장 외 시간에는 skip (로그만)
```

> **거래소별 운영시간** (KST 기준, 서머타임 고려):
> - KRX: 09:00~15:30
> - NASD/NYSE/AMEX: 23:30~06:00 (서머타임: 22:30~05:00)
> - SEHK: 10:30~17:00
> - TKSE: 09:00~15:00
> - 정확한 시간은 환경변수로 오버라이드 가능

### 4-6. Strategy Interface (`strategy.interface.ts`)
```typescript
interface TradingStrategy {
  name: string;
  evaluate(context: {
    market: 'DOMESTIC' | 'OVERSEAS';
    prices: Map<string, StockPrice>;
    positions: Position[];
  }): Promise<TradingSignal[]>;
}

interface TradingSignal {
  market: 'DOMESTIC' | 'OVERSEAS';
  exchangeCode?: string;  // 해외: NASD, NYSE 등
  stockCode: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price?: number;         // 미지정시 시장가 (해외는 필수)
  reason: string;
}
```
- `NoopStrategy`: 빈 전략 (항상 빈 배열 반환) — placeholder

### 4-7. Auth (단일 유저, JWT 보호)
- 환경변수 `ADMIN_USERNAME`, `ADMIN_PASSWORD`로 관리자 계정 설정
- GraphQL `login` mutation → JWT 발급 (access token, 7일 유효)
- **모든 GraphQL resolver에 GqlAuthGuard 적용** — 토큰 없이는 매매 기록, 포지션, 시세 등 일체 접근 불가
- `login` mutation만 Guard 없이 접근 가능
- Passport JWT 전략으로 토큰 검증

---

## 5. GraphQL API 스키마

**엔드포인트**: `POST /graphql` (+ GraphQL Playground at `/graphql` in dev)
**헬스체크**: `GET /health` (REST — 배포 서비스 헬스체크용)

```graphql
# 인증
type Mutation {
  login(username: String!, password: String!): AuthPayload!
}
type AuthPayload {
  accessToken: String!
}

# 감시 종목
type WatchStock {
  id: ID!
  market: Market!
  exchangeCode: String
  stockCode: String!
  stockName: String!
  isActive: Boolean!
  createdAt: DateTime!
  updatedAt: DateTime!
}

type Query {
  watchStocks(market: Market): [WatchStock!]!
}
type Mutation {
  createWatchStock(input: CreateWatchStockInput!): WatchStock!
  updateWatchStock(id: ID!, input: UpdateWatchStockInput!): WatchStock!
  deleteWatchStock(id: ID!): Boolean!
}

input CreateWatchStockInput {
  market: Market!
  exchangeCode: String
  stockCode: String!
  stockName: String!
}

input UpdateWatchStockInput {
  exchangeCode: String
  stockName: String
  isActive: Boolean
}

# 매매 기록
type TradeRecord {
  id: ID!
  market: Market!
  exchangeCode: String
  stockCode: String!
  stockName: String!
  side: Side!
  orderType: OrderType!
  quantity: Int!
  price: Float!
  executedPrice: Float
  executedQty: Int
  orderNo: String
  status: OrderStatus!
  strategyName: String
  reason: String
  createdAt: DateTime!
}

type Query {
  trades(market: Market, side: Side, limit: Int, offset: Int): [TradeRecord!]!
  trade(id: ID!): TradeRecord
}

# 포지션
type Position {
  id: ID!
  market: Market!
  exchangeCode: String
  stockCode: String!
  stockName: String!
  quantity: Int!
  avgPrice: Float!
  currentPrice: Float!
  profitLoss: Float!
  profitRate: Float!
}

type Query {
  positions(market: Market): [Position!]!
}

# 시세 조회
type StockPrice {
  stockCode: String!
  stockName: String!
  currentPrice: Float!
  openPrice: Float
  highPrice: Float
  lowPrice: Float
  volume: Int
}

type Query {
  quote(stockCode: String!): StockPrice                                    # 국내
  overseasQuote(exchangeCode: String!, symbol: String!): StockPrice        # 해외
}

# 대시보드
type DashboardSummary {
  totalProfitLoss: Float!
  totalTradeCount: Int!
  todayTradeCount: Int!
  winRate: Float!
}

type Query {
  dashboardSummary: DashboardSummary!
}

enum Market { DOMESTIC OVERSEAS }
enum Side { BUY SELL }
enum OrderType { MARKET LIMIT }
enum OrderStatus { PENDING FILLED PARTIAL CANCELLED FAILED }
```

---

## 6. 환경변수 (.env.example)

```env
# KIS API
KIS_APP_KEY=
KIS_APP_SECRET=
KIS_ACCOUNT_NO=
KIS_PROD_CODE=01
KIS_ENV=paper                    # paper | prod

# 감시 종목: DB(watch_stocks 테이블)에서 관리 — 웹페이지에서 추가/수정/삭제

# 스케줄러
TRADING_INTERVAL_MS=30000        # 30초

# 인증
ADMIN_USERNAME=admin
ADMIN_PASSWORD=
JWT_SECRET=

# DB
DATABASE_URL=postgresql://...

# 서버
PORT=3000
```

---

## 7. 주요 패키지

```
# NestJS 코어
@nestjs/core @nestjs/common @nestjs/platform-express
@nestjs/config                    # 환경변수 관리
@nestjs/schedule                  # 크론/인터벌 스케줄러

# GraphQL
@nestjs/graphql @nestjs/apollo    # NestJS GraphQL 통합
@apollo/server                    # Apollo Server v4
graphql                           # GraphQL 코어

# 인증
@nestjs/jwt @nestjs/passport passport passport-jwt

# DB
prisma @prisma/client

# HTTP
axios

# 유효성 검증
class-validator class-transformer

# 유틸
rxjs reflect-metadata
```

---

## 8. 구현 순서

### Step 1: 프로젝트 초기 설정 ✅
- NestJS 프로젝트 생성
- GraphQL 모듈 설정 (`@nestjs/graphql` + Apollo, code-first 방식)
- Prisma 설정 + 스키마 작성 (Prisma 7 — `prisma.config.ts` 사용)
- 환경변수 구조 (.env.example)
- .gitignore, tsconfig 설정
- `docs/` 폴더에 설계 문서 저장

### Step 2: KIS API 모듈 ✅
- `KisAuthService` — 토큰 발급/캐싱/갱신
- `KisBaseService` — 공통 HTTP 헬퍼 (헤더 구성, rate limiting)
- `KisDomesticService` — 국내 시세, 주문, 잔고
- `KisOverseasService` — 해외 시세, 주문, 잔고 (거래소별 TR ID 매핑)
- 타입 정의 (요청/응답, 거래소 코드 enum)

### Step 3: 매매 엔진 ✅
- `TradingStrategy` 인터페이스 + `NoopStrategy`
- `TradingService` — 전략 실행 → 주문
- `TradingScheduler` — @Interval 기반 주기적 실행
- 장 운영시간 체크 로직

### Step 4: 매매 기록 + 감시 종목 ✅
- Prisma 모델 마이그레이션
- `TradeRecordService` + `TradeRecordResolver` — GraphQL 쿼리 (목록, 상세)
- `WatchStockService` + `WatchStockResolver` — GraphQL CRUD (추가/수정/삭제)
- `DashboardSummary` — 대시보드 요약 쿼리

### Step 5: 인증 ✅
- 환경변수 기반 단일 유저 로그인
- `AuthResolver` — login mutation (JWT 발급)
- `GqlAuthGuard` — GraphQL 전용 Guard 적용

### Step 6: 마무리 ✅
- 헬스체크 엔드포인트
- Dockerfile 작성
- README.md (설치, 설정, 배포 가이드)
- .env.example 완성

---

## 9. 검증 방법

1. **KIS API 연동**: 모의투자(paper) 모드에서 시세 조회 확인
2. **스케줄러**: 로그로 주기적 실행 확인 (30초 간격)
3. **주문 테스트**: 모의투자 모드에서 매수/매도 실행
4. **GraphQL Playground**: `http://localhost:3000/graphql`에서 쿼리/뮤테이션 테스트
5. **감시 종목 CRUD**: GraphQL로 종목 추가/삭제/활성화 토글 테스트
6. **인증**: JWT 없이 GraphQL 호출 시 에러 응답 확인
7. **Docker**: `docker build && docker run`으로 컨테이너 실행 확인

---

## 10. 참고 파일 (KIS API 원본)

| 용도 | 파일 경로 |
|------|----------|
| 인증 | `examples_llm/kis_auth.py` |
| **국내** 현재가 | `examples_llm/domestic_stock/inquire_price/inquire_price.py` |
| **국내** 매수/매도 | `examples_llm/domestic_stock/order_cash/order_cash.py` |
| **국내** 잔고 | `examples_llm/domestic_stock/inquire_balance_rlz_pl/inquire_balance_rlz_pl.py` |
| **해외** 현재가 | `examples_llm/overseas_stock/price/price.py` |
| **해외** 매수/매도 | `examples_llm/overseas_stock/order/order.py` |
| **해외** 잔고 | `examples_llm/overseas_stock/inquire_present_balance/inquire_present_balance.py` |
| **해외** 정정/취소 | `examples_llm/overseas_stock/order_rvsecncl/order_rvsecncl.py` |
| 설정 템플릿 | `kis_devlp.yaml` |

> 모든 경로의 루트: `/Users/shinsanghoon/Downloads/open-trading-api-main/`

---

## 11. KIS API 상세 참조

### 공통 요청 패턴
- 모든 엔드포인트 `/uapi/` 프리픽스
- 파라미터명 대문자 (예: `CANO`, `PDNO`, `ORD_QTY`)
- 실전/모의 구분: TR ID 첫 글자 `T` = 실전, `V` = 모의
- HTTP: GET = 조회, POST = 주문/수정

### 공통 응답 구조
```json
{
  "rt_cd": "0",        // "0" = 성공
  "msg_cd": "...",
  "msg1": "...",
  "output": { ... },   // 단일 결과
  "output1": [ ... ],  // 목록 결과 (잔고 등)
  "output2": { ... }   // 부가 정보
}
```

### 공통 헤더
```
Content-Type: application/json; charset=utf-8
authorization: Bearer {access_token}
appkey: {APP_KEY}
appsecret: {APP_SECRET}
tr_id: {TR_ID}
custtype: P
```

### 해외 거래소별 TR ID 매핑

| 거래소 | 매수(실전) | 매도(실전) | 매수(모의) | 매도(모의) |
|--------|-----------|-----------|-----------|-----------|
| NASD/NYSE/AMEX | TTTT1002U | TTTT1006U | VTTT1002U | VTTT1006U |
| SEHK (홍콩) | TTTS1002U | TTTS1001U | VTTS1002U | VTTS1001U |
| SHAA (상해) | TTTS0202U | TTTS1005U | VTTS0202U | VTTS1005U |
| SZAA (심천) | TTTS0305U | TTTS0304U | VTTS0305U | VTTS0304U |
| TKSE (일본) | TTTS0308U | TTTS0307U | VTTS0308U | VTTS0307U |
| HASE/VNSE (베트남) | TTTS0311U | TTTS0310U | VTTS0311U | VTTS0310U |

### 해외 거래소 코드 매핑 (시세 조회용 EXCD)

| 프로젝트 코드 | KIS API EXCD |
|--------------|-------------|
| NASD | NAS |
| NYSE | NYS |
| AMEX | AMS |
| SEHK | HKS |
| SHAA | SHS |
| SZAA | SZS |
| TKSE | TSE |
| HASE | HNX |
| VNSE | HSX |
