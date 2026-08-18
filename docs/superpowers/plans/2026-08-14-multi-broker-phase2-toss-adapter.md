# Multi-Broker Phase 2 — 토스 어댑터 Implementation Plan

> **For agentic workers:** 이 플랜은 `docs/multi-broker-spec.md`(D5, D9, D10, D11, §3)를 근거로 한다. 작업 전 스펙 전체와 `src/broker/CLAUDE.md`, `src/kis/CLAUDE.md`, `src/kis/kis-mutation.error.ts`, `src/kis/kis-base.service.ts`를 반드시 읽을 것.

**Goal:** 토스증권 오픈API 어댑터(`src/toss/`)를 구현해 `BrokerPortRegistry`에 `TOSS` 포트를 등록한다. 이 Phase에서는 **아무 운영 경로도 TOSS로 라우팅되지 않는다** (WatchStock.broker가 전부 KIS) — 어댑터와 테스트만 완성한다.

**Architecture:** TossAuthService(OAuth2, in-memory 토큰) → TossBaseService(HTTP + 그룹별 rate limit 큐 + 에러 정규화) → TossBrokerService(BrokerPort 구현, 응답 매핑). BrokerModule은 토스 자격증명이 설정된 경우에만 TOSS 포트를 등록한다 (미등록 시 registry가 기존대로 fail-closed throw).

**Tech Stack:** NestJS, Jest. HTTP는 KIS 서비스와 동일한 클라이언트 방식을 따른다 (KisBaseService가 쓰는 방식 확인 후 동일하게).

**Spec:** `docs/multi-broker-spec.md` — API 계약 원문은 `https://openapi.tossinvest.com/openapi-docs/latest/openapi.json` (OpenAPI 3.0). base URL `https://openapi.tossinvest.com`.

## Global Constraints

- 커밋 전 `npm run build` + `npx jest` 통과. 커밋 단위는 Task별 (총 4커밋)
- 기존 테스트 기대값 변경 금지 (이번 Phase는 신규 코드 + BrokerModule 배선만)
- 타입은 `src/toss/types/`(토스 원시 응답) — 포트 반환 타입은 기존 `src/common/types/` 공유 타입 재사용, 새 공유 타입 추가 금지
- **비밀키 로그 노출 금지**: client secret/토큰을 로그·에러 메시지에 남기지 않는다
- 실제 네트워크 호출 테스트 금지 — 전부 HTTP mock. (실계좌 스모크는 Task 4의 수동 스크립트로 분리)
- 푸시 금지. 브랜치: `feat/multi-broker-phase2-toss-adapter` (Phase 0~1 브랜치 기반 stacked)

---

### Task 1: config 매핑 + TossAuthService

**Files:**
- Modify: `src/config/configuration.ts` (+ `configuration.spec.ts`)
- Create: `src/toss/toss-auth.service.ts`, `src/toss/toss-auth.service.spec.ts`, `src/toss/types/toss-auth.type.ts`

**Interfaces (Produces):**
- config: `toss.clientId` ← `TOSS_CLIENT_ID`, `toss.clientSecret` ← `TOSS_CLIENT_SECRET`, `toss.accountNo` ← `TOSS_ACCOUNT_NO` (기본값 전부 `''`)
- `TossAuthService.getAccessToken(): Promise<string>` / `invalidateToken(): void`

**요구사항:**
- `POST /oauth2/token`, `application/x-www-form-urlencoded`, body `grant_type=client_credentials&client_id=...&client_secret=...`. 응답 `{ access_token, token_type: 'Bearer', expires_in }` (실측 expires_in=86399)
- in-memory 캐시 (D11 — DB 영속화 금지). 만료 60초 전 선제 재발급
- **single-flight**: 동시 호출이 발급 요청을 1회만 발생시키도록 진행 중 Promise 공유
- 실패 시 throw (성공 값 반환/실패 throw 컨벤션). client secret은 어떤 로그에도 미출력

**Steps:** 테스트 먼저(캐시 hit / 만료 재발급 / single-flight / 실패 전파) → 구현 → `npm run build && npx jest` → Commit `feat(toss): 토스 오픈API 설정 매핑 및 OAuth2 인증 서비스`

---

### Task 2: TossBaseService — HTTP + 그룹별 rate limit 큐 + UNKNOWN 계약

**Files:**
- Create: `src/toss/toss-base.service.ts`, `src/toss/toss-base.service.spec.ts`, `src/toss/toss-mutation.error.ts`, `src/toss/types/toss-api-group.type.ts`

**Interfaces (Produces):**
- `TossBaseService.request<T>(group: TossApiGroup, opts: { method; path; query?; body?; accountScoped?: boolean; mutation?: boolean }): Promise<T>`
- `TossApiGroup = 'AUTH' | 'ACCOUNT' | 'ASSET' | 'ORDER' | 'ORDER_INFO' | 'MARKET_DATA'`
- `TossMutationError` — **`KisMutationError`와 동일한 의미론 계약** (아래)

**요구사항:**
- 그룹별 직렬화 큐 (D10): ORDER 100ms, ORDER_INFO 170ms, ACCOUNT 1000ms, ASSET 200ms, MARKET_DATA 67ms, AUTH 200ms. `KisBaseService`의 큐 패턴을 그룹별 인스턴스로 재사용. 호출자에서 추가 딜레이 금지 (이중 지연 금지 규칙)
- `Authorization: Bearer` 자동 부착 (TossAuthService), `accountScoped: true`면 `X-Tossinvest-Account: <toss.accountNo>` 부착
- 401 응답: 토큰 invalidate 후 **1회만** 재시도
- **UNKNOWN 계약 (최우선)**: `mutation: true` 요청에서 timeout / 네트워크 오류 / 5xx / 파싱 불가 응답은 `TossMutationError`로 throw하되, `src/kis/kis-mutation.error.ts`를 먼저 읽고 **reconciliation이 SUBMISSION_UNKNOWN으로 분류하는 판별 방식(클래스/필드/instanceof 여부)을 정확히 동일하게** 구현한다. 판별이 instanceof 기반이면 `KisMutationError`를 공통 기반 클래스로 승격(`src/common/`)하는 편이 안전한지 검토하고, 승격 시 기존 KIS 동작 불변을 테스트로 증명한다. 명확한 4xx 거절(밴드 이탈, 잔고 부족 등)은 UNKNOWN이 아니라 일반 실패로 던진다
- 테스트: 그룹별 큐 직렬화(같은 그룹 순차/다른 그룹 병렬), 401 1회 재시도, mutation timeout→UNKNOWN 분류, 4xx→일반 실패

**Steps:** kis-mutation.error.ts와 reconciliation의 판별 코드 확인 → 테스트 → 구현 → 게이트 → Commit `feat(toss): HTTP 기반 서비스 — 그룹별 rate limit 큐 및 UNKNOWN 계약`

---

### Task 3: TossBrokerService — BrokerPort 구현 + 등록

**Files:**
- Create: `src/toss/toss-broker.service.ts`, `src/toss/toss-broker.service.spec.ts`, `src/toss/types/toss-order.type.ts` 등, `src/toss/toss.module.ts`, `src/toss/CLAUDE.md`
- Modify: `src/broker/broker.module.ts`, `src/broker/CLAUDE.md`

**Interfaces:**
- Consumes: `BrokerPort`(`src/common/types/broker-port.type.ts`), Task 1·2 서비스
- Produces: `TossBrokerService implements BrokerPort` (`broker = Broker.TOSS`)

**매핑 규칙 (스펙 D9·§3 — 이탈 금지):**

| BrokerPort | 토스 API | 매핑 |
|---|---|---|
| `submitOrder` | `POST /api/v1/orders` (ORDER) | orderDivision `'00'`→`{orderType:LIMIT, timeInForce:DAY}`, `'34'`(LOC)→`{orderType:LIMIT, timeInForce:CLS}`, KIS 시장가 division(KIS 서비스에서 실제 사용값 확인)→`{orderType:MARKET}`. **매핑 불가 division은 포트 호출 전 throw (fail-closed)**. 응답 orderId→`OrderResult.orderNo` |
| `cancelOrder` | `POST /api/v1/orders/{orderId}/cancel` (ORDER) | `req.orderNo`가 orderId |
| `getUnfilledOrders` | `GET /api/v1/orders` (ORDER_INFO) | 미종결 상태 필터 → `UnfilledOrder[]` |
| `getOrderExecutions` | `GET /api/v1/orders` 기간 조회 (ORDER_INFO) | 상태 매핑: FILLED→FILLED, PARTIAL_FILLED→PARTIAL, PENDING/PENDING_*→PENDING, CANCELED→CANCELLED, REJECTED→FAILED. REPLACED는 원주문 종료로 처리하고 warn 로그 |
| `getBalance` | `GET /api/v1/holdings` (ASSET) | market 필터 → `BalanceItem[]` |
| `getDomesticBuyableAmount` / `getOverseasBuyableAmount` | `GET /api/v1/buying-power` (ASSET) | 기존 반환 타입에 매핑 |
| `getOverseasAccountSnapshot` | `/api/v1/accounts` + `/holdings` + `/exchange-rate` 조합 | `OverseasAccountSnapshot` 필드를 채울 수 없는 항목은 0/빈값 + `src/toss/CLAUDE.md`에 갭 기록 |
| `getBrokerContext` | — | `{ broker: TOSS, environment: PROD, accountHash: sha256(accountNo) }` — 해시 방식은 KIS 어댑터와 동일 유틸 재사용 |

- **PAPER 미지원 (D5)**: 토스 설정이 paper를 요구하는 상황이 성립하지 않도록, TossModule 부팅 시 자격증명이 있으면 environment는 항상 PROD. 별도 paper 분기 코드 금지
- **등록 게이트**: `broker.module.ts`에서 `toss.clientId`가 비어 있으면 TOSS 포트를 등록하지 않는다 (registry의 기존 fail-closed throw가 안전망). 등록 조건 테스트 포함
- 심볼/시장: DOMESTIC→6자리 코드 그대로, OVERSEAS→티커 그대로. `exchangeCode`는 토스에 불필요하므로 무시 (단 로그에는 유지)
- 로그 prefix: `[TOSS ${stockCode}]`

**Steps:** 테스트 먼저(매핑 표 전체 + fail-closed 케이스) → 구현 → 게이트 → Commit `feat(toss): TossBrokerService BrokerPort 구현 및 조건부 등록`

---

### Task 4: 수동 스모크 스크립트 (read-only)

**Files:**
- Create: `scripts/toss-smoke.ts` (+ package.json script `toss:smoke`)

**요구사항:** 실행 시 순서대로 ① 토큰 발급 ② `GET /accounts` ③ `GET /holdings` ④ `GET /prices?symbols=TQQQ` 호출하고 각 단계 성공/실패만 출력 (응답 원문·계좌번호 전체 미출력, 마스킹). **주문 API는 절대 호출하지 않는다.** jest 대상 아님 — 수동 실행 전용
**Steps:** 작성 → `npm run build` 확인 (실행은 사용자/운영자 수동) → Commit `chore(toss): read-only 스모크 스크립트`

---

## Self-Review 체크

- 스펙 커버리지: D9→Task 3 매핑 표, D10→Task 2 큐, D11→Task 1, §3 UNKNOWN 계약→Task 2, D5(PAPER 금지)→Task 3. D6·D7·D8(컨텍스트 3-tuple·현금 장부·리스크 합산)과 orchestrator 라우팅은 **Phase 3 — 이번 범위 아님**
- 타입 일관성: `TossApiGroup`/`TossMutationError`/`TossBrokerService` 명칭 Task 간 일치
- 게이트: Task별 build+jest, 실네트워크 테스트 금지, 스모크는 수동 분리
