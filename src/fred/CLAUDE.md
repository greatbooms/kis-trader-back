# FRED Module

## 책임
St. Louis Fed의 FRED API를 통해 매크로 경제 지표(연방기금 금리, 10년물 국채 등)의 최신 스냅샷을 조회. 시장 레짐 판단 / 전략 컨텍스트 보강에 사용된다.

## 주요 서비스 / 컴포넌트
- `fred.module.ts` — `FredService`만 등록/export
- `fred.service.ts` — `getLatestRateSnapshot(seriesId)`: FRED `series/observations` API에서 최근 관측치 2개를 받아 현재값/전일값을 반환. in-memory Map 캐시(6시간 TTL), 요청 간 120ms 인터벌
- `types/` — `FredRateSnapshot` 등

## 외부 의존성
- `axios` — REST 호출
- `@nestjs/config` — `fred.apiKey`

## 주의사항 / 비자명한 규칙
- **MarketDataModule(global)에서 import**: `MarketDataCacheService`가 FRED 데이터를 캐싱해 다른 모듈에 노출. 일반 코드는 `MarketDataCacheService` 경유 권장
- API 키 미설정 시 `isConfigured() === false` → `getLatestRateSnapshot`은 `undefined` 반환 (throw하지 않음)
- 캐시: 직접 in-memory Map (DB Snapshot은 사용하지 않음). 인스턴스 재시작 시 비워짐
- 실패 시 `logger.warn` + 30분 짧은 캐시로 `undefined` 저장(잘못된 값 반복 호출 방지). 성공 시 6시간 캐시
- **고정 series ID**: 호출자가 `'DFF'` (Federal Funds), `'DGS10'` (10Y) 등을 직접 넘김. 매핑은 호출자(주로 `MarketDataCacheService`) 책임
