# 무한매수법(Infinite Buy Strategy) — 개선된 전략 구현 설계

## Context

kis-trader-back 프로젝트의 전략(strategy) 부분이 `NoopStrategy`(빈 전략)만 있는 상태다. InfiniteBuyStock 안드로이드 앱을 분석하고 전략 리뷰(A~E 개선사항)를 거쳐, **모든 개선사항을 포함한 무한매수법**을 구현한다.

### 원본 대비 개선점 (A~E 모두 포함)
| 개선 | 원본 안드로이드 앱 | 우리 구현 |
|------|------------------|----------|
| **A. 손절** | 없음 (T≥40 수동 전환만) | configurable `stopLossRate` (기본 30%) |
| **B. 동적 매도** | 고정 +10% | T<10: +5%, T 10~20: +10%, T≥20: +15% |
| **C. 종목 선별** | 아무 종목 가능 | MA200 위 + RSI 30 이하 필터 |
| **D. 자본 관리** | quota 고정, 한도 없음 | 종목당 투자한도, 최소 현금비율 유지 |
| **E. 시장 상황** | 무관 | 시장별 참조지수 200일선, 금리 체크 |
| **F. 미체결 관리** | 없음 | 매일 실행 전 전일 미체결 주문 자동 취소 |
| **실행 방식** | 수동 버튼 클릭 | Cron 기반 완전 자동화 (LOC) |
| **휴장일** | 미지원 | KIS 국내+해외 휴장일 API 연동 |
| **시장별 지수** | S&P500 고정 | 거래소별 참조 지수 설정 가능 (KOSPI, S&P500, 항셍 등) |

### 핵심 변경사항
- DB 스키마 확장 (전략 설정, 시장 지표 캐시, 실행 이력)
- KIS API 대폭 확장 (LOC, 일별 시세, 매수가능금액, 지수, 금리, 휴장일, 미체결 조회/취소)
- MarketAnalysisService 신규 (MA200, RSI 계산, 시장 상황 평가)
- InfiniteBuyStrategy 핵심 알고리즘 (A~F 개선사항 모두 포함)
- Cron 기반 하루 1회 실행 스케줄러
- GraphQL API 확장

---

## Phase 1: Prisma 스키마 확장

**파일: `prisma/schema.prisma`**

### 1-1. OrderType enum에 LOC 추가
```prisma
enum OrderType { MARKET LIMIT LOC }
```

### 1-2. WatchStock에 전략 설정 필드 추가
```prisma
model WatchStock {
  // ... 기존 필드 유지 ...
  strategyName    String?  @map("strategy_name")
  quota           Decimal? @db.Decimal(12,2)
  cycle           Int      @default(0)
  maxCycles       Int      @default(40) @map("max_cycles")
  stopLossRate    Decimal  @default(0.3) @map("stop_loss_rate") @db.Decimal(4,3)
  maxPortfolioRate Decimal @default(0.2) @map("max_portfolio_rate") @db.Decimal(4,3)  // 개선 D: 종목당 최대 투자비율 (기본 20%)
}
```

### 1-3. Position에 totalInvested 추가
```prisma
model Position {
  // ... 기존 필드 유지 ...
  totalInvested Decimal  @default(0) @map("total_invested") @db.Decimal(16,4)
}
```

### 1-4. StrategyExecution 테이블 신규
```prisma
model StrategyExecution {
  id           String   @id @default(uuid())
  market       Market
  stockCode    String   @map("stock_code")
  strategyName String   @map("strategy_name")
  executedDate String   @map("executed_date")  // YYYY-MM-DD
  progress     Decimal  @map("progress") @db.Decimal(8,2)
  signalCount  Int      @map("signal_count")
  details      String?  // JSON: { skippedReason, ma200Check, rsiCheck, ... }
  createdAt    DateTime @default(now()) @map("created_at")

  @@unique([market, stockCode, strategyName, executedDate])
  @@map("strategy_executions")
}
```

---

## Phase 2: KIS API 확장

### 2-1. LOC 주문 지원
**파일: `src/kis/kis-overseas.service.ts`, `src/kis/kis-domestic.service.ts`**
- `order()` 메서드에 `orderDivision` 파라미터 추가 (기본값 `'00'`)
- `ORD_DVSN` 하드코딩 → `orderDivision`으로 변경

**파일: `src/kis/types/kis-api.types.ts`**
- `OverseasOrderDivision` 타입: `'00' | '32' | '33' | '34'`

### 2-2. 일별 시세 조회 (개선 C: MA200, RSI 계산용)
**파일: `src/kis/kis-overseas.service.ts`** — 신규 메서드
```typescript
async getDailyPrices(exchangeCode: ExchangeCode, stockCode: string, count?: number): Promise<DailyPrice[]>
// GET /uapi/overseas-price/v1/quotations/dailyprice
// TR: HHDFS76240000, Params: EXCD, SYMB, GUBN='0'(일), BYMD='', MODP='1'
// Response output2[]: { xymd, clos, open, high, low, tvol, tamt }
// 1회 호출에 최대 100건, count > 100이면 2회 호출
```

**파일: `src/kis/kis-domestic.service.ts`** — 신규 메서드
```typescript
async getDailyPrices(stockCode: string, startDate: string, endDate: string): Promise<DailyPrice[]>
// GET /uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice
// TR: FHKST03010100
// Params: FID_COND_MRKT_DIV_CODE='J', FID_INPUT_ISCD, FID_INPUT_DATE_1, FID_INPUT_DATE_2, FID_PERIOD_DIV_CODE='D'
// 1회 호출에 최대 100건
```

### 2-3. 매수 가능 금액 조회 (개선 D: 자본 관리)
**파일: `src/kis/kis-domestic.service.ts`** — 신규 메서드
```typescript
async getBuyableAmount(): Promise<{ cashAvailable: number }>
// GET /uapi/domestic-stock/v1/trading/inquire-psbl-order
// TR: TTTC8908R (실전) / VTTC8908R (모의)
// Params: CANO, ACNT_PRDT_CD, PDNO='', ORD_UNPR='0', ORD_DVSN='01', CMA_EVLU_AMT_ICLD_YN='Y', OVRS_ICLD_YN='Y'
// Response: output.ord_psbl_cash (주문가능현금)
```

**파일: `src/kis/kis-overseas.service.ts`** — 신규 메서드
```typescript
async getBuyableAmount(exchangeCode: ExchangeCode, stockCode: string, price: number): Promise<{ foreignCurrencyAvailable: number, maxQuantity: number }>
// GET /uapi/overseas-stock/v1/trading/inquire-psamount
// TR: TTTS3007R (실전) / VTTS3007R (모의)
// Params: CANO, ACNT_PRDT_CD, OVRS_EXCG_CD, OVRS_ORD_UNPR, ITEM_CD
// Response: output.ovrs_ord_psbl_amt, output.max_ord_psbl_qty
```

### 2-4. 지수 조회 (개선 E: 시장 상황)
**파일: `src/kis/kis-domestic.service.ts`** — 신규 메서드
```typescript
async getIndexPrice(indexCode: string): Promise<{ currentPrice: number, prevClose: number }>
// GET /uapi/domestic-stock/v1/quotations/inquire-index-price
// TR: FHPUP02100000 (실전만, 모의 미지원)
// Params: FID_COND_MRKT_DIV_CODE='U', FID_INPUT_ISCD='0001'(KOSPI) 등
// Response: output.bstp_nmix_prpr

async getIndexDailyPrices(indexCode: string, startDate: string, endDate: string): Promise<DailyPrice[]>
// GET /uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice
// TR: FHKUP03500100
// Params: FID_COND_MRKT_DIV_CODE='U', FID_INPUT_ISCD, FID_INPUT_DATE_1, FID_INPUT_DATE_2, FID_PERIOD_DIV_CODE='D'
// Response output2[]: { stck_bsop_date, bstp_nmix_prpr, bstp_nmix_oprc, bstp_nmix_hgpr, bstp_nmix_lwpr }
// 1회 호출에 최대 50건 → 200일 데이터는 4회 호출 필요
```

**해외 지수 조회:**
```typescript
// 해외주식 종목/지수/환율기간별시세
// GET /uapi/overseas-price/v1/quotations/inquire-daily-chartprice
// TR: FHKST03030100
// Params: FID_COND_MRKT_DIV_CODE='N'(해외지수), FID_INPUT_ISCD (예: SPX=S&P500, COMP=NASDAQ)
// FID_INPUT_DATE_1, FID_INPUT_DATE_2, FID_PERIOD_DIV_CODE='D'
// Response output2[]: { stck_bsop_date, ovrs_nmix_prpr, ovrs_nmix_oprc, ovrs_nmix_hgpr, ovrs_nmix_lwpr }
```

### 2-5. 금리 조회 (개선 E)
**파일: `src/kis/kis-domestic.service.ts`** — 신규 메서드
```typescript
async getInterestRates(): Promise<InterestRateItem[]>
// GET /uapi/domestic-stock/v1/quotations/comp-interest
// TR: FHPST07020000 (실전만)
// Params: FID_COND_MRKT_DIV_CODE='I', FID_COND_SCR_DIV_CODE='20702', FID_DIV_CLS_CODE='1'(해외금리), FID_DIV_CLS_CODE1=''(전체)
// Response output1[]: { hts_kor_isnm, bond_mnrt_prpr (현재금리), bond_mnrt_prdy_vrss (전일대비) }
```

### 2-6. 휴장일 조회
**파일: `src/kis/kis-domestic.service.ts`** — 신규 메서드
```typescript
async getHolidays(baseDate: string): Promise<HolidayItem[]>
// GET /uapi/domestic-stock/v1/quotations/chk-holiday
// TR: CTCA0903R (실전만)
// Params: BASS_DT=YYYYMMDD, CTX_AREA_NK='', CTX_AREA_FK=''
// ⚠️ 주의: 원장서비스 연관, 과도 호출 금지 → 일 1회만 호출 후 메모리 캐시
```

### 2-7. 미체결 주문 조회 및 취소 (개선 F)
**파일: `src/kis/kis-overseas.service.ts`** — 신규 메서드
```typescript
async getUnfilledOrders(): Promise<UnfilledOrder[]>
// GET /uapi/overseas-stock/v1/trading/inquire-nccs
// TR: TTTS3018R (실전) / VTTS3018R (모의)
// → 미체결 주문 목록 반환

async cancelOrder(exchangeCode: ExchangeCode, orderNo: string, stockCode: string, qty: number, price: number): Promise<OrderResult>
// POST /uapi/overseas-stock/v1/trading/order-rvsecncl
// TR: TTTT1004U (미국 정정/취소)
// → 지정된 주문 취소
```

**파일: `src/kis/kis-domestic.service.ts`** — 신규 메서드
```typescript
async getUnfilledOrders(): Promise<UnfilledOrder[]>
// GET /uapi/domestic-stock/v1/trading/inquire-psbl-rvsecncl
// TR: TTTC0084R (실전) / VTTC0084R (모의)

async cancelOrder(orderNo: string, stockCode: string, qty: number): Promise<OrderResult>
// POST /uapi/domestic-stock/v1/trading/order-rvsecncl
// TR: TTTC0013U (실전) / VTTC0013U (모의)
```

### 2-8. 해외 휴장일 조회
**파일: `src/kis/kis-overseas.service.ts`** — 신규 메서드
```typescript
async getOverseasHolidays(baseDate: string): Promise<HolidayItem[]>
// GET /uapi/overseas-stock/v1/quotations/countries-holiday
// TR: CTOS5011R
// → 해외 시장별 휴장일 반환
```

### 2-9. 타입 정의 추가
**파일: `src/kis/types/kis-api.types.ts`**
```typescript
interface DailyPrice {
  date: string;      // YYYYMMDD
  close: number;
  open: number;
  high: number;
  low: number;
  volume: number;
}

interface InterestRateItem {
  name: string;
  rate: number;
  change: number;
}

interface HolidayItem {
  date: string;
  name: string;
  isOpen: boolean;
}

interface UnfilledOrder {
  orderNo: string;
  stockCode: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  exchangeCode?: string;
}

type OverseasOrderDivision = '00' | '32' | '33' | '34';
```

---

## Phase 3: 전략 인터페이스 확장

**파일: `src/trading/strategy/strategy.interface.ts`**

### 3-1. TradingSignal에 orderDivision 추가
```typescript
export interface TradingSignal {
  // ... 기존 필드 ...
  orderDivision?: string;
}
```

### 3-2. 종목별 전략 인터페이스 (시장 상황 컨텍스트 포함)
```typescript
export interface WatchStockConfig {
  id: string;
  market: 'DOMESTIC' | 'OVERSEAS';
  exchangeCode?: string;
  stockCode: string;
  stockName: string;
  strategyName?: string;
  quota?: number;
  cycle: number;
  maxCycles: number;
  stopLossRate: number;
  maxPortfolioRate: number;
}

export interface MarketCondition {
  referenceIndexAboveMA200: boolean;   // 해당 시장 참조 지수가 200일선 위?
  referenceIndexName: string;          // KOSPI, S&P500, 항셍 등
  interestRateRising: boolean;         // 금리 급등?
  interestRate?: number;               // 현재 기준금리
}

export interface StockIndicators {
  ma200?: number;                 // 200일 이동평균
  rsi14?: number;                 // 14일 RSI
  currentAboveMA200: boolean;     // 현재가 > MA200?
}

export interface StockStrategyContext {
  watchStock: WatchStockConfig;
  price: StockPriceResult;
  position?: {
    stockCode: string;
    quantity: number;
    avgPrice: number;
    currentPrice: number;
    totalInvested: number;
  };
  alreadyExecutedToday: boolean;
  marketCondition: MarketCondition;        // 개선 E
  stockIndicators: StockIndicators;        // 개선 C
  buyableAmount: number;                   // 개선 D: 가용 현금/외화
  totalPortfolioValue: number;             // 개선 D: 전체 포트폴리오 가치
}

export interface PerStockTradingStrategy {
  name: string;
  evaluateStock(context: StockStrategyContext): Promise<TradingSignal[]>;
}
```

---

## Phase 4: MarketAnalysisService 신규

**신규 파일: `src/trading/market-analysis.service.ts`**

### 역할
- KIS API로 일별 시세/지수/금리 데이터 조회
- MA200, RSI 계산
- 시장 상황 평가
- 데이터 캐싱 (1일 1회 갱신)

### 주요 메서드
```typescript
@Injectable()
export class MarketAnalysisService {
  // --- 기술 지표 계산 ---
  async getStockIndicators(market: Market, exchangeCode: string, stockCode: string): Promise<StockIndicators>
  // → getDailyPrices(200일치) → calculateMA200() + calculateRSI14()

  // --- 시장 상황 ---
  async getMarketCondition(exchangeCode: string): Promise<MarketCondition>
  // → 해당 거래소의 참조지수 200일 데이터 + 금리 → 종합 판단

  // --- 내부 계산 ---
  private calculateMA(prices: number[], period: number): number
  private calculateRSI(prices: number[], period: number): number

  // --- 캐싱 ---
  // 일별 시세 데이터는 하루 1번만 변하므로 메모리 캐시 (Map + TTL 24h)
  private cache: Map<string, { data: any, expiry: Date }>
}
```

### MA200 계산
```
200일치 종가 가져와서: MA200 = sum(close[0..199]) / 200
API 호출: 해외 HHDFS76240000 (100건/호출 × 2회), 국내 FHKST03010100 (100건/호출 × 2회)
```

### RSI14 계산
```
14일간 상승/하락 폭 기반:
gains = 상승일의 변동폭 평균
losses = 하락일의 변동폭 평균
RS = gains / losses
RSI = 100 - (100 / (1 + RS))
```

### 시장별 참조 지수 매핑
```typescript
// src/kis/types/kis-config.types.ts 에 추가
const EXCHANGE_REFERENCE_INDEX: Record<ExchangeCode, { code: string, name: string, type: 'domestic' | 'overseas' }> = {
  KRX:  { code: '0001', name: 'KOSPI', type: 'domestic' },
  NASD: { code: 'SPX',  name: 'S&P500', type: 'overseas' },
  NYSE: { code: 'SPX',  name: 'S&P500', type: 'overseas' },
  AMEX: { code: 'SPX',  name: 'S&P500', type: 'overseas' },
  SEHK: { code: 'HSI',  name: '항셍지수', type: 'overseas' },
  TKSE: { code: 'N225', name: '닛케이225', type: 'overseas' },
  SHAA: { code: 'SHCOMP', name: '상해종합', type: 'overseas' },
  SZAA: { code: 'SHCOMP', name: '상해종합', type: 'overseas' },
  HASE: { code: 'VNINDEX', name: 'VN지수', type: 'overseas' },
  VNSE: { code: 'VNINDEX', name: 'VN지수', type: 'overseas' },
};
```

### 시장 상황 판단 기준 (개선 E)
```
referenceIndexAboveMA200:  해당 거래소의 참조 지수 현재값 > MA200
  - KRX → KOSPI 200일선 (국내업종기간별시세 FHKUP03500100)
  - NASD/NYSE/AMEX → S&P500 200일선 (해외지수기간별시세 FHKST03030100, FID_COND_MRKT_DIV_CODE='N')
  - SEHK → 항셍지수 200일선
  - TKSE → 닛케이225 200일선
  - etc.
interestRateRising:  기준금리 전일대비 > 0.1%p (급등 판단)
```

---

## Phase 5: InfiniteBuyStrategy 구현 (A~E 모두 포함)

**신규 파일: `src/trading/strategy/infinite-buy.strategy.ts`**

### 핵심 알고리즘 (개선사항 반영)

```
evaluateStock(ctx):
  1. 오늘 이미 실행했으면 → skip
  2. quota 미설정이면 → skip

  ── 개선 F: 미체결 주문은 스케줄러에서 전략 실행 전에 처리 (Phase 7 참조) ──

  ── 개선 E: 시장 상황 필터 ──
  3. 참조 지수(시장별) 200일선 아래? → 신규 매수 중단 (매도만 허용)
  4. 금리 급등? → quota를 50%로 줄임

  ── 개선 C: 종목 선별 필터 ──
  5. 포지션 없음 (신규 진입) + 현재가 < MA200? → 매수 거부 (하락 추세)
  6. RSI < 30 (과매도)? → quota를 1.5배로 강화 (공격적 매수)

  ── 기본 무한매수법 ──
  7. T = totalInvested / quota
  8. T >= maxCycles → skip

  ── 개선 A: 손절 ──
  9. curPrice < avgPrice × (1 - stopLossRate) → 전량 매도 시그널

  ── 개선 D: 자본 관리 ──
  10. 종목 투자금 / 전체 포트폴리오 > maxPortfolioRate? → 매수 중단
  11. 가용 현금 < quota? → 매수 스킵 (현금 부족)

  ── 매수/매도 시그널 생성 ──
  12. 첫 매수 (포지션 없음): floor(adjustedQuota / curPrice)주 LOC
  13. T < 20: Buy1 + Buy2 + Sell1 + Sell2
  14. T >= 20: Buy2만 + Sell1 + Sell2
```

### 매수 가격/수량 (기존 무한매수법)
```
baseRate = (10 - T/2 + 100) / 100
pivotPrice = baseRate × avgPrice

[T < 20]
  buy1Price = min(curPrice × 1.2, avgPrice)
  buy2Price = pivotPrice - 0.01
  buy1Qty, buy2Qty = alternating fill within adjustedQuota

[T >= 20]
  buy2Price = min(pivotPrice - 0.1, curPrice × 1.2)
  buy2Qty = floor(adjustedQuota / buy2Price)
```

### 매도 가격/수량 — 개선 B: 동적 목표
```
sell1Price = pivotPrice, sell1Qty = round(holdQty / 4), LOC
sell2 (T 레벨별):
  T < 10:  avgPrice × 1.05
  T 10~20: avgPrice × 1.10
  T >= 20: avgPrice × 1.15
sell2Qty = holdQty - sell1Qty
```

### Quota 조정 로직
```
adjustedQuota = quota
if (interestRateRising) adjustedQuota *= 0.5    // 개선 E: 금리 급등시 절반
if (rsi14 < 30)        adjustedQuota *= 1.5    // 개선 C: 과매도시 강화
adjustedQuota = min(adjustedQuota, buyableAmount)  // 개선 D: 가용자금 한도
```

### LOC 폴백
- 미국(NASD/NYSE/AMEX)만 LOC (`'34'`), 기타 거래소는 지정가(`'00'`)
- 모의투자에서 LOC 미지원 시 지정가로 폴백

### 가격 반올림
- 해외(USD): 소수점 2자리, 국내(KRW): 정수

---

## Phase 6: TradingService 확장

**파일: `src/trading/trading.service.ts`**

### 6-1. executeSignal() 수정
- `signal.orderDivision`을 KIS 서비스에 전달
- `OrderType` 결정: `orderDivision === '34'` → `LOC`

### 6-2. executePerStockStrategy() 신규
- `PerStockTradingStrategy` + `StockStrategyContext[]` → 종목별 실행
- 실행 후 `StrategyExecution` 테이블에 기록 (details에 JSON으로 필터 결과 포함)

### 6-3. syncPositions() 수정
- `totalInvested` 계산 및 DB 저장

---

## Phase 7: 스케줄러 재구성 — Cron 기반 하루 1회

**파일: `src/trading/trading.scheduler.ts`**

### Cron 스케줄
```
미국 시장: @Cron('0 30 5 * * 1-6')  (KST 05:30, 장 마감 30분 전)
국내 시장: @Cron('0 0 15 * * 1-5')  (KST 15:00, 장 마감 30분 전)
환경변수로 오버라이드 가능 (US_MARKET_CRON, KR_MARKET_CRON)
```

### 실행 흐름
```
executeInfiniteBuyOverseas()  ← @Cron
├─ 휴장일 체크 (국내: CTCA0903R, 해외: CTOS5011R, 캐시됨)
├─ ★ 미체결 주문 정리 (개선 F)
│   ├─ getUnfilledOrders()
│   └─ 전일 무한매수법 미체결 주문 자동 취소 (cancelOrder)
├─ watchStocks 조회 (strategyName === 'infinite-buy', market === OVERSEAS)
├─ 가격 조회 + 잔고 동기화
├─ MarketAnalysisService.getMarketCondition(exchangeCode)  // 시장별 참조 지수
├─ 종목별:
│   ├─ MarketAnalysisService.getStockIndicators(stock)
│   ├─ KisOverseasService.getBuyableAmount(stock)
│   └─ buildStockContext()
└─ executePerStockStrategy(infiniteBuyStrategy, contexts)

executeInfiniteBuyDomestic()  ← @Cron
└─ 동일 패턴 (market === DOMESTIC, 국내 미체결 API 사용)
```

### 중복 실행 방지
- `StrategyExecution` unique 제약으로 하루 1회 보장
- `alreadyExecutedToday` 플래그로 전략에서 skip

---

## Phase 8: GraphQL API 확장

### 8-1. WatchStock 타입/인풋 확장
- `strategyName`, `quota`, `cycle`, `maxCycles`, `stopLossRate`, `maxPortfolioRate` 추가

### 8-2. 전략 실행 이력 조회
- `StrategyExecutionType` + `strategyExecutions(stockCode?, strategyName?, limit?)` 쿼리

### 8-3. Position에 totalInvested 노출

### 8-4. 시장 상황 조회 (선택)
- `marketCondition` 쿼리: 현재 시장 상황 + 지수 200일선 상태

---

## 파일 변경 요약

### 수정 (13개)
| 파일 | 변경 내용 |
|------|----------|
| `prisma/schema.prisma` | OrderType.LOC, WatchStock 전략필드+maxPortfolioRate, Position.totalInvested, StrategyExecution |
| `src/kis/types/kis-api.types.ts` | DailyPrice, InterestRateItem, HolidayItem, UnfilledOrder, OverseasOrderDivision 타입 |
| `src/kis/types/kis-config.types.ts` | EXCHANGE_REFERENCE_INDEX 매핑 추가 |
| `src/kis/kis-overseas.service.ts` | orderDivision, getDailyPrices(), getBuyableAmount(), getUnfilledOrders(), cancelOrder(), getOverseasHolidays() |
| `src/kis/kis-domestic.service.ts` | orderDivision, getDailyPrices(), getBuyableAmount(), getIndexPrice(), getIndexDailyPrices(), getInterestRates(), getHolidays(), getUnfilledOrders(), cancelOrder() |
| `src/trading/strategy/strategy.interface.ts` | orderDivision, PerStockTradingStrategy, StockStrategyContext, MarketCondition, StockIndicators |
| `src/trading/trading.service.ts` | executeSignal LOC, executePerStockStrategy, syncPositions totalInvested |
| `src/trading/trading.scheduler.ts` | Cron 기반 무한매수법 실행, 휴장일 체크 |
| `src/trading/trading.module.ts` | MarketAnalysisService, InfiniteBuyStrategy 등록 |
| `src/watch-stock/watch-stock.service.ts` | 전략 설정 필드 CRUD |
| `src/watch-stock/watch-stock.resolver.ts` | GraphQL 타입/인풋에 전략 필드 |
| `src/trade-record/trade-record.service.ts` | findStrategyExecutions |
| `src/trade-record/trade-record.resolver.ts` | StrategyExecutionType, PositionType.totalInvested |

### 신규 (2개)
| 파일 | 목적 |
|------|------|
| `src/trading/strategy/infinite-buy.strategy.ts` | 무한매수법 핵심 알고리즘 (~250줄) |
| `src/trading/market-analysis.service.ts` | MA200/RSI 계산, 시장 상황 평가, 데이터 캐싱 (~200줄) |

---

## 구현 순서

1. Phase 1: Prisma 스키마 → `npx prisma migrate dev --name add-infinite-buy-strategy`
2. Phase 2: KIS API 확장 (타입 → 해외 서비스 → 국내 서비스)
3. Phase 3: 전략 인터페이스
4. Phase 4: MarketAnalysisService
5. Phase 5: InfiniteBuyStrategy — 핵심
6. Phase 6: TradingService
7. Phase 7: Scheduler (Cron)
8. Phase 8: GraphQL
9. `npm run build` 확인

---

## 검증 방법

1. **빌드**: `npm run build` 에러 없이 통과
2. **마이그레이션**: `npx prisma migrate dev` 정상 실행
3. **GraphQL**: Playground에서 전략 설정 포함 watchStock CRUD
   ```graphql
   mutation {
     createWatchStock(input: {
       market: OVERSEAS, exchangeCode: "NASD", stockCode: "SOXL", stockName: "SOXL"
       strategyName: "infinite-buy", quota: 200, maxCycles: 40, stopLossRate: 0.3, maxPortfolioRate: 0.2
     }) { id strategyName quota }
   }
   ```
4. **전략 실행 이력**: `strategyExecutions` 쿼리 동작 확인
5. **스케줄러 로그**: Cron 시간에 실행 확인 (미국장 KST 05:30, 한국장 KST 15:00)
6. **중복 방지**: 서버 재시작 후 재실행해도 skip 확인
7. **필터 동작**: 로그에서 MA200/RSI/시장상황 필터 결과 확인 (details JSON)
