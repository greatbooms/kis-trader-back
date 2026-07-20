# Trade Record Module

## 책임
실거래 결과(`TradeRecord`)·포지션(`Position`)·계좌 요약·시세 조회를 외부에 노출하는 read-mostly 레이어. 대시보드/포지션 페이지 등 프론트가 사용하는 GraphQL query의 백엔드. 신규 주문 생성은 **여기서 하지 않고** `TradingModule`이 담당 — 단, **수동 매도(`manualSell`)와 주문 취소(`cancelTradeOrder`)** 는 전용 서비스에서 운영 편의를 위해 직접 KIS API 호출.

## 주요 서비스 / 컴포넌트
- `trade-record.module.ts` — 조회 서비스와 수동 주문 서비스를 export. `TradingModule`을 직접 import
- `trade-record.service.ts` — `findAll`/`findOne` (TradeRecord 검색), `findPositions`, `getDashboardSummary`, `getAccountSummary`, `getDomesticQuote*`/`getOverseasQuote*` (시세+기술지표), `refreshAccountState`
- `trade-record-manual-order.service.ts` — `manualSell`, `cancelTradeOrder`와 취소 실패 시 브로커 주문 스냅샷 확인
- `trade-record.resolver.ts` — 위 메서드를 wrapping한 GraphQL query/mutation. Decimal → Number 변환, 인증 가드(`GqlAuthGuard`)
- `dto/` — TradeRecord/Position/StockPrice/AccountSummary/QuoteHistoryPoint 등 GraphQL ObjectType 12개 + Input 6개 (1타입 1파일)
- `types/` — `AccountCashBalance`, `AccountStatusCache` (in-memory 캐시 키)

## 외부 의존성
- `@prisma/client` — `TradeRecord`, `Position`, `Market`/`Side`/`OrderStatus`/`OrderType` enum
- `KisModule` — 시세/잔고/주문 취소
- `TradingModule` — `MarketAnalysisService` (technical ratings 계산)
- `@nestjs/config` — `trading.enabled`

## 주의사항 / 비자명한 규칙
- **읽기 전용 흐름이 메인**: TradeRecord 생성은 `TradingService`가 담당. 이 모듈은 조회 + 수동 운영 액션만
- **수동 매도/취소는 예외**: `TradeRecordManualOrderService.manualSell`은 KIS 직접 호출 + DB 기록. `cancelTradeOrder`도 마찬가지. **`trading.enabled=false`면 차단**(`TradingLiveSwitchService` 가드). 수동 매도 수량은 생략한 경우에만 전량으로 해석하고, 명시값은 1 이상의 안전한 정수만 허용한다. 수동 매도는 `submissionStartedAt` CAS 직후 broker context와 live switch를 다시 확인하고, 실패 시 정확한 timestamp의 claim만 `CANCELLED`로 되돌린 뒤 POST하지 않는다.
- 수동 주문·취소도 KIS POST는 한 번만 호출한다. `SUBMISSION_UNKNOWN` 또는 취소 `SUBMITTING`/`ACCEPTED`/`UNKNOWN` 상태에서는 중복 mutation을 막고, Slack/웹 공용 복구 흐름으로만 확정한다.
- GraphQL `TradeRecordType`은 취소 버튼 가드를 위해 `cancellationStatus`, `cancellationMessage`, `brokerMessage`를 노출한다. raw 계좌나 broker account hash는 노출하지 않는다.
- **Decimal 직렬화**: Prisma `Decimal` → GraphQL Float 변환은 resolver에서 명시적으로 `Number()` 처리 (`positions` resolver 참고). DTO에 자동 변환 없음
- **`profitRate`는 % 단위로 저장됨** → resolver에서 `/100`로 decimal 변환해 응답
- 대시보드 요약(`getDashboardSummary`)은 모든 `FILLED` TradeRecord를 in-memory aggregate — TradeRecord 수가 매우 커지면 성능 검토 (현재는 수천 건 수준)
- 시세 조회(`getDomesticQuote`/`getOverseasQuote`)는 KIS API + `MarketAnalysisService.calculateTechnicalRatings` 합쳐서 반환 — 한 번에 RSI/MA/ATR 등 표시
- **`refreshAccountState`**: KIS broker 잔고를 강제 동기화하고 exported `TradingAccountCashSyncService.replaceCache`로 `AccountStatusCache`를 원자적으로 갱신. resolver에서 직접 호출 가능 — 운영 중 잔고 불일치 발생 시 사용
- 신주문 생성이 필요한 흐름은 반드시 `TradingService` 경유: 이 모듈에서 새 BUY 주문을 만들지 않을 것
