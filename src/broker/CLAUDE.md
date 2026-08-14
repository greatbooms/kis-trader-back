# Broker Module

## 책임

주문·취소·체결·미체결·잔고·주문가능금액 호출을 `BrokerPort`로 라우팅한다. `BrokerPortRegistry`는 등록되지 않은 broker를 반드시 예외로 거절한다.

## 경계

- 주문 mutation과 계좌/주문 상태 조회는 `BrokerPortRegistry`를 경유한다.
- 토스 포트는 `toss.clientId`가 설정된 경우에만 등록하며, 미설정 상태의 `TOSS` 조회는 기존 fail-closed 예외를 유지한다.
- 시세·일봉·휴장일 같은 시장 데이터는 broker port 범위가 아니며 기존 KIS 서비스를 직접 사용한다.
- 자금 경로에서 broker 누락이나 미등록 broker를 기본값으로 추정하지 않는다.
- DB broker 차원은 expand/contract 방식으로 전개하며, pre-broker binary 롤백 호환성을 위해 기존 unique index를 함께 유지한다.
- 기존 index는 TOSS row를 도입하는 Phase 2 migration에서 제거한다.
