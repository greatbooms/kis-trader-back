# OpenDART Module

## 책임
한국 금융감독원의 전자공시(OpenDART) API를 통해 국내 상장사의 공시·지분 정보를 조회. 스크리닝/딥 분석에서 펀더멘털·이벤트 시그널로 활용된다.

## 주요 서비스 / 컴포넌트
- `opendart.module.ts` — `OpenDartService`만 등록/export
- `opendart.service.ts` — `getDomesticSignals(stockCode)`: 종목코드 → corp_code 매핑 → 최근 공시(disclosures) + 대량보유(ownership) 조회 → 시그널 가공. 6시간 캐시(in-memory), 요청 간 120ms 인터벌
- `opendart-signal.util.ts` — `buildOpenDartDomesticSignals` 순수 함수. raw 공시 배열 → 자사주 매입/감자/배당 변경 등 의미있는 시그널 추출
- `types/` — `OpenDartDisclosureItem`, `OpenDartOwnershipItem`, `OpenDartDomesticSignals`

## 외부 의존성
- `axios`, `zlib` (corp_code zip 파일 inflate)
- `@nestjs/config` — `openDart.apiKey`

## 주의사항 / 비자명한 규칙
- **MarketDataModule(global)에서 import**: 일반 호출자는 `MarketDataCacheService` 경유 권장 (DB 영속화 캐시 추가)
- **corp_code 매핑**: 최초 호출 시 OpenDART corpCode.zip을 받아 inflate → 메모리에 stockCode→corpCode Map 캐시(24h). 종목코드는 6자리 숫자
- API 키 미설정 시 `isConfigured() === false` → `getDomesticSignals`는 `undefined` 반환
- 실패 시 30분 짧은 캐시(반복 실패 방지). 성공 시 6시간 캐시
- corpCode가 매핑되지 않는 종목(스팩, 신규 상장 등)은 `undefined` 캐시
- **공시 시그널 계산 로직(`buildOpenDartDomesticSignals`)은 unit test로 보존** (`opendart-signal.util.spec.ts`) — 시그널 정의 변경 시 테스트 함께 갱신
