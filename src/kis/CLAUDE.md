# KIS Module

## 책임
한국투자증권(KIS) OpenAPI를 감싸는 인프라 레이어. OAuth2 토큰 관리, 공통 HTTP 호출(rate limit / 재시도 / keep-alive), 국내/해외 시장별 시세·주문·잔고·재무·일봉 API를 제공한다. 운영 자동매매의 모든 KIS 호출은 이 모듈을 거친다.

## 주요 서비스 / 컴포넌트
- `kis.module.ts` — `KisAuthService`, `KisDomesticService`, `KisOverseasService` export
- `kis-auth.service.ts` — 토큰 발급/캐싱. DB(`KisAccessToken`)에 영속화하여 재시작 후에도 재사용. 만료 임박 시 자동 갱신. `OnModuleInit`에서 사전 인증
- `kis-base.service.ts` — 공용 HTTP 클라이언트. 직렬화 큐로 rate limit(prod 67ms, paper 300ms), keep-alive agent(maxSockets 5), 조회(GET)만 5xx/네트워크 에러에 한해 최대 2회 재시도
- `kis-mutation.error.ts` — 변경 요청의 KIS 업무 거절과 전송 결과 불명을 구분하고, 주문번호/브로커시각을 검증해 주문 결과를 분류
- `kis-order-history-pagination.service.ts` — 국내/해외 주문·체결/미체결 조회의 continuation, 중복 제거, 100페이지 상한을 공통 처리하는 조회 전용 paginator
- `kis-order-history.service.ts` — 국내/해외 주문·체결/미체결 endpoint 요청, row mapping, 브로커 거절 3상태 정규화를 전담하고 시장 서비스가 위임
- `kis-overseas-cash-balance.service.ts` — 해외 통화 잔고의 foreign-margin 보강과 통화별 병합을 전담
- `kis-overseas-balance.service.ts` — 해외 보유 종목·통화 잔고 조회, present/standard fallback 상태와 잔고 row 정규화를 전담
- `kis-domestic.service.ts` — 국내(KRX) 시세/주문/잔고/재무. paper 환경 전용 처리(일부 API 미지원 → fallback). `getDailyPrices` / `getPrice` / `getOrder*` / `getBalance` / `getUnfilledOrders` / `getOrderExecutions` / `getHolidays` 등
- `kis-overseas.service.ts` — 해외(NASD/NYSE/AMEX/SEHK/SHAA/SZAA/TKSE/HASE/VNSE) 시세·주문·랭킹 API와 주문 이력/잔고 서비스 위임을 담당
- `types/kis-api.types.ts` — 응답 타입 (DTO)
- `types/kis-config.types.ts` — `KIS_BASE_URLS`, `KisEnv`, 거래소 enum, 주문 TR_ID 매핑

## 외부 의존성
- `axios`, `http`/`https` (keep-alive agent)
- `@nestjs/config` — `kis.appKey`, `kis.appSecret`, `kis.accountNo`, `kis.prodCode`, `kis.env`, `kis.debugRawBalance`
- `PrismaService` — 토큰 영속화

## 주의사항 / 비자명한 규칙
- **Rate limit는 `kis-base.service.ts`가 일괄 관리**: 직렬화된 Promise 큐. 호출자에서 별도 throttle 추가 금지 (이중 지연)
  - **실전 요청 간격**: prod의 실제 axios 시작은 공용 FIFO에서 최소 100ms 간격, paper는 300ms 간격. 인증 헤더/token 준비가 끝난 뒤 gate를 통과하며 GET retry도 매 시도마다 gate를 다시 거친다.
- **주문 순서 보존**: GET/POST 우선순위 큐를 두지 않는다. 주문 필수 조회 → broker context/live switch 검증 → 단일 POST → reconciliation 순서를 유지한다.
- **변경 POST는 단 한 번만 전송**: 주문/취소 POST는 네트워크 오류나 5xx에도 자동 재시도하지 않는다. 명시적인 KIS 거절 또는 주문 HTTP 호출 전 결정적 설정 실패는 `REJECTED`, 전송 오류·HTTP 오류·응답 모순/손상은 `UNKNOWN`으로 분류한다. 사전 설정 실패 메시지는 원인을 포함하지 않고 정제하며 POST는 0회여야 한다.
- 프로세스 재시작 시 남은 `SUBMITTING`도 KIS POST를 다시 호출하지 않는다. 시작 인계가 `SUBMISSION_UNKNOWN`/취소 `UNKNOWN`으로 보존하고 이후 복구는 완전한 주문 이력 GET만 사용한다.
- **주문 접수 검증**: `ACCEPTED`는 `rt_cd=0`, 공백이 아닌 `ODNO`, 호출 시작 시각과 10분 이내인 유효한 브로커시각이 모두 필요하다. 6자리 시각은 KST 기준 D-1/D/D+1 중 가장 가까운 날짜를 선택하고, 14자리는 명시 날짜를 검증한다.
- **주문 이력은 완전 조회만 반환**: 응답 `tr_cont`가 `M`/`F`면 body의 FK/NK를 다음 `getWithMetadata` 요청에 넣고 header `tr_cont: N`을 보낸다. header/context 누락, 반복 tuple, 페이지 오류, 100페이지 뒤 continuation은 partial/empty 결과로 숨기지 않고 throw한다.
- 국내/해외 주문 이력 row는 pagination 중복 제거 전에 검증한다. nonempty 체결 row의 주문번호·종목·매수/매도·거래소(해외)·주문일/시각·주문/체결/잔여수량 또는 positive 미체결 row의 핵심 식별자가 손상되면 전체 조회를 실패시켜 reconciliation이 누락을 종료 증거로 오인하지 않게 한다. 완전히 빈 placeholder와 잔여수량 0인 미체결 row만 무시한다.
- 해외 미체결은 `OVERSEAS_ORDER_TR_IDS`의 모든 거래소를 순차 조회한 뒤 전 범위가 성공했을 때만 `거래소|주문번호`로 중복 제거한다. 응답 거래소가 비면 조회 scope를 사용하며, 수량이 남은 행의 주문번호/종목/매수·매도 구분/거래소가 손상되면 전체 조회를 실패시킨다. 호출부에서 별도 rate limit을 두지 않는다.
- 해외 체결 조회의 public 날짜는 KST 달력 기준이다. KIS 조회 시작일만 D-1로 확장하고, 결과 식별 시각은 유효한 `dmst_ord_dt`/`thco_ord_tmd`만 사용하며 누락·손상 행이 하나라도 있으면 전체 조회를 실패시킨다.
- **브로커 거절은 3상태**: `REJECTED | NOT_REJECTED | UNKNOWN`으로 정규화한다. 신뢰 가능한 필드가 없는 행은 `UNKNOWN`이며 호환용 `rejected=false`를 만들어내지 않는다.
- **환경(`kis.env`)에 따라 base URL과 TR_ID 분기**: paper 모드에서는 일부 prod-only API 미지원. `KisDomesticService.getProdOnlyOutput` 패턴 참조
- **토큰 만료**: KIS 토큰 24시간 유효. `kis-auth.service.ts`가 만료 임박 시 자동 재발급. 단일 동시 발급(`ensureTokenPromise`)으로 race condition 방지
- **resolver/strategy에서 `axios` 직접 호출 금지**: 모든 KIS API는 `KisDomesticService`/`KisOverseasService` 경유 (루트 CLAUDE.md "Infrastructure는 격리")
- 해외 daily price는 `from`/`to` 미지원 → `count` 인자만. 호출자가 영업일 추정 필요
- 잔고 조회: `KisOverseasBalanceService`가 present snapshot(통화별 cash balances 포함)과 standard holdings를 조합한다. paper 환경 또는 `INVALID_CHECK_ACNO` 실패 시 인스턴스의 `useStandardBalanceOnly` 상태를 켜 이후 호출도 standard API만 사용한다.
- `getOrderExecutions(from, to)`는 KST yyyymmdd 포맷 — 호출자에서 timezone 변환 필요
- 휴장일은 `getHolidays`로 조회 → `MarketStateSyncService`가 캐시
- **수정주가 일관성**: 백테스트/과거 데이터는 항상 수정주가 기준 (`MODP=1`/`FID_ORG_ADJ_PRC=0`) — 루트 CLAUDE.md
