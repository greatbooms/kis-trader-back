# Screening Module

## 책임
매일 국내/해외 시장에서 투자 매력도가 높은 종목을 자동 스크리닝하여 추천 리스트를 제공. 기본 지표 필터 → 다중 요인 점수화 → 전략 매칭 → DB 저장. 별도 schedule(국가별 09:10/00:10/00:30 KST 등)로 1차 fast 스크리닝 + 별도 시간대에 deep 분석을 실행한다.

## 주요 서비스
- `screening.service.ts` — 얇은 façade (public API 호환성)
- `screening-candidate-collector.service.ts` — 기본 필터로 후보 종목 수집
- `screening-analyzer.service.ts` — 다중 요인 점수 계산 및 전략 추천
- `screening-repository.service.ts` — 스크리닝 결과 저장/조회 쿼리
- `deep-analysis.service.ts` — 상세 딥 분석 (DCF / 리스크 / 배당 / 컨센서스)
- `day-trade-screening.service.ts` — 당일청산(변동성 돌파) 후보 선정 파이프라인. 08:30 KST에 전일 확정 일봉 기준 ETF 필터/점수화 → 기초지수 프록시 레짐 확인 → 최근 구간 미니 백테스트 → `DayTradeCandidate` 저장 → Slack 리포트 → 상위 N개 시뮬 세션 자동 투입
- `day-trade-selector.ts` — 데이트레이드 후보 순수 함수 (strict ETF 판별, MA20/ATR14/거래대금 계산, 기초지수 방향/레짐, 미니 백테스트, 하드 필터, 점수화). strategy-matcher의 momentum-breakout 게이트와 임계값 상수 공유
- `screening.scheduler.ts` — 1차/딥 스크리닝 cron 등록 (국가별 시간대 분리, `screening-scheduler-runs` 키로 실행 상태 영속화). Slack 리포트 전송 트리거
- `screening.resolver.ts` — `recommendations` / `screeningDateSummaries` / `stockDeepAnalysis` 등 조회 query, `runScreening` mutation
- `multi-factor-scorer.ts` / `strategy-matcher.ts` — 점수화/전략 매칭 순수 유틸
- `utils/` — `date.util.ts` (스크리닝 전용 KST 날짜 헬퍼). 다른 utility들(`api-data`, `consensus`, `dividend`)은 cross-module 사용으로 `src/common/utils/`로 이전됨
- `types/screening.type.ts` — `StockScore`, `ScreeningMode`, `CountryConfig`, `detectEtf` 등
- `dto/` — GraphQL ObjectType/Input (factor score, deep analysis, settings 등)

## 외부 의존성
- `@prisma/client` — `StockRecommendation`, `StockDeepAnalysis`, `Setting`(스케줄러 상태), `ScreeningResult` 등
- `KisModule` — 종목 검색/시세/재무 (`KisDomesticService`, `KisOverseasService`)
- `TradingModule` — `MarketAnalysisService`, `StrategyRegistryService` (지표/전략 공유)
- `MarketDataModule` (Global) — `MarketDataCacheService` (재무/공시/매크로 시그널)
- `StockMasterModule` — 종목 마스터 fallback (종목명 보강)
- `NotificationModule` — Slack 딥 분석 리포트 송신

## 주의사항
- `ScreeningService`의 public API는 resolver/scheduler에서 사용 — 시그니처 보존
  - `screenDomestic` / `screenOverseas` — 1차 파이프라인
  - `saveResults` / `getLatestRecommendationDate` / `getRecommendations` / `getScreeningDates` / `getScreeningDateSummaries` / `getStockDeepAnalysis` — 결과 조회/저장
  - `runDeepAnalysisForMarket` — 딥 분석 일괄 실행
- 각 서비스는 자신의 책임 외 state 변경 금지
  - `CandidateCollector`는 DB 저장하지 않음 (API 수집만)
  - `Analyzer`는 DB 저장하지 않음 (in-memory 점수만 반환)
  - `Repository`는 계산하지 않음 (Prisma CRUD + 단순 payload 변환만)
- 순환 의존 회피:
  - `CandidateCollector` → `Kis*`, `StockMasterService`
  - `Analyzer` → `Kis*`, `MarketAnalysis`, `StrategyRegistry`, `MarketDataCache`, `DeepAnalysis`(DCF 호출)
  - `Repository` → `Prisma`만
  - 세 서비스는 서로 참조하지 않는다 — 조율은 `ScreeningService` 파사드가 담당
- `saveResults` / `getRecommendations`에서 `StrategyRegistry`로 실행 가능 전략만 남기는 필터는 facade가 `Analyzer.filterExecutableStrategies`를 콜백으로 넘겨 Repository에서 적용 (Repository가 StrategyRegistry에 의존하지 않도록 유지)
- 신규 코드는 `ScreeningCandidateCollector` / `ScreeningAnalyzer` / `ScreeningRepository` 중 해당 책임의 서비스를 직접 주입할 것을 권장
- 딥 분석은 별도 스케줄(`runDeepAnalysisForMarket`)에서 실행되며 `DeepAnalysisService`를 재사용하여 상세 DCF/리스크 리포트를 생성
- **분석 후보 상한**: 국내 30개, 해외 25개 (`MAX_DOMESTIC_ANALYSIS_CANDIDATES` / `MAX_OVERSEAS_ANALYSIS_CANDIDATES`) — KIS rate limit + 분석 시간 균형
- **데이터 가용성 필터**: `dataAvailability < 30`인 점수는 결과에서 제외 (재무 데이터 부족 종목 제외)
- **스케줄러 상태 영속화**: `Setting` 테이블에 `screening-scheduler-runs` 키로 마지막 실행 결과 저장 — UI에서 확인 가능
- cross-module 공유 utility는 `src/common/utils/`에 위치 — `trading-orchestrator`/`screening-analyzer`/`deep-analysis`가 모두 거기서 import. 시그니처 변경 시 3곳 영향
- **데이트레이드 스크리닝(`day-trade-fast`)의 비자명한 규칙**:
  - 실행 시간 08:30 KST 근거: 후보 선정 입력(전일 변동폭·MA20·거래대금)이 모두 전일 장 마감에 확정되므로 장 시작 전에 선정하고, 당일 적용 유의종목/거래정지 상태를 같은 시점에 반영한다. 기존 09:10 투자 스크리닝과 별개 파이프라인 (목적·기준·산출물이 다름)
  - 유니버스: 시드 ETF 상수(`DAY_TRADE_SEED_ETFS`) ∪ 거래량/등락률 랭킹 내 strict ETF. 08:30 랭킹 응답이 전일 기준/빈 값이어도 시드가 안전망. ETN/스팩은 제외 (발행사 신용·유동성 구조가 당일청산 시장가 전략에 부적합)
  - 임계값 근거: 평균 거래대금 ≥ 300억(시장가 슬리피지 무시 수준), ATR14% ≥ 1.2(왕복 비용 ~0.3% 대비 4배), 전일 종가 > MA20(백테스트 2023-06~2026-05에서 MA20 위 레짐만 양의 엣지). momentum-breakout 백테스트 결론(거래세 면제 ETF만 양의 기대값)이 전체 설계의 근거 — `src/backtest/CLAUDE.md` 참조
  - 기초지수 프록시: KOSPI200 계열은 `069500 KODEX 200`, KOSDAQ150 계열은 `229200 KODEX 코스닥150`을 사용. 롱/레버리지는 프록시가 `TRENDING_UP`, 인버스는 `TRENDING_DOWN`일 때만 통과. 매핑 없는 인버스는 fail-closed
  - 최근 미니 백테스트: 같은 전일 필터(MA20/ATR/거래대금)와 기초지수 레짐을 과거 봉에 적용한 뒤, K=0.5 돌파 진입·-2% 손절·종가 청산·ETF 비용/슬리피지를 반영한다. 최소 5회 거래, 평균/누적 기대값이 양수일 때만 통과
  - 거래대금은 종가×거래량 근사 (KIS 일봉 응답에 거래대금 필드 없음)
  - 봉 부족(확정 일봉 20개 미만) 종목은 하드필터 탈락이 아닌 평가 전제조건 미달 — DB 저장 없이 `log` 레벨로만 추적
  - 평가 가능 종목이 0개면 throw → 스케줄러가 `failed`로 기록 (시드 ETF는 항상 이력이 있으므로 0개 = KIS 장애가 "후보 없음"으로 위장되는 것 방지)
  - 같은 날 재실행 시 이번 평가에 없는 잔존 후보는 `deleteMany`로 정리 (스테일 rank/score 방지)
  - `screeningDate`는 `kstTodayStr()` 포맷(YYYYMMDD) — `StockRecommendation.screeningDate`와 동일 컨벤션
  - [DT] 시뮬 세션 라이프사이클: 다음 날 08:30 잡이 포지션 없는 세션만 COMPLETED 처리. 포지션이 남은 세션은 전략의 이월청산이 동작하도록 RUNNING 유지 + Slack 경고. `strategyParams.dayTradeAuto=true`가 자동 세션 마커
  - 설정: `AppSetting` 키 `day-trade-screening` = `{ enabled, topN(기본 3), simCapital(기본 200만) }`. 실거래 자동 등록은 범위 외 (시뮬 검증 후 별도 설계)
- **momentum-breakout 추천 게이트** (`strategy-matcher.ts`): 국내 + `isStrictKrxEtf`(ETN/스팩 차단) + MA20 위 + `atrPercent ≥ DAY_TRADE_MIN_ATR_PCT`일 때만 추천에 노출. 일반 주식은 거래세(0.18%)가 gross 엣지보다 커서 게이트에서 차단
- `ScreeningModule` → `SimulationModule` 의존 ([DT] 세션 생성/정리용, `SimulationSessionManager` 사용). 역방향 의존 금지 (순환)
