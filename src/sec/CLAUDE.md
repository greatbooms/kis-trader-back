# SEC Module

## 책임
미국 SEC EDGAR API에서 상장사 펀더멘털(Company Facts XBRL)과 최근 filing 정보를 조회. 스크리닝/딥 분석의 미국 종목 펀더멘털 평가에 사용.

## 주요 서비스 / 컴포넌트
- `sec.module.ts` — `SecService`만 등록/export
- `sec.service.ts` — `getFundamentals(symbol, currentPrice)`: ticker → CIK 매핑 → `companyfacts/CIK{...}.json` 조회 → US-GAAP 컨셉(Revenues, NetIncome, Assets 등) 정규화 → 연간/분기 metric 추출. ticker map 24h 캐시, fundamentals 6h 캐시. 지수 backoff 최대 5회 재시도
- `types/` — `SecFundamentals` 등

## 외부 의존성
- `axios`
- `@nestjs/config` — `sec.userAgent`

## 주의사항 / 비자명한 규칙
- **MarketDataModule(global)에서 import**: 일반 호출자는 `MarketDataCacheService.getSecFundamentals`(또는 동등) 경유 권장
- **SEC User-Agent 필수**: SEC EDGAR는 식별 가능한 UA(이메일 포함)를 요구. `SEC_USER_AGENT` 미설정 시 `isConfigured() === false`로 호출 안 됨 → 미국 종목 펀더멘털 데이터 누락
- **요청 간 120ms 인터벌** (`REQUEST_INTERVAL_MS`) — SEC 가이드라인(10 req/s) 준수
- **재시도 로직** (`MAX_FETCH_ATTEMPTS=5`, `INITIAL_RETRY_DELAY_MS=500`): fetch 실패 시 에러 종류 구분 없이 지수 backoff로 최대 5회 재시도
- ticker → CIK 매핑은 `company_tickers.json` 또는 SEC 데이터로 캐싱. 누락 ticker는 `undefined` 반환
- 분기/연간 form 분류: `ANNUAL_FORMS` (10-K, 20-F, 40-F 외국인 포함), `QUARTERLY_FORMS` (10-Q, 6-K 외국인 포함). 6-K는 일부만 분기 정보 — 호출자 검증 필요
- `currentPrice`를 인자로 받는 이유: P/E, P/B 등 valuation metric을 SEC 펀더멘털 + 실시간 가격으로 직접 계산
- `forceRefresh=true`로 호출하면 캐시 우회 + 재로드
