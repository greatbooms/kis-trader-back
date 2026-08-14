# 멀티 브로커 아키텍처 스펙 (KIS + 토스증권)

> 상태: 설계 초안 (구현 전) · 작성 2026-08-14
> 관련: `docs/infinite-buy-v4-spec.md`, `src/trading/CLAUDE.md`, `src/kis/CLAUDE.md`

## 1. 목표

- 한 시스템에서 **여러 증권사 계좌를 동시에 상시 운용**한다. 같은 종목(예: TQQQ)을 KIS와 토스에 각각 보유하고, 각자 독립된 전략·quota·장부로 운용한다.
- **트레이딩 유닛 = (broker, market, exchangeCode, stockCode)**. 매수·매도·취소는 해당 유닛이 속한 증권사 API로만 나간다.
- 전략 입력(시세·재무·스크리닝)은 증권사와 무관한 **단일 데이터 층**에서 공급한다.

### 비목표 (이번 스펙에서 제외)

- 증권사 간 주식 이관 자동화 — API 미지원(양사 확인 완료). 이관은 사용자가 앱에서 수동 수행
- 증권사 간 현금 이체 자동화 — 금지 영역. 사용자 수동
- 크로스 브로커 통합 주문(스마트 라우팅) — 유닛 독립 원칙에 반함
- 토스 시세를 스크리닝/전략 입력으로 사용 — 후속 과제 (D3)

## 2. 결정 사항

### D1. 스키마는 재키잉이 아니라 `broker` 컬럼 추가로 확장한다

`Broker` enum(`KIS`, `TOSS`)을 신설하고 `WatchStock`, `Position`, `TradeRecord`, `RiskSnapshot`, `StrategyAllocation`에 `broker Broker @default(KIS)` 컬럼을 추가한다. unique 키는 `[market, exchangeCode, stockCode]` → `[broker, market, exchangeCode, stockCode]`로 확장한다.

**근거**: 기존 데이터는 전부 KIS이므로 `@default(KIS)` 백필로 마이그레이션이 무손실·무정지다. `BrokerAccount` 테이블(계좌 다중화)은 "증권사당 계좌 1개"인 현재 요구에서 YAGNI — 증권사당 복수 계좌가 필요해지는 시점에 추가한다.

### D2. 주문·계좌 API는 `BrokerPort` 인터페이스로 추상화한다

`src/common/types/broker-port.type.ts`에 정의. **broker당 포트 1개**(시장별 아님)이며, 현재 trading/trade-record 모듈에 정형화되어 있는 `market === 'DOMESTIC' ? kisDomestic.X : kisOverseas.X` 분기(10개 파일 ~35곳)를 포트 내부로 흡수한다.

```ts
export interface BrokerPort {
  readonly broker: Broker;                    // 'KIS' | 'TOSS'
  // 주문 — market/side dispatch는 어댑터 책임
  submitOrder(signal: TradingSignal): Promise<OrderResult>;
  cancelOrder(req: BrokerCancelRequest): Promise<OrderResult>;   // { market, exchangeCode, orderNo, stockCode, qty, price }
  // 체결/미체결
  getUnfilledOrders(market: Market): Promise<UnfilledOrder[]>;
  getOrderExecutions(market: Market, startDate: string, endDate: string): Promise<BrokerOrderStatus[]>;
  // 계좌 — 국내/해외 반환 형태가 달라 시장별 메서드를 분리 (형태 병합 금지)
  getBalance(market: Market): Promise<BalanceItem[]>;
  getDomesticBuyableAmount(): Promise<DomesticBuyableAmount>;
  getOverseasBuyableAmount(exchangeCode: string, stockCode: string, price: number): Promise<{ foreignCurrencyAvailable: number; maxQuantity: number }>;
  getOverseasAccountSnapshot(nationCode?: string): Promise<OverseasAccountSnapshot>;
  // 컨텍스트 (D6)
  getBrokerContext(): { broker: Broker; environment: BrokerEnvironment; accountHash: string };
}
```

- `TradingSignal`에 `broker: Broker` 필드를 추가한다 (Phase 1에서는 항상 `KIS`)
- KIS 어댑터(`KisBrokerAdapter`): 기존 `KisDomesticService`/`KisOverseasService`를 감싸는 얇은 래퍼 — market dispatch만 수행, 로직 없음
- 토스 어댑터: `src/toss/`에 신규 구현. 토스 응답을 공유 반환 타입(`OrderResult`, `BalanceItem` 등 — `src/kis/types/`에서 `src/common/types/`로 이동)에 매핑. 토스 API는 시장 통합형이라 이 포트 형태와 자연스럽게 일치
- 조회는 `BrokerPortRegistry.get(broker): BrokerPort` — DI 기반 맵. 미등록 broker는 throw (fail-closed)
- **포트 범위는 주문·계좌·체결뿐**: 시세/랭킹/휴장일 등 데이터 조회는 D3에 따라 KIS 서비스 직접 호출을 유지한다

**근거**: 국내/해외 KIS 시그니처가 달라(예: `getBuyableAmount` 인자·반환 상이) 단일 시그니처 승격이 불가능하다. signal 기반 포트는 기존 분기 패턴을 어댑터로 옮기는 것이라 소비자 수정이 기계적이고, 반환 타입을 공유하므로 하류 로직은 불변이다.

### D3. 시세·스크리닝·재무는 당분간 KIS 단일 소스를 유지한다

`MarketDataCacheService`, `MarketAnalysisService`, screening 모듈은 변경하지 않는다. 시세는 증권사 중립 데이터이므로 이원화할 이유가 없다. KIS 계좌는 잔고가 소진되어도 시세 조회용으로 유지 가능하다.

**후속**: 토스 `/prices`의 200종목 배치 조회는 시세 캐시 효율 개선 여지가 있으나 별도 과제로 분리한다. 단, 토스 API가 KIS 시세 없이도 주문가 검증이 가능하도록 어댑터 내부에서 `getPrice`는 토스 `/prices`로 구현한다 (KIS 장애 시 토스 유닛은 독립 동작).

### D4. 주문 라우팅의 진실은 `WatchStock.broker`다

- 전략 평가 → 신호 생성 시 orchestrator가 `watchStock.broker`를 signal에 태깅
- `TradingBrokerOrderSubmissionService.submit(signal)`이 `BrokerPortRegistry.get(signal.broker, signal.market)`으로 어댑터를 선택 — **주문 mutation gateway 단일 진입 원칙은 유지**
- 매도·취소·승인 SELL도 동일: `TradeRecord.broker`(주문 생성 시 기록)를 따른다
- 수동 주문(`manualSell` 등)은 입력에 broker를 명시받는다

### D5. 토스 환경은 항상 `PROD`다 (모의투자 없음)

`BrokerEnvironment` enum은 유지하되 토스 어댑터는 `PAPER`를 지원하지 않는다 (설정 시 부팅 에러). 토스 유닛의 전략 검증은 simulation 모듈 또는 소액 실계좌로 수행한다. `trading.enabled` 라이브 스위치는 기존대로 전역 가드이며, 추가로 **broker별 enable 스위치**(`trading.brokers.kis.enabled`, `trading.brokers.toss.enabled`)를 둔다 — 한쪽 증권사만 끌 수 있어야 장애 대응이 된다.

### D6. broker context 검증은 broker 스코프로 확장한다

`TradingBrokerContextService`의 컨텍스트가 `{environment, accountHash}` → `{broker, environment, accountHash}`로 확장된다. `TradeRecord`에 이미 있는 `brokerEnvironment`/`brokerAccountHash`에 D1의 `broker` 컬럼이 더해져 3-tuple이 된다.

승인 workflow·복구·취소 서비스의 "현재 KIS context와 비교" 로직은 전부 "**해당 record의 broker에 대한 현재 context**와 비교"로 바뀐다. 비교 시점·CAS·fail-closed 원칙은 그대로 유지한다 (`src/trading/CLAUDE.md`의 SELL 승인/복구 경계 규칙 전체가 broker 파라미터만 추가된 채 유효).

### D7. 현금·quota 장부는 broker 스코프다

- `account_status_cache`: 키가 `(market)` → `(broker, market)`. advisory lock 키도 동일 확장
- `TradingAccountCashSyncService.refreshMarketCash(market)` → `refreshMarketCash(broker, market)`
- V4 quota 장부(`WatchStock.strategyParams.v4`)는 WatchStock row에 붙어 있으므로 D1만으로 자동으로 broker별 분리된다 — 추가 작업 없음. D10(quota→장부 연동)도 row 단위라 그대로 유효
- 크로스 브로커 현금 이동은 시스템 밖(수동). 장부는 각 증권사 예수금만 신뢰한다

### D8. 크로스 브로커 리스크는 합산 모니터링만 한다

- 주문 차단 규칙(포트폴리오 비중, MDD 등)은 **계좌(broker) 단위**로 평가 — 유닛 독립 원칙
- 단, `RiskSnapshot`을 broker별로 남기고, 일일 리스크 알림에 **종목별 크로스 브로커 합산 노출**(예: "TQQQ 총 노출: KIS $8k + TOSS $5k")을 추가한다. 차단은 하지 않고 가시화만 한다

**근거**: 합산 차단을 넣으면 "토스 TQQQ 전략이 KIS TQQQ 보유 때문에 매수 불가" 같은 유닛 간 간섭이 생겨 A/B 목적 자체를 해친다. 위험 가시성은 알림으로 확보한다.

### D9. 주문 유형 매핑

| 내부 (signal/OrderType) | KIS | 토스 |
|---|---|---|
| LIMIT (`orderDivision '00'`) | 지정가 `00` | `orderType: LIMIT, timeInForce: DAY` |
| LOC (`orderDivision '34'`) — V4 필수 | LOC `34` | `orderType: LIMIT, timeInForce: CLS` |
| MARKET | 시장가 | `orderType: MARKET` |

토스 어댑터는 `orderDivision` 문자열을 위 표로 변환한다. 매핑 불가한 division은 throw (fail-closed).
주문 식별: KIS는 `orderNo`+주문일자, 토스는 `orderId`(UUID). `TradeRecord.orderNo`에 토스 `orderId`를 그대로 저장한다 (컬럼 공유, broker로 해석 구분).

### D10. 토스 rate limit은 API 그룹별 큐로 관리한다

`TossBaseService`가 `KisBaseService`의 직렬화 큐 패턴을 그룹별 인스턴스로 재사용한다:

| 그룹 | 한도(TPS) | 큐 간격 |
|---|---|---|
| ORDER | 10 | 100ms |
| ORDER_INFO | 6 (장초반 3) | 170ms (장초반 340ms) |
| ACCOUNT | 1 | 1,000ms |
| ASSET | 5 | 200ms |
| MARKET_DATA | 15 | 67ms |

**주의**: ACCOUNT 1/s 때문에 "주문 직전 재동기화"(`TradingPositionRefreshService`)가 토스에서 병목이 될 수 있다. 잔고 조회는 ASSET 그룹(`/holdings`, 5/s)을 사용하고, ACCOUNT 그룹(`/accounts`)은 부팅·주기 동기화에만 쓴다.

### D11. 토스 인증은 in-memory 토큰 캐시로 충분하다

OAuth2 Client Credentials는 상태 없는 재발급이 가능하고 AUTH 그룹 한도(5/s)가 넉넉하므로 `KisToken`류 DB 영속화를 하지 않는다. 만료 전 갱신 + 401 시 1회 재발급. client id/secret은 `ConfigService` 경유 (`toss.appKey`, `toss.appSecret`, `toss.accountNo` — `.env`에만). 계좌 API 호출 시 `X-Tossinvest-Account` 헤더 필수.

## 3. 신규 모듈: `src/toss/`

```
src/toss/
├── toss-auth.service.ts        # OAuth2 토큰 발급/캐시/갱신
├── toss-base.service.ts        # HTTP + 그룹별 rate limit 큐 + 에러 정규화
├── toss-broker.service.ts      # BrokerPort 구현 (주문/잔고/체결 — 응답 매핑 포함)
├── toss-mutation.error.ts      # KisMutationError 대응물 (UNKNOWN 판별 계약 동일)
├── types/                      # 토스 API 원시 응답 타입
├── toss.module.ts              # TossBrokerService만 export
└── CLAUDE.md
```

- Base URL `https://openapi.tossinvest.com`, OpenAPI 스펙 v1.2.x가 계약 문서 (`https://openapi.tossinvest.com/openapi-docs/latest/openapi.json`)
- **UNKNOWN 판별 계약**: 주문 POST의 timeout/5xx/불명 응답은 `KisMutationError`와 동일한 의미론("제출 여부 불명")으로 던져야 기존 `SUBMISSION_UNKNOWN` 복구 파이프라인이 그대로 동작한다. 이 계약 위반은 자금 사고로 직결되므로 어댑터 스펙에서 최우선 검증 항목
- 체결 동기화: `getOrderExecutions` = `GET /api/v1/orders`(기간 필터) + 상태 매핑, `getUnfilledOrders` = 동일 endpoint의 미종결 상태(`PENDING`/`PARTIAL_FILLED` 등) 필터
- 토스 `OrderStatus` → 내부 enum 매핑: `FILLED→FILLED`, `PARTIAL_FILLED→PARTIAL`, `PENDING/PENDING_*→PENDING`, `CANCELED→CANCELLED`, `REJECTED→FAILED`, `REPLACED`는 신규 주문으로 재연결

## 4. 변경 지점 요약 (trading 모듈)

| 서비스 | 변경 |
|---|---|
| `TradingBrokerOrderSubmissionService` | 어댑터 선택을 `BrokerPortRegistry`로 위임 (KIS 직접 주입 제거) |
| `TradingOrchestratorService` | WatchStock을 `(broker)` 그룹으로 나눠 루프. `isRunning` mutex를 broker×market으로 |
| `TradingPositionSyncService` / `TradingPositionRefreshService` | `refresh(broker, market)` — 대상 broker 잔고만 조회/동기화 |
| `TradingAccountCashSyncService` | D7 (키 확장) |
| `MarketStateSyncService` | open order/포트폴리오 동기화를 broker별 수행. 휴장일 판단은 시장 기준이므로 공용 유지 |
| `TradingOrderReconciliationService` | broker별 체결 조회로 분리 실행. Slack 체결 알림에 broker 태그 |
| 승인 workflow / 복구 / 취소 계열 | D6 (context 3-tuple), 로직 구조 불변 |
| 로그 prefix | `[${stockCode}]` → `[${broker} ${stockCode}]` |

GraphQL/프론트: WatchStock CRUD input/object에 `broker` 필드 추가(기본 KIS), 포지션·미리보기 화면 broker 구분 표시, `npm run client:codegen` 재생성.

## 5. 롤아웃 순서

1. **Phase 0 — 스키마**: `Broker` enum + 컬럼 5곳 + unique 키 확장. 마이그레이션 1개. 기존 동작 무변경 (전부 KIS 기본값)
2. **Phase 1 — BrokerPort 추상화**: 인터페이스 정의, KIS 래퍼 어댑터, registry, gateway/sync 계열 라우팅 전환. **토스 없이 KIS 단일로 기존 테스트 전부 통과가 게이트**
3. **Phase 2 — 토스 어댑터**: `src/toss/` 구현 + 유닛 테스트 (UNKNOWN 계약, 상태 매핑, rate limit 큐, LOC 매핑 중점)
4. **Phase 3 — 운영 배선**: broker별 enable 스위치, orchestrator broker 루프, context 3-tuple, 로그/Slack 태그, GraphQL/프론트
5. **Phase 4 — 검증 운용**: 토스에 소액 WatchStock 1종목(TQQQ, quota 최소)으로 1~2주 병행. 체결·reconciliation·복구 경로 실사고 없이 통과 후 본 운용
6. **Phase 5 (후속, 별도 과제)**: 토스 배치 시세 활용, 조건주문(STOP/OCO) 서버사이드 손절 위임 검토

각 Phase는 독립 브랜치·독립 배포 가능 단위다. Phase 1이 가장 큰 리팩토링이며 여기까지는 **행동 보존**(기능 변화 0)이어야 한다.

## 6. 리스크와 완화

| 리스크 | 완화 |
|---|---|
| 토스 API 신생(2026-08-13 정식 출시) — 장애 이력 없음 | Phase 4 소액 병행 기간, broker별 kill switch (D5) |
| 주문 POST 결과 불명 처리 차이 | UNKNOWN 판별 계약을 어댑터 유닛 테스트로 고정 (§3) |
| ACCOUNT 1/s 병목 | 잔고는 ASSET 그룹 사용 (D10) |
| 수동 이관으로 잔고-DB 불일치 | V4는 기존 정책 유지: 장부-보유 불일치 시 흡수하지 않고 평가 중단. 이관은 해당 유닛 전략 off 상태에서 수행하는 운영 수칙을 CLAUDE.md에 기록 |
| context 검증 누락 (broker 축 추가 과정의 회귀) | 기존 approval/recovery spec 테스트에 broker 불일치 케이스 추가를 Phase 1 게이트에 포함 |

## 7. 열린 질문 (구현 전 확인)

1. 토스 오픈API 앱 키 발급 — 사용자가 토스 앱/신청 페이지에서 직접 발급 필요 (client id/secret)
2. 국내주식도 토스 유닛을 쓸 계획인지 — 스펙은 양시장 지원으로 설계하되, 초기 운용은 해외(V4)만 가정
3. 토스 주문 API의 정정(`modify`) 사용 여부 — 현재 시스템은 취소 후 재주문 패턴이므로 어댑터에서 `modify` 미구현 (YAGNI)
