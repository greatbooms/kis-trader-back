# 국내 데이트레이드(당일청산) 후보 스크리닝 파이프라인 — 설계

- 날짜: 2026-06-10
- 상태: 사용자 설계 승인 완료, 구현 계획 대기
- 범위: 국내(KRX) 우선. 해외는 2단계 별도 설계

## 1. 배경 / 문제

momentum-breakout 전략이 당일청산 변동성 돌파(VB) 전략으로 리워크되어 main에 머지됐다.
이 전략은 매일 아침 "오늘 돌릴 후보"가 필요한데, 현재 스크리닝은 다음 3가지가 안 맞는다.

1. **시간 미스매치**: 국내 스크리닝이 09:10 KST(장중)에 실행되어 결과가 09:15 이후에 나온다.
   전략 진입 윈도우는 09:05~14:30이라 오늘 추천을 오늘 쓸 수 없다. 그런데 VB 후보 선정에
   필요한 입력(전일 변동폭, MA20, 20일 거래대금)은 전부 **전일 장 마감 시점에 확정**되는
   값이다 — 장 시작 전에 뽑을 수 있는 것을 장중에 뽑고 있다. 09:10의 등락률/거래량 랭킹은
   10분치 데이터라 노이즈도 크다.
2. **기준 미스매치**: 기존 점수 체계는 투자 매력도(재무 30점: DCF/PER/배당/컨센서스) 중심.
   백테스트 결론은 "**거래세 면제(ETF) + 고변동성 + MA20 위 레짐**만 양의 기대값, 일반
   주식은 거래세 0.18%가 gross 엣지보다 커서 구조적 손실"이다. 그런데
   `strategy-matcher.ts`의 추천 게이트는 momentum-breakout을 모든 종목에 무조건
   통과시킨다(`if (strategyName !== 'infinite-buy') return true`) — 백테스트 결론과 모순.
3. **연결 단절**: 추천 → 수동 WatchStock 등록 → 매매. 매일 반복되는 데이트레이드 운영에
   수동 단계가 끼어 있다. 단, momentum-breakout은 현재 **시뮬 검증 대기** 상태이므로
   실거래 자동화가 아니라 시뮬레이션 자동 투입이 올바른 다음 단계다.

## 2. 확정된 요구사항 (사용자 결정)

| 결정 항목 | 선택 |
|---|---|
| 개선 범위 | 데이트레이드 후보 선정 파이프라인 **분리 신설**. 기존 투자용 스크리닝은 유지하되 momentum-breakout 추천 게이트만 수정 |
| 자동화 수준 | **시뮬 자동투입 + Slack 리포트**. 실거래 WatchStock 등록은 수동 유지. 검증 후 실거래 자동화로 확장 가능한 구조 |
| 후보 유니버스 | **거래세 면제 ETF 한정** (레버리지/인버스 등 고변동성 ETF, ETN·스팩 제외) |
| 실행 시간 | **당일 아침 08:30 KST 평일 1회** (전일 확정 일봉 + 당일 적용 유의종목/거래정지 상태 반영) |
| 아키텍처 | **screening 모듈 내 신규 서비스** (기존 스케줄러/run-log/Slack 인프라 재사용, ScreeningModule → SimulationModule 의존 추가 — 순환 없음 확인) |

## 3. 아키텍처

```
ScreeningScheduler (08:30 KST, jobKey 'day-trade-fast')
  │
DayTradeScreeningService.runDailySelection(date)
  ├─ 1. 전일 [DT] 시뮬 세션 정리        → SimulationSessionManager
  ├─ 2. 유니버스 수집 (시드 ∪ 랭킹)      → KisDomesticService
  ├─ 3. 하드 필터 + 점수화 (순수 함수)   → day-trade-selector.ts
  ├─ 4. DayTradeCandidate 저장 (upsert) → Prisma
  ├─ 5. Slack 리포트                    → SlackService.sendDayTradeCandidates
  └─ 6. 상위 N개 시뮬 세션 생성          → SimulationSessionManager.createSession
```

### 신규/수정 파일

| 파일 | 작업 | 역할 |
|---|---|---|
| `src/screening/day-trade-screening.service.ts` | 신규 | 오케스트레이션. public 메서드 `runDailySelection(date)` 하나 |
| `src/screening/day-trade-selector.ts` | 신규 | 순수 함수: 하드 필터, 점수 계산, MA20/ATR14/평균거래대금 계산, strict ETF 판별 |
| `src/screening/types/day-trade.type.ts` | 신규 | `DayTradeCandidateScore` 등 타입 |
| `src/screening/screening.scheduler.ts` | 수정 | `day-trade-fast` cron(08:30 KST 평일) 추가, 기존 run-log 패턴 적용 |
| `src/screening/strategy-matcher.ts` | 수정 | momentum-breakout 추천 게이트 강화 (§6) |
| `src/notification/slack.service.ts` | 수정 | `sendDayTradeCandidates()` 추가 |
| `src/screening/screening.module.ts` | 수정 | SimulationModule import |
| `prisma/schema.prisma` | 수정 | `DayTradeCandidate` 모델 + 마이그레이션 |
| `src/screening/CLAUDE.md` | 수정 | 파이프라인 설명 + 임계값 근거 기록 |

지표 계산은 `MarketAnalysisService` 캐시를 사용하지 않는다 — 그 캐시는 장중 평가용(당일 봉
보정 포함)이고, 08:30에는 "전일 확정 일봉 30개"만 필요하므로
`KisDomesticService.getDailyPrices`(수정주가 강제) → 순수 함수 계산이 단순하고 결정적이다.

## 4. 데이터 모델

```prisma
model DayTradeCandidate {
  id                  String   @id @default(uuid())
  screeningDate       String   @map("screening_date")        // YYYY-MM-DD
  market              Market                                  // v1 DOMESTIC, 2단계 OVERSEAS 재사용
  exchangeCode        String   @map("exchange_code")          // KRX
  stockCode           String   @map("stock_code")
  stockName           String   @map("stock_name")
  rank                Int
  score               Decimal  @db.Decimal(6, 2)
  prevRangePct        Decimal  @map("prev_range_pct") @db.Decimal(8, 4)   // 전일 (고-저)/종가
  atrPct              Decimal  @map("atr_pct") @db.Decimal(8, 4)          // ATR14/종가
  avgTradeValue20d    BigInt   @map("avg_trade_value_20d")                // 20일 평균 거래대금(원)
  aboveMa20           Boolean  @map("above_ma20")                          // 전일 종가 > MA20
  excluded            Boolean  @default(false)                             // 하드 필터 탈락 여부
  excludeReason       String?  @map("exclude_reason")
  simulationSessionId String?  @map("simulation_session_id")
  indicators          Json                                                 // 지표 스냅샷
  createdAt           DateTime @default(now()) @map("created_at")

  @@unique([screeningDate, market, stockCode])
  @@index([screeningDate, market])
  @@map("day_trade_candidates")
}
```

`StockRecommendation`을 재사용하지 않는 이유: 같은 날 같은 ETF가 투자 스크리닝에도 잡히면
unique 제약 `[screeningDate, market, stockCode]`이 충돌하고, 점수 의미(투자 매력도 vs
데이트레이드 적합도)가 달라 섞을 수 없다. 탈락 종목도 `excluded=true`로 저장해 "왜 안
뽑혔는지"를 추적 가능하게 한다.

## 5. 선정 로직 (v1)

### 5.1 유니버스 수집 — 두 소스의 합집합

1. **시드 ETF 상수** (10~15개, 구현 시 코드 확정): KODEX 레버리지(122630),
   KODEX 200선물인버스2X, KODEX 코스닥150레버리지, KODEX 코스닥150선물인버스 등
   핵심 고변동성 ETF. 랭킹 API가 놓쳐도 핵심 종목은 항상 평가된다.
2. **KIS 거래량/등락률 랭킹**에서 `detectEtf` 통과 종목.

주의: 08:30은 장 시작 전이라 랭킹 API가 전일 기준 데이터를 주거나 빈 응답일 수 있다
(구현 시 실제 응답 확인). 전일 기준이면 그 자체로 원하는 입력(전일 거래대금 상위)이고,
빈 응답이어도 시드 리스트가 안전망 역할을 하므로 파이프라인은 동작한다.

### 5.2 strict ETF 판별

기존 `detectEtf`는 ETN/스팩도 ETF로 분류하므로, 유니버스에는 별도 strict 필터를 적용한다:
ETN 코드 패턴(`/^[0-9]{3}[A-Z][0-9]/` 등)과 '스팩'/'ETN' 키워드를 **제외**.
근거: ETN은 발행사 신용 리스크와 LP 스프레드, 스팩은 유동성/변동성 구조가 달라
당일청산 시장가 전략에 부적합.

### 5.3 하드 필터 (전부 통과해야 후보)

| 필터 | 기준(초기값) | 근거 |
|---|---|---|
| strict ETF | §5.2 | 거래세 면제 + LP 유동성 |
| 20일 평균 거래대금 | ≥ 300억 원 | 시장가 주문 슬리피지 무시 가능 수준. 구현 시 122630 실측 분포 참고해 확정 |
| 레짐 | 전일 종가 > MA20 | 전략 hard 필터와 동일. 백테스트(2023-06~2026-05): MA20 위에서만 양의 엣지 |
| 변동폭 | ATR14% ≥ 1.2% | 왕복 비용(수수료+슬리피지 ~0.3%) 대비 4배. 구현 시 122630/233740 분포 보고 확정 |
| 안전 | 유의/경고/거래정지 아님 | `getPrice`의 `investCautionYn`/`marketWarnCode` — 08:30 조회로 당일 적용 상태 반영 |

임계값은 `day-trade-selector.ts` 상수로 정의하고 근거를 모듈 CLAUDE.md에 기록한다.
strategy-matcher 게이트(§6)와 동일 상수를 공유한다.

### 5.4 점수 / 랭킹

```
score = 변동성 정규화(ATR%) × 0.6 + 유동성 정규화(log 거래대금) × 0.4
```

정렬 후 rank 부여. 상위 N개(기본 3, AppSetting으로 조정)가 시뮬 투입 대상.

### 5.5 API 비용

유니버스 30~50종목 × (일봉 1콜 + 현재가 1콜), 60ms 간격 ≈ 10~20초. rate limit 여유 충분.

### 5.6 후보 0개인 날

전반적 하락 레짐 등으로 조건 충족 ETF가 없으면 **후보 없음이 정상 동작**이다(엣지 없는 날
진입하지 않는 것이 백테스트 결론과 일치). run-log success(count 0) + Slack "오늘 후보 없음" 통지.

## 6. 기존 스크리닝 게이트 수정 (`strategy-matcher.ts`)

`passesRecommendationGate`에 momentum-breakout 분기 추가 — 아래 전부 충족 시에만 통과:

- `detectEtf` 통과 (거래세 면제)
- 현재가 > MA20 (레짐)
- `atrPercent` ≥ 기준 (§5.3과 동일 상수)
- 유의/경고/정지 아님

효과: 일반 주식 추천 카드에 "변동성 돌파 (당일청산)"이 더는 붙지 않는다.
기존 저장 데이터는 소급하지 않고 신규 스크리닝부터 적용. `suggestedStrategies`는 JSON
필드라 GraphQL 스키마 변경 없음(클라이언트 codegen 불필요).

## 7. 시뮬 세션 라이프사이클

08:30 잡 실행 순서:

1. **전일 자동 세션 정리**: `strategyParams.dayTradeAuto === true`이고 RUNNING인 세션 중
   - 포지션 없음 → COMPLETED (정상: 전략이 15:10 전량 청산)
   - 포지션 있음 → **RUNNING 유지 + Slack 경고**. 종료하면 전략의 이월청산 안전망이 동작할
     기회가 사라진다. 하루 더 두면 개장 직후 이월청산 규칙이 정리하고, 다음 날 아침 정리
     단계에서 COMPLETED 된다.
2. 후보 선정 + 저장 (§5)
3. Slack 리포트 (§8)
4. **상위 N개 시뮬 투입**: `SimulationSessionManager.createSession` —
   - 이름: `[DT] {YYYY-MM-DD} {종목명}`
   - `strategyName: 'momentum-breakout'`, 파라미터는 전략 기본값(K=0.5)
   - `strategyParams`에 `dayTradeAuto: true` + `screeningDate` 마커
   - 당일 동일 종목 `[DT]` 세션 존재 시 중복 생성 스킵 (재실행 멱등성)

**설정**: `AppSetting` 키 `day-trade-screening` = `{ enabled, topN(기본 3), simCapital }`.
시뮬 세션만 생성하므로 기본 enabled여도 자금 리스크 없음. 실거래 자동 등록은 이 설계에
포함되지 않으며, 시뮬 검증 후 별도 플래그로 확장한다.

## 8. Slack 리포트 (`sendDayTradeCandidates`)

- 후보 테이블: 코드 / 이름 / 전일 변동폭% / ATR% / 20일 거래대금 / 레짐
- 시뮬 투입 종목 표시
- 주요 탈락 종목과 사유 (excluded 중 시드 종목 위주)
- "실거래 등록은 수동" 안내 1줄

기존 `sendScreeningResult`는 투자 점수 포맷이라 재사용하지 않고 분리한다.

## 9. 에러 처리

- 종목 단위 KIS 호출 실패: try/catch + `logger.warn`, 해당 종목만 제외하고 계속 (기존 컨벤션)
- 시뮬 생성 실패: 후보 저장은 유지, `simulationSessionId: null` + Slack 경고
  (선정 결과가 시뮬 실패에 인질 잡히지 않게)
- 전체 실패/스킵: 기존 run-log 패턴(`day-trade-fast` jobKey, started/success/failed/skipped),
  `isFastRunning` 뮤텍스 공유로 다른 스크리닝과 동시 실행 방지
- 같은 날 재실행: `DayTradeCandidate` upsert + `[DT]` 세션 중복 체크로 멱등

## 10. 테스트

- `day-trade-selector.spec.ts`: 하드 필터 경계값(거래대금/ATR/MA20), strict ETF(ETN·스팩
  제외), 점수 정렬, 후보 0개
- `day-trade-screening.service.spec.ts`: KIS/Slack/SessionManager 모킹 — 정리→선정→투입
  흐름, 포지션 남은 세션 RUNNING 유지, 부분 실패, 재실행 멱등성
- `strategy-matcher` 게이트 테스트 추가/수정
- `npm run build` + `npx jest` 전체 통과, Prisma 마이그레이션 생성
  (`npm run prisma:migrate -- --name add_day_trade_candidate`)

## 11. 범위 경계

**이번 범위(국내)**: §3~§10 전부 + screening 모듈 CLAUDE.md 갱신

**2단계(해외, 별도 설계)**:
- US 스크리닝 시간의 DST 미반영 수정 — 현재 00:10 KST 고정("개장 40분 후" 주석은 EST
  기준, 서머타임에는 개장 1h40m 후). 개장 기준 상대 시간으로 변경 검토
- 해외 전략(멀티데이) 특성에 맞는 후보 기준/실행 시간 재설계

**제외**:
- 기존 09:10 투자 스크리닝의 실행 시간 변경 (원하면 후속 작업)
- 후보 조회 UI/GraphQL query (시뮬 세션은 기존 UI로 확인 가능, 필요해지면 추가)
- 실거래 WatchStock 자동 등록 (시뮬 검증 후 별도 설계)
