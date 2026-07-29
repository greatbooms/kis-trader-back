# Backtest Module

## 책임
실전 전략(`InfiniteBuyStrategy`, `MomentumBreakoutStrategy` 등 `src/trading/strategy/`)을 과거 OHLCV 데이터에 적용해 성과를 평가. CLI 기반 standalone 실행이며, 결과는 마크다운 리포트로 저장된다. 운영 NestJS 앱(`AppModule`)에는 포함되지 않는 별도 실행 모듈.

## 주요 서비스 / 컴포넌트
- `backtest.module.ts` — DB 캐시(`HistoricalDailyPrice`) + KIS API 수집 모드. `BacktestCLI`가 사용
- `backtest-memory.module.ts` — DB 의존 없이 매번 KIS API에서 수집해 in-memory로만 백테스트 (테스트/즉석 실험용)
- `data/historical-collector.service.ts` — KIS daily price 수집 + DB upsert. 10일 슬랙으로 캐시 hit 판정, 거래소 종류별로 from/to ↔ count 환산
- `data/indicator-calculator.ts` — 순수 함수형 SMA/RSI/ATR/ADX/Bollinger 계산. **chronological order(0=oldest)** — `market-analysis.service.ts`와 다름
- `engine/backtest.engine.ts` — `runBacktest()`. `PerStockTradingStrategy.evaluate`를 호출 → 가상 limit 주문 큐 처리 → 슬리피지 적용 체결 → daily portfolio value 기록
- `engine/metrics.ts` — `computeMetrics()`. CAGR / Sharpe / MDD / win rate / profit factor 계산 (252 거래일 기준)
- `runner/backtest-cli.ts` — `npm run backtest` 엔트리. `--strategy`로 전략 선택 (기본 `infinite-buy`), 전략별 인자 파싱, 마크다운 리포트 생성

## CLI 사용

```bash
# 무한매수 (기존 — 기본값)
npm run backtest -- --from 20200101 --to 20251231 --policies none,hard-stop-70

# 변동성 돌파 (당일청산, 국내 전용)
npm run backtest -- --strategy momentum-breakout --from 20230601 --to 20260531 \
  --tickers 005930,122630,069500 --k 0.3,0.5,0.7 --stop-loss 0.02
# 옵션: --take-profit 0.03 (익절 활성화) / --stop-fill low|close / --slippage 0.002 / --sell-tax 0
# 거래세: 기본 종목별 자동 (KRX_ETF_CODES에 있는 ETF는 0, 일반 주식 0.18%). --sell-tax로 일괄 override

# 무한매수 V4 (해외 전용, LOC/MOC 순정 체결)
npm run backtest -- --strategy infinite-buy-v4 --from 20200101 --to 20260601 \
  --tickers TQQQ,SOXL --quota 20000 --splits 40
# --tickers 미지정 시 TQQQ,SOXL 기본. --quota=원금(WatchStock.quota), --splits=분할수 N(WatchStock.maxCycles)
```

## 체결 모델 (engine)

1. **`metadata.fillModel` 기반 (우선)** — `'stop-entry'`: 당일청산 데이트레이드 근사
   - 진입: `high ≥ signal.price(돌파가)` → 돌파가×(1+슬리피지) 체결. 돌파가는 시가 기준 산출이라 갭 케이스 없음
   - 같은 bar 청산: 손절(`stopLossPrice`) → 익절(`takeProfitPrice`) → 종가 순 판정. 손절/익절 동시 터치 시 손절 우선 (보수적)
   - `stopFill: 'low'`(기본, low 터치 시 손절) vs `'close'`(종가가 stop 아래일 때만 — 낙관적)
   - `feeConfig`(매수/매도 수수료 + 거래세)는 **이 경로에만** 적용 — 미설정 시 0
2. **reason-prefix 기반 (기존, infinite-buy 전용)** — `Buy1`(시장가)/`Buy2`(지정가)/`Take profit`(지정가)/`stop loss`·`리스크 전량청산`(종가). **이 분기는 행동 보존 대상 — 수정 금지에 준함**

엔진은 ctx에 `evaluationMode: 'daily-bar'`와 `prevHigh/prevLow/prevClose`(직전 bar)를 주입한다.

## infinite-buy-v4 bar간 상태 스레딩

`strategy.name === 'infinite-buy-v4'`일 때만 엔진이 매 bar마다 다음을 수행한다 (다른 전략은 영향 없음):
1. `evaluateStock` 결과의 `details.v4StateUpdate({mode, recentCloses})`를 `state.strategyParams.v4`에 병합 — 다음 bar 평가에 전달
2. 그 bar의 loc/moc/limit-touch 체결을 `infinite-buy-v4-ledger.util.applyV4Fill`로 장부(T/cashRemaining/cycleSeq/lastKnownHoldQty)에 반영. **같은 bar에 SELL·BUY가 함께 체결되면 SELL 먼저** (신호 배열의 원래 순서와 무관하게 엔진이 재정렬 — 실거래 제출 순서(`trading.service.ts`의 `submissionOrderedSignals`)와 동일 규칙)
3. `TradingService.handleInfiniteBuyV4SignalFill`과 동일한 `applyV4Fill` 순수 함수를 공유하므로 백테스트/실거래 장부 규칙이 갈라지지 않는다

`BacktestResult.v4Summary`(finalMode/finalTurn/finalCashRemaining/cycleCount/reverseEntryCount)는 v4 전략일 때만 채워진다.

## 외부 의존성
- `@nestjs/core` (NestFactory.createApplicationContext) — standalone Nest app
- `KisModule` — 과거 시세 수집
- `InfiniteBuyStrategy`, `InfiniteBuyV4Strategy`, `MomentumBreakoutStrategy` (from `TradingModule`) — 평가 대상 전략
- `@prisma/client` — `HistoricalDailyPrice`, `Market` enum
- 표준 lib: `fs`, `path`

## 주의사항 / 비자명한 규칙
- **AppModule에 import되지 않음**: NestFactory standalone context로만 부팅. `npm run backtest` 스크립트로 실행
- **OHLCV 인덱스 컨벤션 차이 주의**: `indicator-calculator.ts`는 chronological(0=oldest), 운영 `market-analysis.service.ts`는 reverse-chronological. 실전 코드와 함께 수정할 때 인덱스 방향 헷갈리지 말 것
- 해외 KIS API는 from/to 미지원 → `count` 기반. `(days/365 * 250 * 1.3)` 추정치로 환산 (max 2000)
- 슬리피지 기본 0.5% (`DEFAULT_SLIPPAGE`). momentum CLI 경로는 기본 0.2% (`--slippage`로 조정). infinite-buy의 limit 주문은 다음 거래일 종가 기준 만료
- 워밍업 기본 200봉 (MA200 계산용). momentum CLI는 30봉 (MA20+RSI14만 필요). 부족하면 그 시점까지 거래 발생 X
- **momentum 일봉 근사의 한계 (리포트에도 명시)**: 트레일링 스탑 미반영(장중 고가 경로 미상), 손절은 터치 기반 근사, 실거래 soft 조건(시간보정 거래량/VWAP/수급)은 lookahead 방지를 위해 미적용 → 실거래 신호는 백테스트보다 적고 보수적. 최종 검증은 simulation(페이퍼)으로
- **momentum stop-fill 모델의 편향 방향**: `'low'`는 돌파 **이전**(아침)의 저점까지 손절로 집계해 과도하게 비관적 (stop ≈ 시가-1% 수준이라 대부분의 날이 터치됨), `'close'`는 장중 손절 후 회복을 무손절 처리해 낙관적. **진실은 둘 사이** — 두 모델을 모두 돌려 범위로 해석할 것. 2023-06~2026-05 122630 기준: K=0.5 low -18.0% ~ close +23.8%, K=0.7 low -16.1% ~ close +19.0% (MDD -9.0%, 승률 52.0%)
- **momentum 진입 체결 판정은 슬리피지 포함가 기준** (`high ≥ trigger×(1+slippage)`): 기록상 고가보다 높은 "불가능한 체결" 방지 + 돌파가를 한 틱 스치고 꺾인 날(1분 폴링 라이브도 놓치기 쉬움) 제외
- **momentum daily-bar는 meta MDD(-8%) 매수차단 미적용**: 단일 전략 equity 백테스트에서는 거래가 멈추면 드로다운이 회복될 수 없어 영구 잠금(absorbing state)이 됨. 엔진 riskState의 -25% 파국 방지선만 적용 (실거래에서는 포트폴리오 전체 MDD라 회복 가능하므로 meta 게이트 정상 작동)
- 캐시: `persist=true`+`force=false`이면 DB에서 로드. 10일 슬랙으로 "충분히 커버" 판단. force=true면 재수집해서 upsert
- `runner/backtest-cli.ts`는 결과를 `docs/backtest-reports/backtest-{timestamp}.md`로 저장
- `BacktestModule`은 `PrismaService`를 직접 provider로 등록 (다른 모듈처럼 `@Global` 의존이 아님 — standalone context이므로)
