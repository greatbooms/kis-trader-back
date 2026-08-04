# 무한매수 V4 전략 스펙 (`infinite-buy-v4`)

> 상태: 설계 확정 대기 → 구현은 Codex 위임
> 작성: 2026-07-28. 근거: 라오어 무한매수법 V4.0 방법론 (일반모드 + 소진후 리버스모드)
> 주의: 원본 방법론 문서는 재배포 금지 자료다. 이 스펙은 규칙을 우리 언어로 재기술한 내부 문서이며, 원문 전재를 금지한다.

## 1. 목적 / 범위

- 기존 `infinite-buy`(독자 변형)와 **별개의 신규 전략**으로 V4.0 원본 충실 구현을 추가한다. 기존 전략 코드는 수정하지 않는다 (A/B 비교 대상 보존).
- **적용 시장: OVERSEAS(미국) 전용.** LOC/MOC 주문이 미국장에만 존재하고, V4.0 계수는 3배 레버리지 ETF(TQQQ/SOXL) 전제로 튜닝되어 있다. 국내는 지원하지 않는다 (`evaluateStock`에서 DOMESTIC이면 skipReason 반환).
- 목표: 백테스트에서 `현행 infinite-buy` vs `v4 순정` vs `v4 + 오버레이(RSI 등)` 3자 비교 후 해외 트랙 전환 여부 결정.

## 2. 상태 모델

전략 상태는 `WatchStock` 기존 컬럼 + `strategyParams` JSON에 저장한다. 스키마 마이그레이션 없음.

| 값 | 저장 위치 | 의미 |
|---|---|---|
| 원금 `principal` | `WatchStock.quota` 재사용 | 사이클 총 투입 한도. 외부 자금 추가 없음 |
| 분할수 `N` | `WatchStock.maxCycles` 재사용 | 20 또는 40 (기본 40) |
| 잔금 `cashRemaining` | `strategyParams.v4.cashRemaining` | `principal − 현재 사이클 순투입액(매수 체결액 − 매도 회수액)` |
| 회차 `T` | `strategyParams.v4.turn` | 아래 T 회계 규칙으로만 갱신. 소수점 제한 없음 |
| 모드 | `strategyParams.v4.mode` | `NORMAL` \| `REVERSE` |
| 사이클 번호 | `strategyParams.v4.cycleSeq` | 종료 시 +1 (로그/분석용) |

- `stopLossRate`는 v4에서 **미사용** (전량 손절 없음 — 리버스모드가 리스크 해소를 대체).
- 파라미터 타입은 `src/trading/types/infinite-buy-v4-strategy-params.type.ts` 신설.

### 종목 계수 (파라미터, 종목별 기본값)

| 파라미터 | TQQQ | SOXL | 설명 |
|---|---|---|---|
| `starBasePct` | 15 | 20 | 별% 스케일이자 최종 목표 수익률 |
| `finalTargetPct` | = starBasePct | = starBasePct | 최종 지정가 매도 목표 |

기타 종목은 기본값 없음 — `strategyParams`에 명시해야 활성화 (원본이 TQQQ/SOXL 외 비추천이므로 의도적 마찰).

## 3. T 회계 (핵심 불변식)

원본의 이산 규칙(+1 / +0.5 / ×0.75)을 **체결 비율 기반 연속식으로 일반화**한다. 부분 체결·복수 주문을 자연스럽게 포괄하며, 전량 체결 시 원본 값과 일치한다.

- **NORMAL 매수 체결**: `ΔT = 당일 매수 체결금액 ÷ 당일 1회매수 시도액 D`
- **NORMAL 쿼터매도 체결**: `T ← T × (1 − 체결수량 ÷ 직전 보유수량)` (1/4 전량 체결 = ×0.75)
- **NORMAL 최종매도 부분 체결**: 쿼터매도와 동일식 적용 (원본 미명시 → 스펙 결정)
- **REVERSE 매도 체결**: `T ← T × (1 − 체결수량 ÷ 직전 보유수량)` (1/(N/2) 전량 체결 = ×0.95 @N=40)
- **REVERSE 매수 체결**: `T ← T + (N − T) × 0.25 × (체결금액 ÷ 시도금액)`
- 같은 날 매도·매수가 모두 체결되면 **매도 먼저 반영 후 매수 반영** (원본의 "×0.25 후 +1" 순서와 일치)

T 갱신은 체결 확정 시점(`handleStrategySignalFill` / reconciliation 후처리)에서 수행한다. 신호 생성 시점이 아니다.

## 4. NORMAL 모드

### 4.1 별지점

```
별% = starBasePct × (1 − 2T/N)          # 40분할 TQQQ: 15 − 0.75T 와 동치
별지점 = 평단 × (1 + 별%/100)
매수 기준가 = 별지점 − $0.01, 매도 기준가 = 별지점
```

- T ≥ N/2(후반전)부터 별%가 음수 → 별지점이 평단 아래 = 쿼터매도가 손절이 된다. 이것은 버그가 아니라 규칙이다.
- 보유가 없으면(평단 없음) 별지점 미정의 → 첫 매수 규칙 사용.

### 4.2 일일 매수 시도액

```
D = cashRemaining ÷ (N − T)
```

- 매일 재계산 (잔돈·매도 회수금 자동 재분배). 기존 carry 이월 메커니즘(`accumulatedQuota` 등)은 v4에서 사용하지 않는다.
- `T > N − 1`이면 매수하지 않고 REVERSE 전환 (§5).

### 4.3 매수 주문 (매일 1회, 전부 LOC)

| 국면 | 주문 구성 (총액 ≤ D) |
|---|---|
| 첫 매수 (보유 0, T=0) | `종가 × (1 + firstBuyMarkupPct)` LOC에 D 전액 (사실상 무조건 체결) + 사다리 |
| 전반전 (0 < T < N/2) | D/2를 평단 LOC + D/2를 (별지점−0.01) LOC + 사다리 |
| 후반전 (N/2 ≤ T ≤ N−1) | D 전액을 (별지점−0.01) LOC + 사다리 |

- `firstBuyMarkupPct` 기본 0.12 (원본 권장 범위 10~15%의 중앙).
- **사다리**: 주 주문 수량 산정 후 D의 잔여 예산으로, 기준가 대비 −5% / −10% / −15%에 1주씩 LOC 추가 (`ladderStepsPct` 파라미터, 기본 `[0.05, 0.10, 0.15]`). 폭락일에 D가 온전히 소진되게 하는 장치. **원본에 정확한 간격 규칙이 없어 임시 결정 — 백테스트로 튜닝한다.**
- **D가 주가 수준이라 주 leg가 전부 0주가 되는 경우**: 보정하지 않는다 (D9 기각 — §10 참조). 이 상태는 자본 부족으로 분할 구조 자체가 성립하지 않는 신호이므로, 최소 매수로 가리는 대신 원금 증액(D10) 또는 분할 축소 재시딩으로 해소한다.
- 주문가는 KIS 해외주문 허용 가격범위로 clamp하고, clamp 발생 시 `details`에 기록.

### 4.4 매도 주문 (매일 1회, 전·후반 공통)

| 주문 | 수량 | 가격/유형 |
|---|---|---|
| 쿼터매도 | `floor(보유 ÷ 4)` (최소 1주, 보유 ≥ 2일 때) | 별지점 LOC 매도 |
| 최종매도 | 보유 − 쿼터매도 수량 | `평단 × (1 + finalTargetPct/100)` 지정가 |

- v1 구현은 본장 시간대에 제출한다 (원본은 프리장부터 지정가 권장 — 효력 범위 차이는 백테스트에 영향 없고, 프리장 제출은 후속 개선 항목).
- 주간거래 세션은 사용하지 않는다.

### 4.5 사이클 종료

- 보유수량 0 확인 시 종료: `T = 0`, `cashRemaining` 재설정, `cycleSeq += 1`, Slack 알림 1회.
- `compoundMode` 파라미터: `true`(기본, 복리 — 잔금 전체를 새 원금으로) / `false`(단리 — principal 초과분은 사이클에서 제외하고 `details`로 보고만).
- 최종매도 후 같은 날 LOC 매수가 체결되어 보유가 남으면 종료가 아니다 — 그대로 진행.

## 5. REVERSE 모드 (소진 후)

### 5.1 진입

- 조건: `T > N − 1` (잔금이 남아 있어도 전환).
- 진입 시 Slack 알림 1회 (`phase='v4-reverse-enter'`).

### 5.2 규칙

```
리버스 별지점 = 직전 5거래일 종가 단순평균 (평단과 무관)
매도 분모 M = N/2   (N=40 → 20등분, N=20 → 10등분)
```

| 시점 | 매도 | 매수 |
|---|---|---|
| 진입 첫날 | `floor(보유 ÷ M)`개 **MOC** (무조건 체결) | 없음 |
| 이후 매일 | `floor(직전 보유 ÷ M)`개를 리버스 별지점 LOC 매도 | `cashRemaining ÷ 4` 금액을 (리버스 별지점 − 0.01) LOC 매수 |

- 매도 수량은 매일 "직전 보유수량" 기준 재계산 (감소 수열).
- 매도 회수금은 즉시 `cashRemaining`에 합산되어 다음 날 쿼터매수 분모에 반영.

### 5.3 종료

- 조건: **종가 > 평단 × (1 − finalTargetPct/100)** 확인 후 (TQQQ: 손실률이 −15% 이내로 회복).
- 종료 시 NORMAL 복귀. T·잔금·평단은 그대로 연결, D는 §4.2 식으로 재계산.
- NORMAL 복귀 후 다시 `T > N−1`이 되면 재차 REVERSE 진입 (반복 허용).

## 6. 구현 통합 (기존 계약 준수)

### 6.1 전략 클래스

- `src/trading/strategy/infinite-buy-v4.strategy.ts`, `PerStockTradingStrategy` 구현.
- `name: 'infinite-buy-v4'`, `displayName: '무한매수법 V4'`.
- `executionMode: { type: 'once-daily', hours: { domestic: 11, overseas: { basis: 'afterOpen', offsetHours: 2 } } }` — LOC/MOC는 종가 체결이므로 제출 시각은 체결에 영향 없음. 기존 게이팅 재사용.
- 순수 계산(별지점, D, T 갱신, 사다리 배분, 모드 전환 판정)은 `infinite-buy-v4-math.util.ts`로 분리 — 백테스트/유닛테스트 공유.
- `StrategyRegistryService`에 등록.

### 6.2 신호 매핑

- 하나의 평가에서 `TradingSignal[]`로 매수 2~5건 + 매도 2건을 함께 반환 (기존 다중 신호 경로 재사용).
- `orderDivision`: LOC=`'34'`. **MOC 주문구분 코드는 구현 시 KIS 문서로 확인** (kis-code-assistant MCP 활용). `KisOverseasService.orderBuy/orderSell`은 이미 `orderDivision` 파라미터를 받으므로 KIS 계층 변경은 없을 것으로 예상 — 확인만.
- `metadata.phase`: `v4-first-buy` / `v4-star-buy` / `v4-avg-buy` / `v4-ladder-buy` / `v4-quarter-sell` / `v4-final-sell` / `v4-reverse-sell` / `v4-reverse-buy`.
- 미체결 처리: once-daily 전략의 기존 규칙(다음 실행 전 전일 미체결 취소 후 재주문)을 그대로 사용. LOC는 당일 종가에만 유효하므로 이 규칙과 정합.

### 6.3 SELL 승인 게이트 — 정책 결정 필요 ⚠

후반전 쿼터매도·리버스 매도는 성격상 손절이지만 **매일 정례 발생**한다. 매 건 Slack 승인은 운영 불가능하므로:

- `v4-quarter-sell` / `v4-reverse-sell` / `v4-final-sell`은 승인 allowlist에 **포함하지 않는다** (자동 실행).
- 대신 REVERSE 진입 시 1회 알림 + 일일 체결 알림(기존 fill 알림)으로 가시성 확보.
- 이는 "청산성 SELL은 승인 대기" 기존 원칙의 **명시적 예외**다. 채택 시 `src/trading/CLAUDE.md`의 allowlist 문단에 예외 근거를 기록할 것.

### 6.4 T/잔금 갱신 시점

- 체결 확정은 reconciliation이 소유 → `TradingService.handleStrategySignalFill`에 v4 분기 추가: phase별로 §3 규칙에 따라 `strategyParams.v4.*` 갱신.
- 수동 매매 혼입 시: v4는 자체 잔금·T 장부가 진실이므로, broker 잔고와 보유수량이 불일치하면 skipReason으로 평가 중단하고 Slack 경고 (기존 infinite-buy의 수동매매 흡수와 다른 정책 — v4 장부 무결성 우선).

## 7. 백테스트

- `BacktestEngine`에 fillModel 2종 추가 (기존 `stop-entry` 패턴과 동일한 분기 방식):
  - `metadata.fillModel='loc'`: BUY는 `종가 ≤ limit`일 때 종가 체결, SELL은 `종가 ≥ limit`일 때 종가 체결. 미충족 시 미체결 소멸.
  - `metadata.fillModel='moc'`: 종가 무조건 체결.
- 전략은 `evaluationMode='daily-bar'`에서 위 fillModel 신호를 발행 — 체결 판정은 엔진 책임 (기존 계약 유지).
- 검증 시나리오: TQQQ/SOXL, 2020-01 ~ 2026-06 (코로나 폭락·2022 약세장·리버스 구간 포함 필수), 40분할 / 20분할.
- 비교군: ① 현행 `infinite-buy` ② `v4 순정` ③ `v4 + RSI hard-stop 오버레이`. 지표는 기존 metrics 재사용 + 사이클 수 / 사이클당 평균 기간 / REVERSE 진입 횟수 / 최대 실현손실 연속치 추가.

## 8. 테스트 (필수)

- `infinite-buy-v4-math.util.spec.ts`: 별지점 식(20/40분할 × TQQQ/SOXL 4조합), D 재계산, T 회계 6규칙(전량/부분 체결), 모드 전환 경계 (T=N−1, T=N/2), 리버스 종료 경계.
- `infinite-buy-v4.strategy.spec.ts`: 국면별 신호 구성(첫 매수/전반/후반/리버스 첫날/리버스 이후), DOMESTIC 거부, 사다리 예산 배분, 수동매매 불일치 중단.
- 트레이스 spec (기존 `*-trace.spec.ts` 패턴): 가상 시세 시퀀스로 사이클 시작→소진→리버스→복귀→종료 전 구간 재현.

## 9. 구현 순서 (Codex 위임 단위)

1. `infinite-buy-v4-math.util.ts` + spec — 순수 함수만, 의존성 없음
2. 백테스트 엔진 `loc`/`moc` fillModel + spec
3. 전략 클래스 + params 타입 + 레지스트리 등록 + spec
4. `handleStrategySignalFill` v4 분기 (T/잔금 갱신) + 승인 allowlist 예외 + trace spec
5. 백테스트 시나리오 실행 → 결과 리포트 (§7 비교군)
6. 모듈 `CLAUDE.md` 갱신 (전략 항목 + 승인 예외 근거)

각 단계는 독립 커밋. 5번 결과가 나오기 전까지 실계좌 `WatchStock`에 v4를 배정하지 않는다.

## 10. 결정 사항 요약 (원본에 없어서 우리가 정한 것)

| # | 결정 | 근거 / 후속 |
|---|---|---|
| D1 | T 회계를 체결 비율 연속식으로 일반화 | 부분 체결 현실 반영. 전량 체결 시 원본과 동치 |
| D2 | 사다리 간격 −5/−10/−15% 1주씩 | 원본 미명시. 백테스트로 튜닝 |
| D3 | 정례 손절성 매도(쿼터/리버스)는 승인 게이트 제외 | 매일 발생 — 승인 불가능. CLAUDE.md에 예외 기록 |
| D4 | 지정가 매도는 본장 제출 (프리장 제출은 후속) | 백테스트 영향 없음. 운영 단순화 |
| D5 | 수동매매 혼입 시 평가 중단 (흡수 안 함) | v4 장부(잔금/T) 무결성 우선 |
| D6 | 복리 기본 (`compoundMode=true`) | 원본 중계 방식 준용 |
| D7 | firstBuyMarkupPct 기본 12% | 원본 권장 범위 10~15% 중앙값 |
| D8 | TQQQ/SOXL 외 종목은 계수 명시 없이 비활성 | 원본 계수의 적용 범위 존중 |
| D9 | **기각** — 주 leg 전부 0주여도 최소 1주 보정하지 않음 | 최소 매수는 자본 부족(분할 구조 붕괴)을 가리는 장치라는 판단 (2026-08-04). 구현·백테스트까지 했으나 채택 안 함 — 회귀 무해성은 확인됨 (발동 없는 구간 결과 완전 동일). 해소는 D10 증액 경로로 |
| D10 | UI에서 V4 종목 quota 수정 시 증감분을 장부 잔금(cashRemaining)에 자동 반영 | 원금 변경을 장부에 전파하는 유일한 공식 경로. 감액은 잔금이 음수가 되지 않는 범위로 제한. 실제 예수금 뒷받침은 운영자 책임 (UI에 안내) |
