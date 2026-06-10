# 국내 데이트레이드 후보 스크리닝 파이프라인 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 매 거래일 08:30 KST에 전일 확정 일봉 기준으로 거래세 면제 ETF를 필터/점수화해 `DayTradeCandidate`로 저장하고, 상위 후보를 momentum-breakout 시뮬레이션 세션에 자동 투입 + Slack 리포트. 기존 스크리닝의 momentum-breakout 추천 게이트를 백테스트 결론에 맞게 강화.

**Architecture:** `src/screening/` 모듈에 순수 함수(`day-trade-selector.ts`)와 오케스트레이션 서비스(`day-trade-screening.service.ts`)를 신설하고 기존 `ScreeningScheduler`에 cron을 추가한다. ScreeningModule이 SimulationModule을 import해 `SimulationSessionManager.createSession`으로 세션을 만든다(순환 없음 — 사전 확인됨). 스펙: `docs/superpowers/specs/2026-06-10-day-trade-screening-design.md`

**Tech Stack:** NestJS + Prisma(PostgreSQL) + KIS OpenAPI + Slack Bolt + Jest

**스펙 대비 의도적 결정 2가지** (구현 중 재논의 금지, 근거 포함):
1. `screeningDate`는 `YYYYMMDD` 포맷 — 스펙 문서엔 YYYY-MM-DD로 표기했지만, 기존 `kstTodayStr()`/`StockRecommendation.screeningDate`가 YYYYMMDD라 일관성을 우선한다.
2. momentum-breakout 게이트에 `market === 'DOMESTIC'` 조건 추가 — 전략 자체가 국내 전용(`국내전용` 태그)인데 해외 추천 컨텍스트에서도 게이트가 호출되므로 명시적으로 차단한다.

**전제 조건**: 로컬 PostgreSQL 기동 + `.env.dev` 존재 (`npm run prisma:migrate`가 `.env.dev`를 source함)

---

## 사전 확인된 코드베이스 사실 (탐색 불필요)

- `KisDomesticService.getDailyPrices(stockCode, startDate, endDate)` → `DailyPrice[]` **최신순**(index 0 = 최신), `FID_ORG_ADJ_PRC: '0'` 수정주가, close 0인 봉은 이미 필터됨. 날짜 포맷 YYYYMMDD (`src/kis/kis-domestic.service.ts:160`)
- `DailyPrice = { date, close, open, high, low, volume }` (`src/kis/types/kis-api.types.ts:244`)
- `KisDomesticService.getPrice(stockCode)` → `StockPriceResult` (`investCautionYn?`, `shortOverheatYn?`, `marketWarnCode?`, `stockName` 포함)
- `getVolumeRanking()` / `getFluctuationRanking()` → `any[]`, 행 필드: `mksc_shrn_iscd`(코드), `hts_kor_isnm`(이름), `stck_prpr`(가격)
- `detectEtf(stockName, stockCode?)`는 `src/screening/types/screening.type.ts`에 export, `./types` index로 re-export됨. **ETN/스팩도 true로 판별**하므로 strict 필터가 따로 필요
- `SimulationSessionManager.createSession(input: CreateSimulationInput)` — `strategyParams`는 **JSON string**, `quota`가 `currentCash` 초기값이 됨. `SimulationModule`이 export 중 (`src/simulation/simulation.module.ts:28`)
- `SimulationSessionManager.updateStatus(id, SimulationStatus.COMPLETED)` — `stoppedAt` 자동 세팅
- `SimulationSession.strategyParams`는 `Json?` — Prisma JSON path 필터 `{ path: ['dayTradeAuto'], equals: true }` 사용 가능 (PostgreSQL)
- `SimulationPosition.quantity: Int` — 열린 포지션 판정은 `quantity > 0`
- `ScreeningScheduler`의 run-log 패턴: `recordSchedulerRun(jobKey, { status, date, count?, message? })`, 뮤텍스 `isFastRunning`/`isDeepRunning`, 국가 토글 `getEnabledCountries()`
- `kstTodayStr()` → `'YYYYMMDD'`, `kstDateNDaysAgo(n)` → `'YYYYMMDD'` (`src/screening/utils/date.util.ts`)
- SlackService 내부 멤버: `ensureConnected()`, `this.app!.client.chat.postMessage`, `this.channel`, `handleSendError(e)`, `KnownBlock` import 이미 있음 (`sendScreeningResult` 참조, `src/notification/slack.service.ts:320`)
- 기존 `strategy-matcher.spec.ts`의 2개 테스트(92행 `recommends only strategies...`, 257행 `sorts recommendations...`)가 momentum-breakout 추천을 전제 → 게이트 강화 시 ETF 컨텍스트로 수정 필요
- 테스트: `npx jest <경로>`, 빌드: `npm run build`

---

### Task 1: Prisma `DayTradeCandidate` 모델 + 마이그레이션

**Files:**
- Modify: `prisma/schema.prisma` (StockDeepAnalysis 모델 뒤, ~218행)

- [ ] **Step 1: 모델 추가**

`model StockDeepAnalysis` 블록 끝(`@@map("stock_deep_analyses")` 다음 `}` 뒤)에 추가:

```prisma
model DayTradeCandidate {
  id                  String   @id @default(uuid())
  screeningDate       String   @map("screening_date") // YYYYMMDD (kstTodayStr 포맷)
  market              Market
  exchangeCode        String   @map("exchange_code")
  stockCode           String   @map("stock_code")
  stockName           String   @map("stock_name")
  rank                Int // 통과 후보 1부터, 탈락 0
  score               Decimal  @db.Decimal(6, 2)
  prevRangePct        Decimal  @map("prev_range_pct") @db.Decimal(8, 4)
  atrPct              Decimal  @map("atr_pct") @db.Decimal(8, 4)
  avgTradeValue20d    BigInt   @map("avg_trade_value_20d")
  aboveMa20           Boolean  @map("above_ma20")
  excluded            Boolean  @default(false)
  excludeReason       String?  @map("exclude_reason")
  simulationSessionId String?  @map("simulation_session_id")
  indicators          Json
  createdAt           DateTime @default(now()) @map("created_at")

  @@unique([screeningDate, market, stockCode])
  @@index([screeningDate, market])
  @@map("day_trade_candidates")
}
```

- [ ] **Step 2: 마이그레이션 생성**

Run: `npm run prisma:migrate -- --name add_day_trade_candidate`
Expected: `migrations/<timestamp>_add_day_trade_candidate/` 생성, "Your database is now in sync"

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 에러 없음 (Prisma client 재생성 포함)

- [ ] **Step 4: Commit**

```bash
git add prisma/
git commit -m "feat: add DayTradeCandidate model for day-trade screening

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 데이트레이드 타입 파일

**Files:**
- Create: `src/screening/types/day-trade.type.ts`
- Modify: `src/screening/types/index.ts`

- [ ] **Step 1: 타입 파일 생성**

`src/screening/types/day-trade.type.ts`:

```typescript
/** 데이트레이드(당일청산) 후보 지표 스냅샷 — 전일 확정 일봉 기준 */
export interface DayTradeIndicatorSnapshot {
  prevDate: string; // 전일 일봉 날짜 (YYYYMMDD)
  prevClose: number;
  prevRangePct: number; // 전일 (고가-저가)/종가 × 100
  atrPct: number; // ATR14 / 전일 종가 × 100
  ma20: number;
  aboveMa20: boolean; // 전일 종가 > MA20
  avgTradeValue20d: number; // 20일 평균 거래대금(원) — 종가×거래량 근사
}

/** getPrice에서 가져오는 당일 적용 유의/경고 상태 */
export interface DayTradeCautionFlags {
  investCautionYn?: boolean;
  shortOverheatYn?: boolean;
  marketWarnCode?: string;
}

export interface DayTradeCandidateScore {
  stockCode: string;
  stockName: string;
  exchangeCode: 'KRX';
  market: 'DOMESTIC';
  score: number;
  rank: number; // 통과 후보 1부터, 탈락은 0
  excluded: boolean;
  excludeReason?: string;
  indicators: DayTradeIndicatorSnapshot;
}

export interface DayTradeRunResult {
  skipped: boolean;
  skipReason?: string;
  saved: number;
  simulated: number;
  topStockName?: string;
}

/** AppSetting 'day-trade-screening' 키 값 */
export interface DayTradeScreeningSettings {
  enabled: boolean;
  topN: number;
  simCapital: number;
}
```

- [ ] **Step 2: index 재export 추가**

`src/screening/types/index.ts`에 한 줄 추가:

```typescript
export * from './day-trade.type';
```

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 에러 없음

(커밋은 Task 3에서 selector와 함께)

---

### Task 3: `day-trade-selector.ts` 순수 함수 (TDD)

**Files:**
- Create: `src/screening/day-trade-selector.spec.ts`
- Create: `src/screening/day-trade-selector.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/screening/day-trade-selector.spec.ts`:

```typescript
import { DailyPrice } from '../kis/types/kis-api.types';
import {
  buildDayTradeScore,
  computeDayTradeIndicators,
  isStrictKrxEtf,
  rankDayTradeCandidates,
} from './day-trade-selector';
import { DayTradeCandidateScore, DayTradeIndicatorSnapshot } from './types';

const TODAY = '20260611';

/** 최신순(index 0 = 최신) 봉 생성. overrides[i]는 i번째(최신부터) 봉을 덮어쓴다 */
function makeBars(
  count: number,
  overrides: Record<number, Partial<DailyPrice>> = {},
): DailyPrice[] {
  return Array.from({ length: count }, (_, i) => ({
    date: String(20260610 - i), // 단순 감소 날짜 (TODAY와 겹치지 않음)
    close: 100,
    open: 100,
    high: 102,
    low: 98,
    volume: 600_000_000,
    ...overrides[i],
  }));
}

function makeSnapshot(overrides: Partial<DayTradeIndicatorSnapshot> = {}): DayTradeIndicatorSnapshot {
  return {
    prevDate: '20260610',
    prevClose: 100,
    prevRangePct: 4,
    atrPct: 2.5,
    ma20: 99,
    aboveMa20: true,
    avgTradeValue20d: 300_000_000_000, // 3000억
    ...overrides,
  };
}

describe('isStrictKrxEtf', () => {
  it('국내 레버리지/인버스 ETF를 통과시킨다', () => {
    expect(isStrictKrxEtf('KODEX 레버리지', '122630')).toBe(true);
    expect(isStrictKrxEtf('TIGER 200선물인버스2X', '252710')).toBe(true);
  });

  it('일반 주식을 거른다', () => {
    expect(isStrictKrxEtf('삼성전자', '005930')).toBe(false);
  });

  it('ETN을 코드/이름 양쪽에서 거른다', () => {
    expect(isStrictKrxEtf('신한 레버리지 WTI원유 선물 ETN', '500031')).toBe(false); // 이름에 ETN
    expect(isStrictKrxEtf('미래에셋 레버리지 ETN(H)', 'Q500001')).toBe(false); // 문자 포함 코드
  });

  it('스팩을 거른다', () => {
    expect(isStrictKrxEtf('삼성스팩8호', '448740')).toBe(false);
  });
});

describe('computeDayTradeIndicators', () => {
  it('확정 봉 20개 미만이면 undefined를 반환한다', () => {
    expect(computeDayTradeIndicators(makeBars(19), TODAY)).toBeUndefined();
  });

  it('동일 봉 20개에서 MA20/ATR/변동폭을 계산한다', () => {
    const result = computeDayTradeIndicators(makeBars(25), TODAY)!;
    expect(result.prevDate).toBe('20260610');
    expect(result.prevClose).toBe(100);
    expect(result.ma20).toBe(100);
    expect(result.aboveMa20).toBe(false); // 100 > 100은 false
    expect(result.prevRangePct).toBeCloseTo(4, 6); // (102-98)/100
    expect(result.atrPct).toBeCloseTo(4, 6); // TR 전부 4
    expect(result.avgTradeValue20d).toBeCloseTo(60_000_000_000, 0); // 100 × 6억주
  });

  it('최신 봉이 상승하면 aboveMa20이 true가 된다', () => {
    const bars = makeBars(25, { 0: { close: 110, high: 112, low: 108 } });
    const result = computeDayTradeIndicators(bars, TODAY)!;
    expect(result.ma20).toBeCloseTo((110 + 19 * 100) / 20, 6);
    expect(result.aboveMa20).toBe(true);
    // TR0 = max(112-108, |112-100|, |108-100|) = 12, 나머지 13개 = 4
    expect(result.atrPct).toBeCloseTo(((12 + 13 * 4) / 14 / 110) * 100, 6);
  });

  it('당일 봉이 섞여 있으면 제외하고 계산한다 (전일 확정 보장)', () => {
    const withToday = [
      { date: TODAY, close: 999, open: 999, high: 999, low: 999, volume: 1 },
      ...makeBars(25),
    ];
    expect(computeDayTradeIndicators(withToday, TODAY)).toEqual(
      computeDayTradeIndicators(makeBars(25), TODAY),
    );
  });
});

describe('buildDayTradeScore', () => {
  it('모든 하드 필터를 통과하면 점수를 계산한다', () => {
    // atrPct 2.5 → 변동성 (2.5/5)×60 = 30, 거래대금 3000억 → log 중간점 ×40 = 20
    const result = buildDayTradeScore('122630', 'KODEX 레버리지', makeSnapshot(), {});
    expect(result.excluded).toBe(false);
    expect(result.score).toBeCloseTo(50, 1);
  });

  it('투자유의 지정이면 제외한다', () => {
    const result = buildDayTradeScore('122630', 'KODEX 레버리지', makeSnapshot(), {
      investCautionYn: true,
    });
    expect(result.excluded).toBe(true);
    expect(result.excludeReason).toBe('투자유의 지정');
  });

  it('시장경고 코드가 00이 아니면 제외한다', () => {
    const result = buildDayTradeScore('122630', 'KODEX 레버리지', makeSnapshot(), {
      marketWarnCode: '01',
    });
    expect(result.excluded).toBe(true);
  });

  it('평균 거래대금 300억 미만이면 제외한다', () => {
    const result = buildDayTradeScore(
      '122630', 'KODEX 레버리지',
      makeSnapshot({ avgTradeValue20d: 29_999_999_999 }), {},
    );
    expect(result.excludeReason).toBe('평균 거래대금 미달');
  });

  it('MA20 아래면 제외한다', () => {
    const result = buildDayTradeScore(
      '122630', 'KODEX 레버리지', makeSnapshot({ aboveMa20: false }), {},
    );
    expect(result.excludeReason).toBe('MA20 아래 (레짐 부적합)');
  });

  it('ATR 1.2% 미만이면 제외한다', () => {
    const result = buildDayTradeScore(
      '122630', 'KODEX 레버리지', makeSnapshot({ atrPct: 1.19 }), {},
    );
    expect(result.excludeReason).toBe('변동폭(ATR) 미달');
  });
});

describe('rankDayTradeCandidates', () => {
  function score(code: string, value: number, excluded = false): DayTradeCandidateScore {
    return {
      stockCode: code,
      stockName: code,
      exchangeCode: 'KRX',
      market: 'DOMESTIC',
      score: value,
      rank: 0,
      excluded,
      indicators: makeSnapshot(),
    };
  }

  it('통과 후보를 점수 내림차순으로 rank 부여하고 탈락은 rank 0으로 뒤에 둔다', () => {
    const ranked = rankDayTradeCandidates([
      score('A', 30),
      score('B', 70),
      score('C', 0, true),
      score('D', 50),
    ]);
    expect(ranked.map((r) => r.stockCode)).toEqual(['B', 'D', 'A', 'C']);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3, 0]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest src/screening/day-trade-selector.spec.ts`
Expected: FAIL — `Cannot find module './day-trade-selector'`

- [ ] **Step 3: 구현**

`src/screening/day-trade-selector.ts`:

```typescript
import { DailyPrice } from '../kis/types/kis-api.types';
import { detectEtf } from './types';
import {
  DayTradeCandidateScore,
  DayTradeCautionFlags,
  DayTradeIndicatorSnapshot,
} from './types/day-trade.type';

/**
 * 데이트레이드(당일청산) 후보 선정 기준.
 * 근거: momentum-breakout 백테스트(2023-06~2026-05) — 거래세 면제 ETF + MA20 위
 * 레짐에서만 양의 기대값. 임계값 근거는 src/screening/CLAUDE.md 참조.
 * strategy-matcher의 momentum-breakout 추천 게이트와 상수를 공유한다.
 */
export const DAY_TRADE_MIN_AVG_TRADE_VALUE = 30_000_000_000; // 300억
export const DAY_TRADE_MIN_ATR_PCT = 1.2; // 왕복 비용(~0.3%) 대비 4배
const SCORE_ATR_FULL_MARK_PCT = 5; // ATR 5% 이상이면 변동성 만점
const SCORE_TRADE_VALUE_FULL_MARK = 3_000_000_000_000; // 3조 이상이면 유동성 만점
const VOLATILITY_WEIGHT = 0.6;
const LIQUIDITY_WEIGHT = 0.4;

/** 핵심 고변동성 ETF 시드 — 랭킹 API가 놓치거나 빈 응답이어도 항상 평가. 운영하며 보강 */
export const DAY_TRADE_SEED_ETFS: ReadonlyArray<{ stockCode: string; stockName: string }> = [
  { stockCode: '122630', stockName: 'KODEX 레버리지' },
  { stockCode: '252670', stockName: 'KODEX 200선물인버스2X' },
  { stockCode: '233740', stockName: 'KODEX 코스닥150레버리지' },
  { stockCode: '251340', stockName: 'KODEX 코스닥150선물인버스' },
  { stockCode: '114800', stockName: 'KODEX 인버스' },
  { stockCode: '069500', stockName: 'KODEX 200' },
  { stockCode: '229200', stockName: 'KODEX 코스닥150' },
];

/**
 * 거래세 면제 + LP 호가가 보장되는 순수 KRX ETF만 통과.
 * detectEtf는 ETN/스팩도 true이므로 별도로 거른다 — ETN은 발행사 신용 리스크,
 * 스팩은 유동성 구조가 달라 당일청산 시장가 전략에 부적합.
 */
export function isStrictKrxEtf(stockName: string, stockCode: string): boolean {
  if (!/^\d{6}$/.test(stockCode)) return false; // ETN(Q500001)/액티브펀드(0162Y0) 등 문자 포함 코드
  const upper = stockName.toUpperCase();
  if (upper.includes('ETN') || stockName.includes('스팩')) return false;
  return detectEtf(stockName, stockCode);
}

/**
 * 전일 확정 일봉 기준 지표 계산.
 * @param prices KIS getDailyPrices 결과 (최신순, index 0 = 최신)
 * @param todayStr 오늘(YYYYMMDD) — 당일 봉이 섞여 있으면 제외해 전일 확정 데이터를 보장
 * @returns 확정 봉 20개 미만이면 undefined
 */
export function computeDayTradeIndicators(
  prices: DailyPrice[],
  todayStr: string,
): DayTradeIndicatorSnapshot | undefined {
  const bars = prices.filter((p) => p.date !== todayStr && p.close > 0);
  if (bars.length < 20) return undefined;

  const prev = bars[0];
  const ma20 = bars.slice(0, 20).reduce((sum, b) => sum + b.close, 0) / 20;

  let trSum = 0;
  for (let i = 0; i < 14; i++) {
    const cur = bars[i];
    const prevClose = bars[i + 1].close;
    trSum += Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prevClose),
      Math.abs(cur.low - prevClose),
    );
  }
  const atrPct = (trSum / 14 / prev.close) * 100;

  // 거래대금 근사: 종가×거래량 (KIS 일봉 응답에 거래대금 필드가 없음)
  const avgTradeValue20d =
    bars.slice(0, 20).reduce((sum, b) => sum + b.close * b.volume, 0) / 20;

  return {
    prevDate: prev.date,
    prevClose: prev.close,
    prevRangePct: ((prev.high - prev.low) / prev.close) * 100,
    atrPct,
    ma20,
    aboveMa20: prev.close > ma20,
    avgTradeValue20d,
  };
}

function resolveExcludeReason(
  indicators: DayTradeIndicatorSnapshot,
  caution: DayTradeCautionFlags,
): string | undefined {
  if (caution.investCautionYn) return '투자유의 지정';
  if (caution.shortOverheatYn) return '단기과열 지정';
  if (caution.marketWarnCode && caution.marketWarnCode !== '00') {
    return `시장경고(${caution.marketWarnCode})`;
  }
  if (indicators.avgTradeValue20d < DAY_TRADE_MIN_AVG_TRADE_VALUE) return '평균 거래대금 미달';
  if (!indicators.aboveMa20) return 'MA20 아래 (레짐 부적합)';
  if (indicators.atrPct < DAY_TRADE_MIN_ATR_PCT) return '변동폭(ATR) 미달';
  return undefined;
}

/** 하드 필터 적용 후 통과 시 절대 점수(0~100) 계산 — 날짜 간 비교 가능하도록 코호트 비의존 */
export function buildDayTradeScore(
  stockCode: string,
  stockName: string,
  indicators: DayTradeIndicatorSnapshot,
  caution: DayTradeCautionFlags,
): DayTradeCandidateScore {
  const base = {
    stockCode,
    stockName,
    exchangeCode: 'KRX' as const,
    market: 'DOMESTIC' as const,
    rank: 0,
    indicators,
  };

  const excludeReason = resolveExcludeReason(indicators, caution);
  if (excludeReason) {
    return { ...base, score: 0, excluded: true, excludeReason };
  }

  const volNorm = Math.min(indicators.atrPct / SCORE_ATR_FULL_MARK_PCT, 1);
  const liqLogMin = Math.log10(DAY_TRADE_MIN_AVG_TRADE_VALUE);
  const liqLogMax = Math.log10(SCORE_TRADE_VALUE_FULL_MARK);
  const liqNorm = Math.min(
    Math.max((Math.log10(indicators.avgTradeValue20d) - liqLogMin) / (liqLogMax - liqLogMin), 0),
    1,
  );
  const score =
    Math.round((volNorm * VOLATILITY_WEIGHT + liqNorm * LIQUIDITY_WEIGHT) * 100 * 100) / 100;

  return { ...base, score, excluded: false };
}

/** 통과 후보 점수 내림차순 rank(1부터), 탈락(rank 0)은 뒤에 붙인다 */
export function rankDayTradeCandidates(
  scores: DayTradeCandidateScore[],
): DayTradeCandidateScore[] {
  const passing = scores
    .filter((s) => !s.excluded)
    .sort((a, b) => b.score - a.score)
    .map((s, i) => ({ ...s, rank: i + 1 }));
  const excluded = scores.filter((s) => s.excluded);
  return [...passing, ...excluded];
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest src/screening/day-trade-selector.spec.ts`
Expected: PASS (전체)

- [ ] **Step 5: Commit**

```bash
git add src/screening/types/ src/screening/day-trade-selector.ts src/screening/day-trade-selector.spec.ts
git commit -m "feat: add day-trade candidate selector with ETF filters

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: strategy-matcher momentum-breakout 게이트 (TDD)

**Files:**
- Modify: `src/screening/strategy-matcher.ts:34-35` (게이트 함수)
- Modify: `src/screening/strategy-matcher.spec.ts` (기존 2개 테스트 + 신규 게이트 테스트)

- [ ] **Step 1: 실패하는 테스트 추가**

`src/screening/strategy-matcher.spec.ts`의 `createContext()` 함수 정의 바로 아래에 헬퍼 추가:

```typescript
/** momentum-breakout 게이트(ETF + MA20 위 + ATR)를 통과하는 ETF 컨텍스트 */
function createEtfContext(): StockStrategyContext {
  const context = createContext();
  context.watchStock.stockName = 'KODEX 레버리지';
  context.watchStock.stockCode = '122630';
  context.price.stockCode = '122630';
  context.price.stockName = 'KODEX 레버리지';
  context.stockIndicators.ma20 = 65000; // currentPrice 70000 > ma20
  context.stockIndicators.atrPercent = 2; // ≥ DAY_TRADE_MIN_ATR_PCT(1.2)
  return context;
}
```

`describe('suggestStrategies', ...)` 블록 안에 신규 테스트 5개 추가:

```typescript
  it('momentum-breakout은 일반 주식(비ETF)이면 BUY 신호가 있어도 제외한다', async () => {
    const strategies = [
      createStrategy('momentum-breakout', '변동성 돌파', [createSignal('005930', 'BUY', '돌파')]),
    ];
    const results = await suggestStrategies(strategies, createContext()); // Samsung 컨텍스트
    expect(results).toHaveLength(0);
  });

  it('momentum-breakout은 MA20 아래면 제외한다', async () => {
    const context = createEtfContext();
    context.stockIndicators.ma20 = 75000; // currentPrice 70000 < ma20
    const strategies = [
      createStrategy('momentum-breakout', '변동성 돌파', [createSignal('122630', 'BUY', '돌파')]),
    ];
    expect(await suggestStrategies(strategies, context)).toHaveLength(0);
  });

  it('momentum-breakout은 ATR 미달이면 제외한다', async () => {
    const context = createEtfContext();
    context.stockIndicators.atrPercent = 1.0;
    const strategies = [
      createStrategy('momentum-breakout', '변동성 돌파', [createSignal('122630', 'BUY', '돌파')]),
    ];
    expect(await suggestStrategies(strategies, context)).toHaveLength(0);
  });

  it('momentum-breakout은 해외 종목이면 제외한다 (국내 전용 전략)', async () => {
    const context = createEtfContext();
    context.watchStock.market = 'OVERSEAS';
    const strategies = [
      createStrategy('momentum-breakout', '변동성 돌파', [createSignal('122630', 'BUY', '돌파')]),
    ];
    expect(await suggestStrategies(strategies, context)).toHaveLength(0);
  });

  it('momentum-breakout은 조건을 충족한 ETF에서 추천된다', async () => {
    const strategies = [
      createStrategy('momentum-breakout', '변동성 돌파', [createSignal('122630', 'BUY', '돌파')]),
    ];
    const results = await suggestStrategies(strategies, createEtfContext());
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('momentum-breakout');
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest src/screening/strategy-matcher.spec.ts`
Expected: 신규 5개 중 "제외한다" 4개 FAIL (현재 게이트는 무조건 통과), "추천된다" 1개 PASS

- [ ] **Step 3: 게이트 구현**

`src/screening/strategy-matcher.ts` 상단 import 수정:

```typescript
import { PerStockTradingStrategy, StockStrategyContext, TradingSignal } from '../trading/types';
import { detectEtf, SuggestedStrategy } from './types';
import { DAY_TRADE_MIN_ATR_PCT } from './day-trade-selector';
```

`passesRecommendationGate` 함수(34행)를 다음으로 교체:

```typescript
/**
 * momentum-breakout 추천 게이트.
 * 백테스트(2023-06~2026-05) 결론: 거래세 면제 ETF + MA20 위 레짐 + 충분한 변동폭에서만
 * 양의 기대값 — 일반 주식은 거래세(0.18%)가 gross 엣지보다 커서 구조적 손실.
 */
function passesMomentumBreakoutGate(context: StockStrategyContext): boolean {
  const { stockIndicators, watchStock, price } = context;
  if (watchStock.market !== 'DOMESTIC') return false; // 국내 전용 전략
  if (!detectEtf(watchStock.stockName ?? '', watchStock.stockCode)) return false;
  if (stockIndicators.investCautionYn || stockIndicators.shortOverheatYn) return false;
  if (stockIndicators.marketWarnCode && stockIndicators.marketWarnCode !== '00') return false;
  const ma20 = stockIndicators.ma20;
  if (ma20 === undefined || ma20 <= 0 || price.currentPrice <= ma20) return false;
  const atrPercent = stockIndicators.atrPercent;
  if (atrPercent === undefined || atrPercent < DAY_TRADE_MIN_ATR_PCT) return false;
  return true;
}

function passesRecommendationGate(strategyName: string, context: StockStrategyContext): boolean {
  if (strategyName === 'momentum-breakout') return passesMomentumBreakoutGate(context);
  if (strategyName !== 'infinite-buy') return true;
  // ... (이하 기존 infinite-buy 로직 그대로 유지)
```

(기존 infinite-buy 본문은 변경하지 않는다 — `if (strategyName !== 'infinite-buy') return true;` 줄만 위 2줄로 바뀌는 것)

- [ ] **Step 4: 기존 테스트 2개를 ETF 컨텍스트로 수정**

`npx jest src/screening/strategy-matcher.spec.ts`를 돌리면 기존 테스트 2개가 FAIL한다:
- 92행 `it('recommends only strategies that produce BUY signals', ...)`
- 257행 `it('sorts recommendations by configured priority and layered buy bonus', ...)`

두 테스트 모두 momentum-breakout이 추천 결과에 포함될 것을 기대하므로, 각 테스트 본문에서 `suggestStrategies(strategies, createContext())`로 넘기던 컨텍스트를 `createEtfContext()`로 교체한다 (해당 두 테스트만 — 다른 infinite-buy 테스트는 손대지 않는다).

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx jest src/screening/strategy-matcher.spec.ts`
Expected: PASS (전체)

- [ ] **Step 6: 회귀 확인 (screening 전체)**

Run: `npx jest src/screening`
Expected: PASS — `screening.service.spec.ts` 등에 momentum 추천을 전제한 단언이 있으면 같은 방식(ETF 컨텍스트 또는 기대값 수정)으로 고친다

- [ ] **Step 7: Commit**

```bash
git add src/screening/strategy-matcher.ts src/screening/strategy-matcher.spec.ts
git commit -m "fix: gate momentum-breakout recommendations to volatile KRX ETFs

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Slack 데이트레이드 리포트

**Files:**
- Modify: `src/notification/slack.service.ts` (`sendScreeningResult` 메서드 뒤, ~376행)

- [ ] **Step 1: 메서드 추가**

`sendScreeningResult` 메서드 정의가 끝나는 지점 바로 뒤에 추가:

```typescript
  async sendDayTradeCandidates(payload: {
    date: string;
    candidates: {
      stockCode: string;
      stockName: string;
      rank: number;
      score: number;
      prevRangePct: number;
      atrPct: number;
      avgTradeValue20d: number;
      simulated: boolean;
    }[];
    excluded: { stockName: string; reason: string }[];
    warnings: string[];
  }): Promise<void> {
    if (!await this.ensureConnected()) return;

    try {
      const { date, candidates, excluded, warnings } = payload;
      const lines = candidates.map((c) =>
        `${c.rank}. *${c.stockName}* (${c.stockCode}) — ${c.score.toFixed(1)}점${c.simulated ? ' :robot_face: 시뮬 투입' : ''}\n` +
        `    전일변동폭 ${c.prevRangePct.toFixed(2)}% | ATR ${c.atrPct.toFixed(2)}% | 거래대금 ${(c.avgTradeValue20d / 100_000_000).toFixed(0)}억 | MA20 위`,
      );

      const blocks: KnownBlock[] = [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `:zap: *당일청산(변동성 돌파) 후보 | ${date}*` },
        },
        { type: 'divider' },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: lines.length > 0
              ? lines.join('\n\n')
              : '오늘 조건을 충족한 ETF가 없습니다. (레짐/변동폭 미달 시 진입하지 않는 것이 정상)',
          },
        },
      ];

      if (excluded.length > 0) {
        blocks.push({
          type: 'context',
          elements: [{
            type: 'mrkdwn',
            text: `제외: ${excluded.map((e) => `${e.stockName}(${e.reason})`).join(', ')}`,
          }],
        });
      }

      if (warnings.length > 0) {
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: `:warning: ${warnings.join('\n')}` },
        });
      }

      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: '실거래 등록은 수동입니다 — 시뮬 검증 후 진행하세요.' }],
      });

      await this.app!.client.chat.postMessage({
        channel: this.channel,
        blocks,
        text: `당일청산 후보 ${candidates.length}종목 | ${date}`,
      });
    } catch (e) {
      this.logger.error(`Failed to send day-trade candidates: ${e.message}`);
      this.handleSendError(e);
    }
  }
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 에러 없음

- [ ] **Step 3: Commit**

```bash
git add src/notification/slack.service.ts
git commit -m "feat: add day-trade candidates Slack report

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: `DayTradeScreeningService` (TDD)

**Files:**
- Create: `src/screening/day-trade-screening.service.spec.ts`
- Create: `src/screening/day-trade-screening.service.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/screening/day-trade-screening.service.spec.ts`:

```typescript
import { SimulationStatus } from '@prisma/client';
import { DayTradeScreeningService } from './day-trade-screening.service';
import { DailyPrice } from '../kis/types/kis-api.types';

const DATE = '20260611';

/** 게이트 통과용 봉: 최신 봉만 상승 → aboveMa20 true, ATR/거래대금 충분 */
function passingBars(): DailyPrice[] {
  return Array.from({ length: 25 }, (_, i) => ({
    date: String(20260610 - i),
    close: i === 0 ? 105 : 100,
    open: 100,
    high: i === 0 ? 108 : 102,
    low: i === 0 ? 102 : 98,
    volume: 600_000_000, // 평균 거래대금 ≈ 600억 ≥ 300억
  }));
}

/** 레짐 탈락용 봉: 전 구간 동일 → aboveMa20 false */
function flatBars(): DailyPrice[] {
  return Array.from({ length: 25 }, (_, i) => ({
    date: String(20260610 - i),
    close: 100, open: 100, high: 102, low: 98, volume: 600_000_000,
  }));
}

describe('DayTradeScreeningService', () => {
  let prisma: any;
  let kis: any;
  let sessionManager: any;
  let slack: any;
  let service: DayTradeScreeningService;

  beforeEach(() => {
    prisma = {
      appSetting: { findUnique: jest.fn().mockResolvedValue(null) }, // 기본 설정 사용
      simulationSession: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      dayTradeCandidate: {
        upsert: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    kis = {
      getVolumeRanking: jest.fn().mockResolvedValue([]),
      getFluctuationRanking: jest.fn().mockResolvedValue([]),
      getDailyPrices: jest.fn().mockResolvedValue([]), // 기본: 봉 부족 → 평가 제외
      getPrice: jest.fn().mockImplementation((code: string) =>
        Promise.resolve({ stockCode: code, stockName: `name-${code}`, currentPrice: 100 })),
    };
    sessionManager = {
      createSession: jest.fn().mockImplementation((input: any) =>
        Promise.resolve({ id: `session-${input.stockCode}` })),
      updateStatus: jest.fn().mockResolvedValue({}),
    };
    slack = { sendDayTradeCandidates: jest.fn().mockResolvedValue(undefined) };
    service = new DayTradeScreeningService(kis, sessionManager, slack, prisma);
  });

  it('설정이 비활성화면 아무것도 하지 않고 skipped를 반환한다', async () => {
    prisma.appSetting.findUnique.mockResolvedValue({ value: { enabled: false } });
    const result = await service.runDailySelection(DATE);
    expect(result.skipped).toBe(true);
    expect(kis.getVolumeRanking).not.toHaveBeenCalled();
    expect(slack.sendDayTradeCandidates).not.toHaveBeenCalled();
  });

  it('통과 후보를 저장하고 topN만 시뮬에 투입한다', async () => {
    // 시드 7종목 중 122630만 통과, 252670은 레짐 탈락, 나머지는 봉 부족으로 제외
    kis.getDailyPrices.mockImplementation((code: string) => {
      if (code === '122630') return Promise.resolve(passingBars());
      if (code === '252670') return Promise.resolve(flatBars());
      return Promise.resolve([]);
    });

    const result = await service.runDailySelection(DATE);

    expect(result.skipped).toBe(false);
    expect(result.saved).toBe(2); // 통과 1 + 탈락 1
    expect(result.simulated).toBe(1);
    expect(prisma.dayTradeCandidate.upsert).toHaveBeenCalledTimes(2);
    expect(sessionManager.createSession).toHaveBeenCalledTimes(1);
    expect(sessionManager.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        stockCode: '122630',
        strategyName: 'momentum-breakout',
        name: `[DT] ${DATE} name-122630`,
        strategyParams: JSON.stringify({ dayTradeAuto: true, screeningDate: DATE }),
      }),
    );
    // 시뮬 세션 ID가 후보에 연결됨
    expect(prisma.dayTradeCandidate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { simulationSessionId: 'session-122630' },
      }),
    );
    expect(slack.sendDayTradeCandidates).toHaveBeenCalledTimes(1);
  });

  it('전일 [DT] 세션은 포지션이 없으면 COMPLETED 처리한다', async () => {
    prisma.simulationSession.findMany.mockResolvedValue([
      {
        id: 's1', stockCode: '122630', stockName: 'KODEX 레버리지',
        name: '[DT] 20260610 KODEX 레버리지',
        strategyParams: { dayTradeAuto: true, screeningDate: '20260610' },
        positions: [],
      },
    ]);
    await service.runDailySelection(DATE);
    expect(sessionManager.updateStatus).toHaveBeenCalledWith('s1', SimulationStatus.COMPLETED);
  });

  it('전일 [DT] 세션에 포지션이 남아 있으면 RUNNING 유지하고 경고를 Slack에 포함한다', async () => {
    prisma.simulationSession.findMany.mockResolvedValue([
      {
        id: 's2', stockCode: '122630', stockName: 'KODEX 레버리지',
        name: '[DT] 20260610 KODEX 레버리지',
        strategyParams: { dayTradeAuto: true, screeningDate: '20260610' },
        positions: [{ quantity: 10 }],
      },
    ]);
    kis.getDailyPrices.mockImplementation((code: string) =>
      Promise.resolve(code === '122630' ? passingBars() : []));

    await service.runDailySelection(DATE);

    expect(sessionManager.updateStatus).not.toHaveBeenCalled();
    expect(slack.sendDayTradeCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        warnings: expect.arrayContaining([expect.stringContaining('122630')]),
      }),
    );
  });

  it('오늘 생성된 [DT] 세션은 재실행 시 정리 대상에서 제외한다', async () => {
    prisma.simulationSession.findMany.mockResolvedValue([
      {
        id: 's3', stockCode: '122630', stockName: 'KODEX 레버리지',
        name: `[DT] ${DATE} KODEX 레버리지`,
        strategyParams: { dayTradeAuto: true, screeningDate: DATE },
        positions: [],
      },
    ]);
    await service.runDailySelection(DATE);
    expect(sessionManager.updateStatus).not.toHaveBeenCalled();
  });

  it('같은 날 같은 종목 세션이 이미 있으면 중복 생성하지 않는다 (멱등)', async () => {
    kis.getDailyPrices.mockImplementation((code: string) =>
      Promise.resolve(code === '122630' ? passingBars() : []));
    prisma.simulationSession.findFirst.mockResolvedValue({ id: 'existing-session' });

    const result = await service.runDailySelection(DATE);

    expect(sessionManager.createSession).not.toHaveBeenCalled();
    expect(prisma.dayTradeCandidate.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { simulationSessionId: 'existing-session' } }),
    );
    expect(result.simulated).toBe(1);
  });

  it('일부 종목의 KIS 호출이 실패해도 나머지는 계속 평가한다', async () => {
    kis.getDailyPrices.mockImplementation((code: string) => {
      if (code === '122630') return Promise.reject(new Error('KIS timeout'));
      if (code === '252670') return Promise.resolve(passingBars());
      return Promise.resolve([]);
    });

    const result = await service.runDailySelection(DATE);

    expect(result.saved).toBe(1); // 252670만 평가됨
    expect(slack.sendDayTradeCandidates).toHaveBeenCalledTimes(1);
  });

  it('시뮬 생성이 실패해도 후보 저장과 Slack 리포트는 유지된다', async () => {
    kis.getDailyPrices.mockImplementation((code: string) =>
      Promise.resolve(code === '122630' ? passingBars() : []));
    sessionManager.createSession.mockRejectedValue(new Error('sim error'));

    const result = await service.runDailySelection(DATE);

    expect(result.skipped).toBe(false);
    expect(result.simulated).toBe(0);
    expect(prisma.dayTradeCandidate.upsert).toHaveBeenCalled();
    expect(slack.sendDayTradeCandidates).toHaveBeenCalledTimes(1);
  });

  it('랭킹에서 수집한 strict ETF가 유니버스에 합류한다', async () => {
    kis.getVolumeRanking.mockResolvedValue([
      { mksc_shrn_iscd: '305720', hts_kor_isnm: 'KODEX 2차전지산업' }, // strict ETF → 합류
      { mksc_shrn_iscd: '005930', hts_kor_isnm: '삼성전자' }, // 일반주 → 제외
      { mksc_shrn_iscd: 'Q500001', hts_kor_isnm: '미래에셋 레버리지 ETN' }, // ETN → 제외
    ]);
    await service.runDailySelection(DATE);
    const requested = kis.getDailyPrices.mock.calls.map((c: any[]) => c[0]);
    expect(requested).toContain('305720');
    expect(requested).not.toContain('005930');
    expect(requested).not.toContain('Q500001');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest src/screening/day-trade-screening.service.spec.ts`
Expected: FAIL — `Cannot find module './day-trade-screening.service'`

- [ ] **Step 3: 서비스 구현**

`src/screening/day-trade-screening.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Market, Prisma, SimulationStatus } from '@prisma/client';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { SimulationSessionManager } from '../simulation/simulation-session-manager.service';
import { SlackService } from '../notification/slack.service';
import { PrismaService } from '../prisma.service';
import {
  buildDayTradeScore,
  computeDayTradeIndicators,
  DAY_TRADE_SEED_ETFS,
  isStrictKrxEtf,
  rankDayTradeCandidates,
} from './day-trade-selector';
import { kstDateNDaysAgo, kstTodayStr } from './utils/date.util';
import {
  DayTradeCandidateScore,
  DayTradeRunResult,
  DayTradeScreeningSettings,
} from './types/day-trade.type';

const DAY_TRADE_SETTINGS_KEY = 'day-trade-screening';
const DAY_TRADE_STRATEGY_NAME = 'momentum-breakout';
const DAILY_PRICE_LOOKBACK_DAYS = 60; // 달력일 기준 — 거래일 ~40개 확보 (MA20+ATR14에 충분)
const DEFAULT_SETTINGS: DayTradeScreeningSettings = {
  enabled: true,
  topN: 3,
  simCapital: 2_000_000,
};

/**
 * 당일청산(변동성 돌파) 후보 선정 파이프라인.
 * 매 거래일 08:30 KST — 전일 확정 일봉 기준으로 거래세 면제 ETF를 필터/점수화하고
 * 상위 후보를 시뮬레이션 세션에 자동 투입한다. 실거래 등록은 수동.
 */
@Injectable()
export class DayTradeScreeningService {
  private readonly logger = new Logger(DayTradeScreeningService.name);

  constructor(
    private readonly kisDomestic: KisDomesticService,
    private readonly sessionManager: SimulationSessionManager,
    private readonly slackService: SlackService,
    private readonly prisma: PrismaService,
  ) {}

  async runDailySelection(date: string = kstTodayStr()): Promise<DayTradeRunResult> {
    const settings = await this.getSettings();
    if (!settings.enabled) {
      return {
        skipped: true,
        skipReason: '데이트레이드 스크리닝이 비활성화되어 있습니다.',
        saved: 0,
        simulated: 0,
      };
    }

    const warnings = await this.completePreviousSessions(date);
    const universe = await this.collectUniverse();
    if (universe.length === 0) {
      return { skipped: true, skipReason: '평가할 ETF 유니버스가 비어 있습니다.', saved: 0, simulated: 0 };
    }

    const scores = await this.evaluateUniverse(universe, date);
    const ranked = rankDayTradeCandidates(scores);
    await this.saveCandidates(date, ranked);

    const passing = ranked.filter((s) => !s.excluded);
    const targets = passing.slice(0, settings.topN);
    const simulatedCodes = await this.feedSimulations(date, targets, settings.simCapital);

    await this.notify(date, ranked, simulatedCodes, warnings);

    return {
      skipped: false,
      saved: ranked.length,
      simulated: simulatedCodes.size,
      topStockName: passing[0]?.stockName,
    };
  }

  private async getSettings(): Promise<DayTradeScreeningSettings> {
    try {
      const saved = await this.prisma.appSetting.findUnique({
        where: { key: DAY_TRADE_SETTINGS_KEY },
      });
      const value = (saved?.value as Partial<DayTradeScreeningSettings>) ?? {};
      return {
        enabled: value.enabled ?? DEFAULT_SETTINGS.enabled,
        topN: value.topN && value.topN > 0 ? Math.floor(value.topN) : DEFAULT_SETTINGS.topN,
        simCapital:
          value.simCapital && value.simCapital > 0 ? value.simCapital : DEFAULT_SETTINGS.simCapital,
      };
    } catch (e) {
      this.logger.warn(`day-trade 설정 로드 실패, 기본값 사용: ${e.message}`);
      return { ...DEFAULT_SETTINGS };
    }
  }

  /**
   * 전일 [DT] 세션 정리.
   * 포지션이 없으면 COMPLETED, 남아 있으면 전략의 이월청산 안전망이 동작하도록
   * RUNNING을 유지하고 경고만 남긴다. 오늘 생성분(screeningDate === date)은 건드리지 않는다.
   */
  private async completePreviousSessions(date: string): Promise<string[]> {
    const warnings: string[] = [];
    try {
      const sessions = await this.prisma.simulationSession.findMany({
        where: {
          strategyName: DAY_TRADE_STRATEGY_NAME,
          status: SimulationStatus.RUNNING,
          strategyParams: { path: ['dayTradeAuto'], equals: true },
        },
        include: { positions: true },
      });

      for (const session of sessions) {
        const params = (session.strategyParams as Record<string, any>) ?? {};
        if (params.screeningDate === date) continue;

        const hasOpenPosition = session.positions.some((p) => p.quantity > 0);
        if (hasOpenPosition) {
          warnings.push(
            `[DT] ${session.stockName}(${session.stockCode}) 전일 세션에 포지션이 남아 RUNNING 유지 (이월청산 대기)`,
          );
          continue;
        }
        await this.sessionManager.updateStatus(session.id, SimulationStatus.COMPLETED);
        this.logger.log(`[DT] 전일 시뮬 세션 종료: ${session.name}`);
      }
    } catch (e) {
      warnings.push(`전일 세션 정리 실패: ${e.message}`);
      this.logger.warn(`[DT] 전일 세션 정리 실패: ${e.message}`);
    }
    return warnings;
  }

  /** 시드 ETF ∪ 랭킹 내 strict ETF. 08:30 랭킹이 전일 기준/빈 응답이어도 시드가 안전망 */
  private async collectUniverse(): Promise<{ stockCode: string; stockName: string }[]> {
    const byCode = new Map<string, string>();
    for (const seed of DAY_TRADE_SEED_ETFS) byCode.set(seed.stockCode, seed.stockName);

    const rankings = await Promise.allSettled([
      this.kisDomestic.getVolumeRanking(),
      this.kisDomestic.getFluctuationRanking(),
    ]);
    const labels = ['volume rank', 'fluctuation rank'];
    rankings.forEach((result, i) => {
      if (result.status === 'rejected') {
        this.logger.warn(`[DT] ${labels[i]} 조회 실패: ${result.reason?.message ?? result.reason}`);
        return;
      }
      for (const item of result.value ?? []) {
        const code = item.mksc_shrn_iscd;
        const name = item.hts_kor_isnm || code;
        if (!code || byCode.has(code)) continue;
        if (!isStrictKrxEtf(name, code)) continue;
        byCode.set(code, name);
      }
    });

    return [...byCode.entries()].map(([stockCode, stockName]) => ({ stockCode, stockName }));
  }

  private async evaluateUniverse(
    universe: { stockCode: string; stockName: string }[],
    date: string,
  ): Promise<DayTradeCandidateScore[]> {
    const scores: DayTradeCandidateScore[] = [];
    const from = kstDateNDaysAgo(DAILY_PRICE_LOOKBACK_DAYS);

    for (const item of universe) {
      try {
        const prices = await this.kisDomestic.getDailyPrices(item.stockCode, from, date);
        const indicators = computeDayTradeIndicators(prices, date);
        if (!indicators) {
          this.logger.debug(`[${item.stockCode}] 확정 일봉 부족으로 평가 제외`);
          continue;
        }
        await this.sleep(60); // KIS rate limit
        const price = await this.kisDomestic.getPrice(item.stockCode);
        scores.push(
          buildDayTradeScore(item.stockCode, price.stockName || item.stockName, indicators, {
            investCautionYn: price.investCautionYn,
            shortOverheatYn: price.shortOverheatYn,
            marketWarnCode: price.marketWarnCode,
          }),
        );
      } catch (e) {
        this.logger.warn(`[${item.stockCode}] 데이트레이드 평가 실패: ${e.message}`);
      }
      await this.sleep(60); // KIS rate limit
    }
    return scores;
  }

  private async saveCandidates(date: string, ranked: DayTradeCandidateScore[]): Promise<void> {
    for (const c of ranked) {
      const payload = {
        stockName: c.stockName,
        rank: c.rank,
        score: new Prisma.Decimal(c.score),
        prevRangePct: new Prisma.Decimal(c.indicators.prevRangePct.toFixed(4)),
        atrPct: new Prisma.Decimal(c.indicators.atrPct.toFixed(4)),
        avgTradeValue20d: BigInt(Math.round(c.indicators.avgTradeValue20d)),
        aboveMa20: c.indicators.aboveMa20,
        excluded: c.excluded,
        excludeReason: c.excludeReason ?? null,
        indicators: c.indicators as unknown as Prisma.InputJsonValue,
      };
      await this.prisma.dayTradeCandidate.upsert({
        where: {
          screeningDate_market_stockCode: {
            screeningDate: date,
            market: Market.DOMESTIC,
            stockCode: c.stockCode,
          },
        },
        update: payload,
        create: {
          screeningDate: date,
          market: Market.DOMESTIC,
          exchangeCode: c.exchangeCode,
          stockCode: c.stockCode,
          ...payload,
        },
      });
    }
  }

  /** 상위 후보를 시뮬 세션으로 투입. 같은 날 같은 종목 세션이 있으면 재사용 (멱등) */
  private async feedSimulations(
    date: string,
    targets: DayTradeCandidateScore[],
    simCapital: number,
  ): Promise<Set<string>> {
    const simulated = new Set<string>();
    for (const target of targets) {
      try {
        const existing = await this.prisma.simulationSession.findFirst({
          where: {
            stockCode: target.stockCode,
            strategyName: DAY_TRADE_STRATEGY_NAME,
            strategyParams: { path: ['screeningDate'], equals: date },
          },
          select: { id: true },
        });

        let sessionId: string;
        if (existing) {
          sessionId = existing.id;
        } else {
          const session = await this.sessionManager.createSession({
            name: `[DT] ${date} ${target.stockName}`,
            description: '데이트레이드 스크리닝 자동 투입 (페이퍼 검증용)',
            market: Market.DOMESTIC,
            exchangeCode: 'KRX',
            stockCode: target.stockCode,
            stockName: target.stockName,
            strategyName: DAY_TRADE_STRATEGY_NAME,
            quota: simCapital,
            strategyParams: JSON.stringify({ dayTradeAuto: true, screeningDate: date }),
          });
          sessionId = session.id;
          this.logger.log(`[DT] 시뮬 세션 생성: [DT] ${date} ${target.stockName}`);
        }

        await this.prisma.dayTradeCandidate.update({
          where: {
            screeningDate_market_stockCode: {
              screeningDate: date,
              market: Market.DOMESTIC,
              stockCode: target.stockCode,
            },
          },
          data: { simulationSessionId: sessionId },
        });
        simulated.add(target.stockCode);
      } catch (e) {
        this.logger.warn(`[${target.stockCode}] 시뮬 투입 실패: ${e.message}`);
      }
    }
    return simulated;
  }

  private async notify(
    date: string,
    ranked: DayTradeCandidateScore[],
    simulatedCodes: Set<string>,
    warnings: string[],
  ): Promise<void> {
    try {
      const passing = ranked.filter((s) => !s.excluded);
      const seedCodes = new Set(DAY_TRADE_SEED_ETFS.map((s) => s.stockCode));
      const excludedNotables = ranked
        .filter((s) => s.excluded && seedCodes.has(s.stockCode))
        .map((s) => ({ stockName: s.stockName, reason: s.excludeReason ?? '기준 미달' }));

      await this.slackService.sendDayTradeCandidates({
        date,
        candidates: passing.map((s) => ({
          stockCode: s.stockCode,
          stockName: s.stockName,
          rank: s.rank,
          score: s.score,
          prevRangePct: s.indicators.prevRangePct,
          atrPct: s.indicators.atrPct,
          avgTradeValue20d: s.indicators.avgTradeValue20d,
          simulated: simulatedCodes.has(s.stockCode),
        })),
        excluded: excludedNotables,
        warnings,
      });
    } catch (e) {
      this.logger.warn(`[DT] Slack 리포트 전송 실패: ${e.message}`);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest src/screening/day-trade-screening.service.spec.ts`
Expected: PASS (전체. 시드 7종목 × sleep 60ms×2로 테스트당 ~1초 소요는 정상)

- [ ] **Step 5: Commit**

```bash
git add src/screening/day-trade-screening.service.ts src/screening/day-trade-screening.service.spec.ts
git commit -m "feat: add day-trade screening service with sim auto-feed

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 스케줄러 cron + 모듈 wiring

**Files:**
- Modify: `src/screening/screening.scheduler.ts` (jobKey 타입 25-31행, onModuleInit 46-75행, 신규 메서드)
- Modify: `src/screening/screening.module.ts`

- [ ] **Step 1: 순환 의존 사전 확인**

Run: `grep -rn "ScreeningModule" src --include="*.module.ts" --include="*.ts" | grep -v screening.module`
Expected: `app.module.ts`에서만 import (SimulationModule 체인에 ScreeningModule이 없어야 함). 만약 다른 모듈이 ScreeningModule을 import하고 있다면 **중단하고 보고**.

- [ ] **Step 2: 모듈 wiring**

`src/screening/screening.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { KisModule } from '../kis/kis.module';
import { NotificationModule } from '../notification/notification.module';
import { TradingModule } from '../trading/trading.module';
import { PrismaService } from '../prisma.service';
import { SimulationModule } from '../simulation/simulation.module';
import { StockMasterModule } from '../stock-master/stock-master.module';
import { DayTradeScreeningService } from './day-trade-screening.service';
import { DeepAnalysisService } from './deep-analysis.service';
import { ScreeningService } from './screening.service';
import { ScreeningScheduler } from './screening.scheduler';
import { ScreeningResolver } from './screening.resolver';
import { ScreeningCandidateCollector } from './screening-candidate-collector.service';
import { ScreeningAnalyzer } from './screening-analyzer.service';
import { ScreeningRepository } from './screening-repository.service';

@Module({
  imports: [KisModule, NotificationModule, TradingModule, StockMasterModule, SimulationModule],
  providers: [
    PrismaService,
    DeepAnalysisService,
    ScreeningCandidateCollector,
    ScreeningAnalyzer,
    ScreeningRepository,
    ScreeningService,
    DayTradeScreeningService,
    ScreeningScheduler,
    ScreeningResolver,
  ],
  exports: [
    ScreeningService,
    ScreeningCandidateCollector,
    ScreeningAnalyzer,
    ScreeningRepository,
  ],
})
export class ScreeningModule {}
```

(`DayTradeScreeningService`는 모듈 내부에서만 사용하므로 exports에 넣지 않는다)

- [ ] **Step 3: 스케줄러 수정**

`src/screening/screening.scheduler.ts`:

(a) import 추가:

```typescript
import { DayTradeScreeningService } from './day-trade-screening.service';
```

(b) jobKey 타입(25-31행)에 `'day-trade-fast'` 추가:

```typescript
type ScreeningSchedulerJobKey =
  | 'domestic-fast'
  | 'overseas-us-fast'
  | 'overseas-asia-fast'
  | 'domestic-deep'
  | 'overseas-us-deep'
  | 'overseas-deep'
  | 'day-trade-fast';
```

(c) constructor에 주입 추가:

```typescript
  constructor(
    private screeningService: ScreeningService,
    private dayTradeScreeningService: DayTradeScreeningService,
    private schedulerRegistry: SchedulerRegistry,
    private slackService: SlackService,
    private prisma: PrismaService,
  ) {}
```

(d) `onModuleInit()`의 마지막 `this.logger.log(...)` 직전에 cron 등록 추가:

```typescript
    // 데이트레이드 후보 선정: 08:30 KST (장 시작 전, 전일 확정 일봉 기반)
    const dayTradeJob = new CronJob(
      '30 8 * * 1-5',
      () => this.runDayTradeScreening(),
      null, false, 'Asia/Seoul',
    );
    this.schedulerRegistry.addCronJob('screening-day-trade', dayTradeJob);
    dayTradeJob.start();
```

기존 로그 라인을 다음으로 교체:

```typescript
    this.logger.log('Screening scheduler registered (day-trade 08:30, domestic 09:10, Asia 10:50, US 00:10 KST)');
```

(e) `runDomesticScreening()` 메서드 앞에 신규 메서드 추가:

```typescript
  async runDayTradeScreening(): Promise<void> {
    const jobKey: ScreeningSchedulerJobKey = 'day-trade-fast';
    const date = kstTodayStr();
    if (this.isFastRunning || this.isDeepRunning) {
      await this.recordSchedulerRun(jobKey, {
        status: 'skipped',
        date,
        message: '다른 스크리닝 작업이 실행 중입니다.',
      });
      return;
    }

    const enabled = await this.getEnabledCountries();
    if (!enabled.has('KR')) {
      this.logger.log('KR screening disabled, skipping day-trade screening');
      await this.recordSchedulerRun(jobKey, {
        status: 'skipped',
        date,
        message: 'KR 스크리닝이 비활성화되어 있습니다.',
      });
      return;
    }

    this.isFastRunning = true;
    await this.recordSchedulerRun(jobKey, { status: 'started', date });
    try {
      const result = await this.dayTradeScreeningService.runDailySelection(date);
      if (result.skipped) {
        await this.recordSchedulerRun(jobKey, {
          status: 'skipped',
          date,
          message: result.skipReason,
        });
        return;
      }
      this.logger.log(
        `Day-trade screening saved: ${result.saved} candidates, ${result.simulated} simulated`,
      );
      await this.recordSchedulerRun(jobKey, {
        status: 'success',
        date,
        count: result.saved,
        message: result.topStockName ?? '후보 없음',
      });
    } catch (e) {
      this.logger.error(`Day-trade screening error: ${e.message}`);
      await this.recordSchedulerRun(jobKey, {
        status: 'failed',
        date,
        message: e.message,
      });
    } finally {
      this.isFastRunning = false;
    }
  }
```

- [ ] **Step 4: 빌드 + 전체 테스트**

Run: `npm run build && npx jest src/screening`
Expected: 빌드 성공, 테스트 전체 PASS

- [ ] **Step 5: Commit**

```bash
git add src/screening/screening.scheduler.ts src/screening/screening.module.ts
git commit -m "feat: schedule day-trade screening at 08:30 KST

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: 모듈 CLAUDE.md 문서 갱신

**Files:**
- Modify: `src/screening/CLAUDE.md`
- Modify: `src/simulation/CLAUDE.md`

- [ ] **Step 1: screening CLAUDE.md 갱신**

`## 주요 서비스` 목록의 `screening.scheduler.ts` 항목 앞에 추가:

```markdown
- `day-trade-screening.service.ts` — 당일청산(변동성 돌파) 후보 선정 파이프라인. 08:30 KST에 전일 확정 일봉 기준 ETF 필터/점수화 → `DayTradeCandidate` 저장 → Slack 리포트 → 상위 N개 시뮬 세션 자동 투입
- `day-trade-selector.ts` — 데이트레이드 후보 순수 함수 (strict ETF 판별, MA20/ATR14/거래대금 계산, 하드 필터, 점수화). strategy-matcher의 momentum-breakout 게이트와 임계값 상수 공유
```

`## 주의사항` 끝에 추가:

```markdown
- **데이트레이드 스크리닝(`day-trade-fast`)의 비자명한 규칙**:
  - 실행 시간 08:30 KST 근거: 후보 선정 입력(전일 변동폭·MA20·거래대금)이 모두 전일 장 마감에 확정되므로 장 시작 전에 선정하고, 당일 적용 유의종목/거래정지 상태를 같은 시점에 반영한다. 기존 09:10 투자 스크리닝과 별개 파이프라인 (목적·기준·산출물이 다름)
  - 유니버스: 시드 ETF 상수(`DAY_TRADE_SEED_ETFS`) ∪ 거래량/등락률 랭킹 내 strict ETF. 08:30 랭킹 응답이 전일 기준/빈 값이어도 시드가 안전망. ETN/스팩은 제외 (발행사 신용·유동성 구조가 당일청산 시장가 전략에 부적합)
  - 임계값 근거: 평균 거래대금 ≥ 300억(시장가 슬리피지 무시 수준), ATR14% ≥ 1.2(왕복 비용 ~0.3% 대비 4배), 전일 종가 > MA20(백테스트 2023-06~2026-05에서 MA20 위 레짐만 양의 엣지). momentum-breakout 백테스트 결론(거래세 면제 ETF만 양의 기대값)이 전체 설계의 근거 — `src/backtest/CLAUDE.md` 참조
  - 거래대금은 종가×거래량 근사 (KIS 일봉 응답에 거래대금 필드 없음)
  - `screeningDate`는 `kstTodayStr()` 포맷(YYYYMMDD) — `StockRecommendation.screeningDate`와 동일 컨벤션
  - [DT] 시뮬 세션 라이프사이클: 다음 날 08:30 잡이 포지션 없는 세션만 COMPLETED 처리. 포지션이 남은 세션은 전략의 이월청산이 동작하도록 RUNNING 유지 + Slack 경고. `strategyParams.dayTradeAuto=true`가 자동 세션 마커
  - 설정: `AppSetting` 키 `day-trade-screening` = `{ enabled, topN(기본 3), simCapital(기본 200만) }`. 실거래 자동 등록은 범위 외 (시뮬 검증 후 별도 설계)
- **momentum-breakout 추천 게이트** (`strategy-matcher.ts`): 국내 + `detectEtf` + MA20 위 + `atrPercent ≥ DAY_TRADE_MIN_ATR_PCT`일 때만 추천에 노출. 일반 주식은 거래세(0.18%)가 gross 엣지보다 커서 게이트에서 차단
- `ScreeningModule` → `SimulationModule` 의존 ([DT] 세션 생성/정리용, `SimulationSessionManager` 사용). 역방향 의존 금지 (순환)
```

- [ ] **Step 2: simulation CLAUDE.md 갱신**

`## 주의사항` 끝에 추가:

```markdown
- **[DT] 자동 세션**: `screening` 모듈의 `DayTradeScreeningService`가 `strategyParams.dayTradeAuto=true` 마커로 momentum-breakout 페이퍼 세션을 매 거래일 생성/정리한다. 이 마커가 있는 세션의 상태를 수동으로 바꾸면 다음 날 08:30 정리 로직과 충돌할 수 있음 (포지션 없는 RUNNING 세션은 자동 COMPLETED 처리됨)
```

- [ ] **Step 3: Commit**

```bash
git add src/screening/CLAUDE.md src/simulation/CLAUDE.md
git commit -m "docs: document day-trade screening pipeline rules

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: 최종 검증

- [ ] **Step 1: 전체 빌드**

Run: `npm run build`
Expected: 에러 없음

- [ ] **Step 2: 전체 테스트**

Run: `npx jest`
Expected: 전체 PASS (기존 테스트 포함 — 깨지는 게 있으면 원인 파악 후 수정, 무관한 실패는 보고)

- [ ] **Step 3: 스키마 확인**

Run: `npx prisma validate 2>&1 | tail -2`
Expected: "The schema ... is valid"

- [ ] **Step 4: 결과 보고**

빌드/테스트 결과와 함께 다음을 사용자에게 보고:
- 다음 거래일 08:30 KST에 첫 자동 실행됨 (`AppSetting`에 `day-trade-screening` 키가 없으면 기본값 enabled=true, topN=3, simCapital=200만으로 동작)
- 수동 검증 방법: 앱 기동 후 콘솔에서 `ScreeningScheduler.runDayTradeScreening()` 호출 또는 다음 거래일 아침 Slack 리포트 확인
- 해외(US) 스크리닝 DST 문제는 2단계 별도 설계 예정

---

## Self-Review 결과 (작성 후 점검 완료)

- **스펙 커버리지**: 스펙 §3(컴포넌트)→Task 2/3/6/7, §4(모델)→Task 1, §5(선정 로직)→Task 3/6, §6(게이트)→Task 4, §7(시뮬 라이프사이클)→Task 6, §8(Slack)→Task 5, §9(에러 처리)→Task 6/7, §10(테스트)→Task 3/4/6/9, §11(CLAUDE.md)→Task 8. 갭 없음
- **Placeholder**: 없음 (모든 코드 스텝에 전체 코드 포함)
- **타입 일관성**: `DayTradeCandidateScore`/`DayTradeRunResult`/selector export 이름이 Task 2→3→6→7에서 동일하게 사용됨. `sendDayTradeCandidates` payload 시그니처가 Task 5(정의)와 Task 6(호출) 일치
