# Multi-Broker Phase 3 — 운영 배선 Implementation Plan

> **For agentic workers:** 근거는 `docs/multi-broker-spec.md` D5~D8 + 롤아웃 §5. 작업 전 스펙 전체, `src/broker/CLAUDE.md`, `src/toss/CLAUDE.md`, `src/trading/CLAUDE.md`를 읽을 것. 이 Phase가 끝나면 WatchStock을 `broker=TOSS`로 만들었을 때 실제 토스 주문이 나갈 수 있다 — 모든 결정은 fail-closed.

**Goal:** 등록만 되어 있던 TOSS 포트를 운영 경로(스케줄러 루프·컨텍스트 검증·현금 장부·리스크·UI)에 배선한다.

**핵심 불변식 (전 태스크 공통 게이트):** `trading.brokers.toss.enabled=false`(기본값)이면 시스템 동작이 현재와 **완전 동일**해야 한다. 기존 테스트 기대값 변경은 "broker 인자/태그 추가"로 인한 기계적 수정만 허용.

**Spec:** `docs/multi-broker-spec.md` (D5 스위치, D6 context 3-tuple, D7 현금·quota broker 스코프, D8 리스크 합산 모니터링, §4 변경 지점 표)

## Global Constraints

- 커밋 전 `npm run build` + `npx jest` 통과. Task 단위 커밋
- 로그 prefix: broker 관련 경로는 `[${broker} ${stockCode}]` (예: `[TOSS TQQQ]`), Slack 알림에도 broker 표시
- 시세/스크리닝/재무는 계속 KIS 직접 호출 (D3) — 이 Phase에서 건드리지 않음
- `process.env` 직접 접근 금지, ConfigService 경유
- 푸시 금지. 브랜치: `feat/multi-broker-phase3-wiring` (phase2 브랜치 기반 stacked)
- GraphQL 스키마 재생성용 로컬 DB: `postgresql://postgres:migtest@localhost:15498/kis_trader_back?schema=public` (운영 복제본, 마이그레이션 적용 완료). 앱 부팅은 `TRADING_ENABLED=false SLACK_ENABLED=false`로만, schema.gql 갱신 확인 후 즉시 종료

---

### Task 1: broker enable 스위치 + active broker 조회 (D5)

- config: `trading.brokers.kis.enabled` ← `TRADING_BROKER_KIS_ENABLED` (기본 `true`), `trading.brokers.toss.enabled` ← `TRADING_BROKER_TOSS_ENABLED` (기본 `false`)
- `BrokerPortRegistry.getActive(): BrokerPort[]` — 등록됨 ∧ enabled. TOSS enabled인데 자격증명 미설정이면 **부팅 에러** (fail-closed)
- `.env.example`에 두 변수 추가 (주석: 기본값과 의미)
- 테스트: enabled 조합 4케이스 + 자격증명 누락 부팅 에러
- Commit: `feat(broker): broker별 enable 스위치 및 active broker 조회`

### Task 2: 동기화 루프 broker 확장 + 현금 장부 broker 스코프 (D7)

- `order-sync`, `market-state-sync`, `trading-position-sync`/`refresh`, `trading-account-cash-sync`의 `registry.get(Broker.KIS)` 고정 호출(Phase 1의 `// Phase 3` 주석 지점)을 `getActive()` 루프로 전환. broker별 실패는 독립 (한 broker 오류가 다른 broker 동기화를 막지 않게 try/catch + warn)
- `account_status_cache` 키 `(market)` → `(broker, market)`, advisory lock 키 동일 확장. 기존 캐시 row 마이그레이션: 기존 키는 KIS로 해석 (코드 레벨 호환 읽기 또는 1회 변환 — 구현 시 단순한 쪽 선택, 결정 기록)
- `Position` 동기화는 broker별로 해당 broker의 row만 갱신/삭제 (다른 broker 포지션 삭제 금지 — 테스트 필수)
- reconciliation(`TradingOrderReconciliationService`)은 record.broker 기준이므로 확인만 하고 루프 주체는 order-sync가 broker별 호출
- Commit: `feat(trading): 동기화 루프 broker 확장 및 현금 캐시 broker 스코프`

### Task 3: broker context 3-tuple (D6 — 안전 최우선)

- `TradingBrokerContextService`를 broker 파라미터화: KIS는 기존 config, TOSS는 `TossBrokerService.getBrokerContext()` 경유. `{broker, environment, accountHash}` 3-tuple
- 승인 workflow·복구·취소·manual-order의 모든 "현재 context 비교" 지점이 **record의 broker에 대한** 현재 context와 비교하도록 확장. 비교 시점·CAS·fail-closed 구조는 기존 그대로 (src/trading/CLAUDE.md의 경계 규칙 준수)
- 레거시 record(broker 컬럼 backfill=KIS) 호환 확인
- 테스트: 기존 approval/recovery spec에 "broker 불일치 → fail-closed" 케이스 추가 (KIS record vs TOSS context, 그 반대)
- Commit: `feat(trading): broker context 3-tuple 검증 확장`

### Task 4: orchestrator broker 루프 + 리스크/알림 (D8)

- `TradingOrchestrator`: WatchStock을 broker별 그룹핑해 순차 실행 (동일 시장 내). `isDomesticRunning`/`isOverseasRunning` mutex를 (broker, market) 단위로. TOSS 그룹은 `trading.brokers.toss.enabled` ∧ `trading.enabled`일 때만
- BUY 신호의 예수금/buyable 조회는 signal.broker의 포트 사용 (Phase 1에서 KIS 고정이던 지점)
- `RiskSnapshot` broker별 기록. 일일 리스크 알림에 종목별 크로스 브로커 합산 노출 표시 (차단 없음, 표시만 — D8)
- 체결/승인/실행로그 Slack 메시지에 broker 태그
- Commit: `feat(trading): orchestrator broker 루프 및 리스크 broker 스코프`

### Task 5: GraphQL + 프론트 broker 노출

- WatchStock CRUD input/object에 `broker` 필드 (기본 KIS). `Broker` enum GraphQL 등록 (registerEnumType — 처음 쓰는 object 파일 하단)
- 수정/삭제/미리보기 등 WatchStock 조회 경로가 (broker, market, exchangeCode, stockCode) 키 사용하는지 확인
- 포지션/거래내역/미리보기 UI에 broker 구분 표시 (`client/`): 목록 배지 수준의 최소 표시. 대시보드 재설계 금지
- `TRADING_ENABLED=false SLACK_ENABLED=false DATABASE_URL=<복제본>`으로 `start:dev` 부팅 → `src/schema.gql` 갱신 → 종료 → `npm run client:codegen`
- client 빌드 확인 (`npm run build` client 포함 여부 확인, 없으면 client 디렉토리의 빌드 스크립트)
- Commit: `feat(watch-stock): WatchStock broker 필드 및 UI broker 구분`

---

## Self-Review 체크

- D5→Task 1, D7→Task 2, D6→Task 3, D8→Task 4, §4 표의 GraphQL행→Task 5
- 불변식: 모든 Task에서 toss.enabled=false 기본값이면 행동 동일 — Task별 테스트로 확인
- Phase 4(소액 병행 검증)와 Phase 5(토스 배치 시세·조건주문)는 범위 외
