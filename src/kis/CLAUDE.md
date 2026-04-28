# KIS Module

## 책임
한국투자증권(KIS) OpenAPI를 감싸는 인프라 레이어. OAuth2 토큰 관리, 공통 HTTP 호출(rate limit / 재시도 / keep-alive), 국내/해외 시장별 시세·주문·잔고·재무·일봉 API를 제공한다. 운영 자동매매의 모든 KIS 호출은 이 모듈을 거친다.

## 주요 서비스 / 컴포넌트
- `kis.module.ts` — `KisAuthService`, `KisDomesticService`, `KisOverseasService` export
- `kis-auth.service.ts` — 토큰 발급/캐싱. DB(`KisAccessToken`)에 영속화하여 재시작 후에도 재사용. 만료 임박 시 자동 갱신. `OnModuleInit`에서 사전 인증
- `kis-base.service.ts` — 공용 HTTP 클라이언트. 직렬화 큐로 rate limit(prod 67ms, paper 300ms), keep-alive agent(maxSockets 5), 5xx/네트워크 에러에 한해 최대 2회 재시도
- `kis-domestic.service.ts` — 국내(KRX) 시세/주문/잔고/재무. paper 환경 전용 처리(일부 API 미지원 → fallback). `getDailyPrices` / `getPrice` / `getOrder*` / `getBalance` / `getUnfilledOrders` / `getOrderExecutions` / `getHolidays` 등
- `kis-overseas.service.ts` — 해외(NASD/NYSE/AMEX/SEHK/SHAA/SZAA/TKSE/HASE/VNSE) 동일 카테고리. 거래소 코드 매핑(`EXCHANGE_CODE_MAP`), 통화 매핑(`EXCHANGE_CURRENCY`), `useStandardBalanceOnly` fallback 플래그
- `types/kis-api.types.ts` — 응답 타입 (DTO)
- `types/kis-config.types.ts` — `KIS_BASE_URLS`, `KisEnv`, 거래소 enum, 주문 TR_ID 매핑

## 외부 의존성
- `axios`, `http`/`https` (keep-alive agent)
- `@nestjs/config` — `kis.appKey`, `kis.appSecret`, `kis.accountNo`, `kis.prodCode`, `kis.env`, `kis.debugRawBalance`
- `PrismaService` — 토큰 영속화

## 주의사항 / 비자명한 규칙
- **Rate limit는 `kis-base.service.ts`가 일괄 관리**: 직렬화된 Promise 큐. 호출자에서 별도 throttle 추가 금지 (이중 지연)
  - prod: 67ms (~15 req/s) / paper: 300ms (~3 req/s)
- **환경(`kis.env`)에 따라 base URL과 TR_ID 분기**: paper 모드에서는 일부 prod-only API 미지원. `KisDomesticService.getProdOnlyOutput` 패턴 참조
- **토큰 만료**: KIS 토큰 24시간 유효. `kis-auth.service.ts`가 만료 임박 시 자동 재발급. 단일 동시 발급(`ensureTokenPromise`)으로 race condition 방지
- **resolver/strategy에서 `axios` 직접 호출 금지**: 모든 KIS API는 `KisDomesticService`/`KisOverseasService` 경유 (루트 CLAUDE.md "Infrastructure는 격리")
- 해외 daily price는 `from`/`to` 미지원 → `count` 인자만. 호출자가 영업일 추정 필요
- 잔고 조회는 통화별로 다름: 해외는 `getCurrencyBalance` + `getStandardBalance` 조합. 잔고 검증 차이로 KIS가 standard만 반환하는 경우 `useStandardBalanceOnly` 자동 전환
- `getOrderExecutions(from, to)`는 KST yyyymmdd 포맷 — 호출자에서 timezone 변환 필요
- 휴장일은 `getHolidays`로 조회 → `MarketStateSyncService`가 캐시
- **수정주가 일관성**: 백테스트/과거 데이터는 항상 수정주가 기준 (`MODP=1`/`FID_ORG_ADJ_PRC=0`) — 루트 CLAUDE.md
