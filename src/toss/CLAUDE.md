# Toss Module

## 책임

토스증권 Open API의 OAuth2 인증, API 그룹별 rate-limit 큐, HTTP 오류 정규화, `BrokerPort` 응답 매핑을 담당한다. Phase 3부터 명시적으로 활성화된 TOSS WatchStock의 운영 주문·동기화 경로에 사용한다.

## 주요 서비스 / 컴포넌트

- `toss-auth.service.ts` — in-memory OAuth2 토큰 캐시와 single-flight 재발급
- `toss-base.service.ts` — 인증 헤더, 그룹별 직렬화 큐, 401 1회 재시도, mutation UNKNOWN 정규화
- `toss-venue-resolver.service.ts` — `/stocks` 배치 조회와 symbol별 KIS 호환 venue 캐시
- `toss-broker.service.ts` — 주문·취소·체결·미체결·잔고·매수가능금액을 `BrokerPort`로 매핑
- `toss-mutation.error.ts` — 공통 `BrokerMutationError` 기반 토스 mutation 오류
- `toss.module.ts` — `TossBrokerService` export

## 외부 의존성

- `axios`, `@nestjs/config`
- `src/common/`의 broker port 타입, mutation 기반 에러, account hash 유틸

## 주의사항 / 비자명한 규칙

- 토스는 모의투자를 지원하지 않으며 broker context는 항상 `PROD`다.
- 주문 division은 `00`(LIMIT/DAY), `34`(LIMIT/CLS), `01`(MARKET)만 허용한다. 그 외 값은 HTTP 전에 거절한다.
- mutation POST의 timeout·네트워크 오류·5xx·불완전 응답은 `TRANSPORT_UNKNOWN`이다. 명확한 4xx만 `REJECTED`로 처리한다.
- `TOSS_ACCOUNT_NO`는 안정적인 계좌 식별자다. 최초 account-scoped 요청에서 `/accounts`의 유일한 `accountNo` 일치 항목을 찾아 정수 `accountSeq`를 single-flight로 캐시하고, 그 값을 `X-Tossinvest-Account` 헤더에 넣는다. 미설정·불일치·중복은 모두 fail-closed 처리한다.
- API 큐 그룹은 `AUTH/ACCOUNT/ASSET/ORDER/ORDER_INFO/STOCK/MARKET_DATA`를 사용한다. D10에 따라 `ORDER_INFO`는 정합 확인 전까지 장중 3 TPS 기준인 340ms를 종일 적용하며, `/stocks`는 최신 OpenAPI의 `STOCK` 그룹에서 200ms를 적용한다.
- 해외 listing은 `/stocks` 메타데이터를 배치 조회해 `NASDAQ→NASD`, `NYSE→NYSE`, `AMEX→AMEX`로 보강하고 canonical venue만 캐시한다. 미체결·체결 조회는 미확인 venue가 하나라도 있으면 symbol을 명시한 sanitized 오류로 fail-closed 처리한다. 잔고·snapshot은 `[TOSS <symbol>]` warn 후 `US`로 best-effort 반환한다. 국내 listing은 `KRX`를 유지한다.
- `OverseasAccountSnapshot.cashBalances`에 대응하는 현금 잔고 API가 없어 USD 금액을 0으로 반환한다. `/accounts`와 `/exchange-rate`는 계약대로 조회하지만 현재 공유 snapshot에 대응 필드가 없다.
- `REPLACED`는 원주문 종료(`CANCELLED`)로 반환하고 `[TOSS <stockCode>]` warn을 남긴다. 교체 주문 ID는 주문 목록 응답에 없어 연결하지 않는다.
- 실제 API 테스트는 금지한다. `scripts/toss-smoke.ts`만 읽기 endpoint를 수동 호출하며 주문 endpoint를 호출하지 않는다.
