# Backtest Module

## 책임
실전 전략(`InfiniteBuyStrategy` 등 `src/trading/strategy/`)을 과거 OHLCV 데이터에 적용해 성과를 평가. CLI 기반 standalone 실행이며, 결과는 마크다운 리포트로 저장된다. 운영 NestJS 앱(`AppModule`)에는 포함되지 않는 별도 실행 모듈.

## 주요 서비스 / 컴포넌트
- `backtest.module.ts` — DB 캐시(`HistoricalDailyPrice`) + KIS API 수집 모드. `BacktestCLI`가 사용
- `backtest-memory.module.ts` — DB 의존 없이 매번 KIS API에서 수집해 in-memory로만 백테스트 (테스트/즉석 실험용)
- `data/historical-collector.service.ts` — KIS daily price 수집 + DB upsert. 7일 슬랙으로 캐시 hit 판정, 거래소 종류별로 from/to ↔ count 환산
- `data/indicator-calculator.ts` — 순수 함수형 SMA/RSI/ATR/ADX/Bollinger 계산. **chronological order(0=oldest)** — `market-analysis.service.ts`와 다름
- `engine/backtest.engine.ts` — `runBacktest()`. `PerStockTradingStrategy.evaluate`를 호출 → 가상 limit 주문 큐 처리 → 슬리피지 적용 체결 → daily portfolio value 기록
- `engine/metrics.ts` — `computeMetrics()`. CAGR / Sharpe / MDD / win rate / profit factor 계산 (252 거래일 기준)
- `runner/backtest-cli.ts` — `npm run backtest` 엔트리. CLI 인자(`--from`, `--to`, `--policies`, `--tickers`) 파싱, 다중 정책×다중 티커 매트릭스 실행, 마크다운 리포트 생성

## 외부 의존성
- `@nestjs/core` (NestFactory.createApplicationContext) — standalone Nest app
- `KisModule` — 과거 시세 수집
- `InfiniteBuyStrategy` (from `TradingModule`) — 평가 대상 전략
- `@prisma/client` — `HistoricalDailyPrice`, `Market` enum
- 표준 lib: `fs`, `path`

## 주의사항 / 비자명한 규칙
- **AppModule에 import되지 않음**: NestFactory standalone context로만 부팅. `npm run backtest` 스크립트로 실행
- **OHLCV 인덱스 컨벤션 차이 주의**: `indicator-calculator.ts`는 chronological(0=oldest), 운영 `market-analysis.service.ts`는 reverse-chronological. 실전 코드와 함께 수정할 때 인덱스 방향 헷갈리지 말 것
- 해외 KIS API는 from/to 미지원 → `count` 기반. `(days/365 * 252 * 1.3)` 추정치로 환산 (max 2000)
- 슬리피지 기본 0.5% (`DEFAULT_SLIPPAGE`). infinite-buy의 limit 주문은 다음 거래일 종가 기준 만료
- 워밍업 기본 200봉 (MA200 계산용). 부족하면 그 시점까지 거래 발생 X
- 캐시: `persist=true`+`force=false`이면 DB에서 로드. 7일 슬랙으로 "충분히 커버" 판단. force=true면 재수집해서 upsert
- `runner/backtest-cli.ts`는 결과를 `docs/backtest-reports/backtest-{timestamp}.md`로 저장
- `BacktestModule`은 `PrismaService`를 직접 provider로 등록 (다른 모듈처럼 `@Global` 의존이 아님 — standalone context이므로)
