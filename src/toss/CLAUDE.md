# Toss Module

## 책임

토스증권 Open API의 OAuth2 인증, API 그룹별 rate-limit 큐, HTTP 오류 정규화, `BrokerPort` 응답 매핑을 담당한다. Phase 2에서는 포트만 등록하며 운영 주문 라우팅은 Phase 3 전까지 KIS를 유지한다.

## 주요 서비스 / 컴포넌트

- `toss-auth.service.ts` — in-memory OAuth2 토큰 캐시와 single-flight 재발급
- `toss-base.service.ts` — 인증 헤더, 그룹별 직렬화 큐, 401 1회 재시도, mutation UNKNOWN 정규화
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
- API 큐 그룹은 Phase 2 계획의 `AUTH/ACCOUNT/ASSET/ORDER/ORDER_INFO/MARKET_DATA` 계약을 따른다. 현재 OpenAPI 1.2.14가 주문 이력을 `ORDER_HISTORY`, buying-power를 `ORDER_INFO`, exchange-rate를 `MARKET_INFO`로 표기하므로 Phase 3 운영 배선 전에 계획의 그룹 모델을 최신 문서와 재조정해야 한다.
- OpenAPI 주문/보유 응답은 미국 종목의 거래소를 제공하지 않아 `exchangeCode`를 `US`로만 매핑한다. Phase 3의 venue별 reconciliation 전에 종목 메타데이터를 통한 NASD/NYSE/AMEX 해소가 필요하다.
- `OverseasAccountSnapshot.cashBalances`에 대응하는 현금 잔고 API가 없어 USD 금액을 0으로 반환한다. `/accounts`와 `/exchange-rate`는 계약대로 조회하지만 현재 공유 snapshot에 대응 필드가 없다.
- `REPLACED`는 원주문 종료(`CANCELLED`)로 반환하고 `[TOSS <stockCode>]` warn을 남긴다. 교체 주문 ID는 주문 목록 응답에 없어 연결하지 않는다.
- 실제 API 테스트는 금지한다. `scripts/toss-smoke.ts`만 읽기 endpoint를 수동 호출하며 주문 endpoint를 호출하지 않는다.
