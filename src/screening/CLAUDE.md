# Screening Module

## 책임
매일 국내/해외 시장에서 투자 매력도가 높은 종목을 자동 스크리닝하여
추천 리스트를 제공. 기본 지표 필터 → 다중 요인 점수화 → 전략 매칭 → DB 저장.

## 주요 서비스
- `screening.service.ts` — 얇은 façade (public API 호환성)
- `screening-candidate-collector.service.ts` — 기본 필터로 후보 종목 수집
- `screening-analyzer.service.ts` — 다중 요인 점수 계산 및 전략 추천
- `screening-repository.service.ts` — 스크리닝 결과 저장/조회 쿼리
- `deep-analysis.service.ts` — 상세 딥 분석 (DCF / 리스크 / 배당 / 컨센서스)

## 외부 의존성
- `@prisma/client` — StockRecommendation, StockDeepAnalysis 테이블
- `KisModule` — 종목 검색/시세 조회 (`KisDomesticService`, `KisOverseasService`)
- `TradingModule` — `MarketAnalysisService`, `StrategyRegistryService` (지표/전략 공유)
- `MarketDataModule` (Global) — `MarketDataCacheService` (재무/공시 시그널)
- `StockMasterModule` — 종목 마스터 fallback
- `multi-factor-scorer` / `strategy-matcher` (내부 유틸)

## 주의사항
- `ScreeningService`의 public API는 resolver/scheduler에서 사용 — 시그니처 보존
  - `screenDomestic` / `screenOverseas` — 파이프라인
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
- `saveResults` / `getRecommendations`에서 `StrategyRegistry`로 실행 가능 전략만 남기는 필터는
  facade가 `Analyzer.filterExecutableStrategies`를 콜백으로 넘겨 Repository에서 적용
  (Repository가 StrategyRegistry에 의존하지 않도록 유지)
- 신규 코드는 `ScreeningCandidateCollector` / `ScreeningAnalyzer` / `ScreeningRepository` 중
  해당 책임의 서비스를 직접 주입할 것을 권장
- 딥 분석은 별도 스케줄 (`runDeepAnalysisForMarket`)에서 실행되며
  `DeepAnalysisService`를 재사용하여 상세 DCF/리스크 리포트를 생성
