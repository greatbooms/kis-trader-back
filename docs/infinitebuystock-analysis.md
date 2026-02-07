# InfiniteBuyStock 프로젝트 분석

> **분석 대상**: `/Users/shinsanghoon/Downloads/InfiniteBuyStock-main`
> Android/Kotlin 기반 미국 주식 자동매매 앱 (KIS Open API 사용)

---

## 1. 프로젝트 개요

미국 주식(NASD)을 대상으로 한 **무한매수법(Quota-Based Incremental Trading)** 전략 실행 앱.
사용자가 종목별 일일 투자 금액(quota)을 설정하면, 진행률(T)에 따라 매수/매도 가격과 수량을 자동 계산하여 주문을 실행한다.

### 기술 스택
- **Android** (minSdk 30, compileSdk 34, Kotlin 1.8.20)
- **MVVM**: ViewModel + LiveData + Coroutines
- **Network**: Retrofit 2.9.0 + OkHttp (KIS API 직접 호출)
- **DB**: Room (로컬 거래 이력 저장)
- **디버깅**: Flipper

### 프로젝트 구조
```
app/src/main/java/com/kgp/infinitebuystock/
├── App.kt                      # Application (Flipper 초기화)
├── MainActivity.kt             # 메인 UI (토큰 발급, 잔고 조회)
├── MainViewModel.kt            # 잔고 관리, 토큰 발급
├── UserInfo.kt                 # 토큰 저장/만료 체크
├── PrefUtil.kt                 # SharedPreferences 래퍼
├── network/
│   ├── ApiInterface.kt         # Retrofit API (잔고조회, 토큰, 주문)
│   ├── AppRetrofitBuilder.kt   # OkHttp + 토큰 인터셉터
│   ├── NetworkConfig.kt        # BASE_URL 상수
│   └── model/
│       ├── IssueTokenModel.kt  # 토큰 요청/응답
│       ├── Balance.kt          # 잔고 응답 모델
│       └── OrderModel.kt       # 주문 요청/응답
├── db/
│   ├── StockDatabase.kt        # Room DB (마이그레이션 포함)
│   ├── EachDayStockEntity.kt   # 일별 거래 기록 엔티티
│   └── EachDayStockDao.kt      # DAO
└── stock/
    ├── EachStockViewModel.kt   # ★ 핵심 매매 로직
    ├── EachStockFragment.kt    # 종목별 상세 UI
    ├── Stock.kt                # UI 모델
    └── StockUiModel.kt         # 잔고 UI 모델
```

---

## 2. 핵심 매매 전략: 무한매수법

### 2-1. 기본 개념

종목별로 **일일 투자 금액(quota)**을 정하고, 매일 그 금액만큼 분할 매수한다.
**진행률(T)**이 올라갈수록 매수 가격을 낮추고, 목표 수익에 도달하면 부분 매도한다.

### 2-2. 핵심 변수

| 변수 | 계산식 | 설명 |
|------|--------|------|
| **quota** | 사용자 입력 (예: $200) | 1회차 투자 금액 (달러) |
| **progress (T)** | `총매수금액 / quota` | 현재 진행 회차 (0~40+) |
| **tenMinusHalfT** | `(10 - T/2 + 100) / 100 × 평단가` | 평단 대비 동적 가격 기준선 |

### 2-3. 매수/매도 가격 계산

#### 매수 가격
```
Buy1 가격 = min(현재가 × 1.2, 평단가)
Buy2 가격 = tenMinusHalfT - 0.01
         = ((10 - T/2 + 100) / 100 × 평단가) - 0.01
```

- **Buy1**: 현재가보다 20% 높은 가격 또는 평단가 중 낮은 값 (LOC 주문)
- **Buy2**: 진행률에 따라 동적으로 변하는 가격. T가 커질수록 평단보다 낮은 가격에 매수

#### 매도 가격
```
Sell1 가격 = tenMinusHalfT
           = (10 - T/2 + 100) / 100 × 평단가
Sell1 수량 = 보유수량 / 4 (반올림)

Sell2 가격 = 평단가 × 1.1 (평단 대비 +10%)
Sell2 수량 = 보유수량 - Sell1 수량 (나머지 전부)
```

- **Sell1**: 진행률 기반 동적 가격으로 1/4 매도 (LOC)
- **Sell2**: 평단 대비 10% 수익에 3/4 매도 (지정가)

### 2-4. 매수 수량 계산 (`calculateBuyAmount`)

일일 quota 내에서 Buy1과 Buy2를 번갈아 채워넣는 방식:

```typescript
// 의사코드
buy1Count = 0, buy2Count = 0
while (true) {
  // Buy1 한 주 추가 시도
  if (buy1Price × (buy1Count + 1) + buy2Price × buy2Count > quota) break;
  buy1Count++;

  // Buy2 한 주 추가 시도
  if (buy1Price × buy1Count + buy2Price × (buy2Count + 1) > quota) break;
  buy2Count++;
}
```

Buy1과 Buy2를 교대로 1주씩 추가하며 quota를 초과하지 않는 최대 수량을 구한다.

### 2-5. 진행률별 실행 분기

#### T < 20 (`doAllBefore20`) — 초기 매집 단계
```
1. Buy1 (LOC): min(현재가×1.2, 평단가) 로 N주 매수
2. Buy2 (LOC): (tenMinusHalfT - 0.01) 로 M주 매수
3. Sell1 (LOC): tenMinusHalfT 로 보유량의 1/4 매도
4. Sell2 (지정가): 평단가×1.1 로 나머지 3/4 매도
5. DB 기록 저장
```

#### 20 ≤ T < 40 (`doAllAfter20`) — 후기 매집 단계
```
1. Buy1 생략 (현재가 매수 안 함)
2. Buy2 (LOC): min(tenMinusHalfT-0.1, 현재가×1.2) 로 quota/가격 만큼 매수
3. Sell1 (LOC): tenMinusHalfT 로 1/4 매도
4. Sell2 (지정가): 평단가×1.1 로 3/4 매도
5. DB 기록 저장
```

#### T ≥ 40 — 수동 전환
```
Toast: "40회차 이상은 수동으로 하기"
```

### 2-6. 주문 타입

| 주문 | TR ID | 주문방식(ORD_DVSN) | 설명 |
|------|-------|------------------|------|
| 매수 LOC | `TTTT1002U` | `34` (LOC) | Limit On Close — 종가 기준 지정가 |
| 매도 LOC | `TTTT1006U` | `34` (LOC) | 종가 기준 지정가 매도 |
| 매도 지정가 | `TTTT1006U` | `00` (지정가) | 일반 지정가 매도 (시간외 LOC 없어서 대체) |

> **LOC (Limit On Close)**: 장 마감 시 지정가 이하(매수)/이상(매도)이면 체결되는 주문.
> 매일 장 마감 직전에 실행하는 전략에 적합.

### 2-7. 전략 요약 도식

```
[매일 반복]
                    T < 20                          T ≥ 20
                  ┌───────────┐                  ┌───────────┐
                  │ Buy1(LOC) │                  │           │
                  │ 현재가근처 │                  │ Buy1 생략  │
                  └─────┬─────┘                  └─────┬─────┘
                        │                              │
                  ┌─────▼─────┐                  ┌─────▼─────┐
                  │ Buy2(LOC) │                  │ Buy2(LOC) │
                  │ 평단 아래  │                  │ 더 낮은가격 │
                  └─────┬─────┘                  └─────┬─────┘
                        │                              │
                  ┌─────▼─────┐                  ┌─────▼─────┐
                  │Sell1(LOC) │                  │Sell1(LOC) │
                  │ 1/4 물량  │                  │ 1/4 물량  │
                  │ 동적가격   │                  │ 동적가격   │
                  └─────┬─────┘                  └─────┬─────┘
                        │                              │
                  ┌─────▼─────┐                  ┌─────▼─────┐
                  │Sell2(지정) │                  │Sell2(지정) │
                  │ 3/4 물량  │                  │ 3/4 물량  │
                  │ 평단+10%  │                  │ 평단+10%  │
                  └─────┬─────┘                  └─────┬─────┘
                        │                              │
                  ┌─────▼─────┐                  ┌─────▼─────┐
                  │ DB 기록    │                  │ DB 기록    │
                  └───────────┘                  └───────────┘
```

---

## 3. KIS API 사용 패턴

### 3-1. 인증 (토큰)
- **엔드포인트**: `POST /oauth2/tokenP`
- **Base URL**: `https://openapi.koreainvestment.com:9443` (실전투자)
- 토큰은 SharedPreferences에 저장, 만료 1시간 전 갱신
- OkHttp 인터셉터로 모든 API 요청에 자동 주입:
  ```
  authorization: Bearer {accessToken}
  appkey: {APP_KEY}
  appsecret: {APP_SECRET}
  content-type: application/json; charset=utf-8
  ```

### 3-2. 잔고 조회
- **엔드포인트**: `GET /uapi/overseas-stock/v1/trading/inquire-balance`
- **TR ID**: `TTTS3012R` (해외주식 잔고)
- **파라미터**: 계좌번호, 거래소코드(NASD), 통화(USD)
- **응답 필드 (output1 배열)**:
  | 필드 | 의미 |
  |------|------|
  | `ovrs_pdno` | 종목코드 (SOXL, TQQQ 등) |
  | `ovrs_cblc_qty` | 보유수량 |
  | `pchs_avg_pric` | 매입평균가 |
  | `now_pric2` | 현재가 |
  | `ovrs_excg_cd` | 거래소코드 |
  | `frcr_pchs_amt1` | 매수총액 |
  | `evlu_pfls_rt` | 손익률 |

### 3-3. 주문
- **엔드포인트**: `POST /uapi/overseas-stock/v1/trading/order`
- **매수**: TR ID `TTTT1002U`, **매도**: TR ID `TTTT1006U`
- **주문 파라미터**:
  | 필드 | 값 |
  |------|-----|
  | `CANO` | 계좌번호 8자리 |
  | `ACNT_PRDT_CD` | 상품코드 2자리 |
  | `OVRS_EXCG_CD` | 거래소 (NASD) |
  | `PDNO` | 종목코드 |
  | `ORD_QTY` | 주문수량 |
  | `OVRS_ORD_UNPR` | 주문가격 |
  | `ORD_DVSN` | 주문유형 (`00`=지정가, `34`=LOC) |
  | `ORD_SVR_DVSN_CD` | `"0"` |

### 3-4. Rate Limiting
- 주문 간 `delay(200)` (200ms) 적용
- 네트워크 타임아웃: 3초

---

## 4. 데이터 모델

### Room DB: `each_day_stock`
```
id              : Long (PK, auto)
name            : String      -- 종목코드 (SOXL, TQQQ)
currentPrice    : Float       -- 실행 시점 현재가
averageBoughtPrice : Float    -- 실행 시점 평단가
count           : Int         -- 보유 수량
timestamp       : LocalDateTime
cycle           : Int         -- 매매 사이클 번호 (v2에서 추가)
quota           : Int         -- 일일 투자금액 (v3에서 추가)
```

- 같은 종목의 최근 기록이 3시간 이내면 **덮어쓰기** (같은 날 중복 방지)
- 3시간 초과면 **새 레코드** 생성

### SharedPreferences 저장 항목
- `accessToken`, `accessTokenExpired`: KIS 토큰
- `exchangeRate`: 원/달러 환율 (수동 입력)
- `{종목명}`: 해당 종목의 일일 quota
- `{종목명}_cycle`: 해당 종목의 현재 사이클 번호

---

## 5. 동작 흐름 (End-to-End)

```
1. 앱 실행
   └→ MainActivity.onCreate()
      └→ MainViewModel.getCurrentBalance()
         ├→ 토큰 만료 확인 → 필요시 issueToken()
         └→ inquireBalance(NASD) → 보유 종목 목록 로드

2. ViewPager에 종목별 Fragment 표시
   └→ EachStockFragment
      └→ EachStockViewModel.setStockBalance(balance)
         └→ 기본 정보 표시 + calculate(quota)

3. 사용자가 quota 입력 후 "계산" 버튼
   └→ calculate(quota)
      ├→ progress = 총매수금액 / quota
      ├→ tenMinusHalfT 계산
      ├→ 25% 물량, 매수/매도 가격 등 표시
      └→ SharedPreferences에 quota 저장

4. 사용자가 "한번에 실행" 버튼 (또는 개별 매수1/매수2/매도1/매도2)
   └→ doAll()
      ├→ T < 20: doAllBefore20()
      │   ├→ buyLOC(Buy1가격, Buy1수량)  [200ms gap]
      │   ├→ buyLOC(Buy2가격, Buy2수량)  [200ms gap]
      │   ├→ sellLOC(Sell1가격, 1/4수량) [200ms gap]
      │   ├→ sellAfter(Sell2가격, 3/4수량)
      │   └→ insertTodayStockToDB()
      └→ T ≥ 20: doAllAfter20() (Buy1 생략, 나머지 동일)
```

---

## 6. kis-trader-back 적용 포인트

### 6-1. 전략 구현

`src/trading/strategy/` 에 `InfiniteBuyStrategy` 를 구현할 수 있다:

```typescript
// 필요한 설정값 (WatchStock에 추가하거나 별도 테이블)
interface InfiniteBuyConfig {
  stockCode: string;
  exchangeCode: string;
  quota: number;        // 1회차 투자금액 (달러)
  cycle: number;        // 현재 사이클
}

// 핵심 계산
function calcProgress(totalInvested: number, quota: number): number {
  return totalInvested / quota;
}

function calcTenMinusHalfT(progress: number, avgPrice: number): number {
  return ((10 - progress / 2 + 100) / 100) * avgPrice;
}
```

### 6-2. 주문 방식 차이점

| 항목 | InfiniteBuyStock (원본) | kis-trader-back (우리) |
|------|----------------------|---------------------|
| 주문 트리거 | 사용자 버튼 클릭 | 스케줄러 자동 실행 |
| 주문 시점 | 장 마감 직전 (LOC) | 주기적 (30초 간격) |
| 시장 | 미국(NASD)만 | 국내 + 해외 9개 거래소 |
| 주문 유형 | LOC(`34`) + 지정가(`00`) | 시장가/지정가 (LOC 추가 필요) |
| 잔고 API | `inquire-balance` (TTTS3012R) | `inquire-present-balance` (CTRP6504R) |

### 6-3. 스키마 확장 필요사항

무한매수법 전략을 적용하려면 `WatchStock` 모델에 전략 설정을 추가해야 함:

```prisma
model WatchStock {
  // ... 기존 필드 ...
  strategyName  String?  @map("strategy_name")  // 적용 전략
  quota         Int?                             // 1회차 투자금액
  cycle         Int      @default(0)             // 현재 사이클
}
```

### 6-4. LOC 주문 지원

원본 앱은 LOC 주문(`ORD_DVSN: "34"`)을 핵심으로 사용한다.
`KisOverseasService`에 LOC 주문 옵션을 추가해야 함:

```typescript
// ORD_DVSN 값
// "00" = 지정가
// "31" = MOO (Market On Open)
// "32" = LOO (Limit On Open)
// "33" = MOC (Market On Close)
// "34" = LOC (Limit On Close) ← 핵심
```

### 6-5. 자동화 시 고려사항

원본은 **반자동**(사용자가 버튼을 눌러 실행)이지만, 우리는 **완전 자동**.
따라서 추가로 고려해야 할 점:

1. **실행 시점**: 미국장 마감 직전(05:50 KST쯤)에 LOC 주문 → 별도 cron 필요
2. **일 1회 실행 보장**: 같은 날 중복 실행 방지 (원본의 3시간 체크 로직 참고)
3. **40회차 안전장치**: T ≥ 40이면 자동매매 중단
4. **잔고 API 차이**: 원본은 `TTTS3012R`(inquire-balance), 우리는 `CTRP6504R`(inquire-present-balance) 사용 중 → 전략에 필요한 `frcr_pchs_amt1`(매수총액) 필드가 있는지 확인 필요

---

## 7. 전략 수식 정리

```
입력:
  quota      = 일일 투자금액 (예: $200)
  avgPrice   = 매입평균가
  curPrice   = 현재가
  totalPrice = 매수총액 (= avgPrice × 보유수량)
  holdQty    = 보유수량

계산:
  T          = totalPrice / quota                    (진행 회차)
  baseRate   = (10 - T/2 + 100) / 100               (동적 비율, T=0일때 1.10, T=20일때 1.00)
  pivotPrice = baseRate × avgPrice                   (기준 가격선)

매수:
  buy1Price  = min(curPrice × 1.2, avgPrice)         (현재가 근처, T<20만)
  buy2Price  = pivotPrice - 0.01                     (기준선 바로 아래)
  buy1Qty, buy2Qty = 교대로 채워서 quota 이내

매도:
  sell1Price = pivotPrice                            (기준 가격선)
  sell1Qty   = round(holdQty / 4)                    (1/4 물량)
  sell2Price = avgPrice × 1.1                        (평단 +10%)
  sell2Qty   = holdQty - sell1Qty                    (3/4 물량)

특이사항:
  T ≥ 20 → buy1 생략, buy2만 실행 (가격: min(pivotPrice-0.1, curPrice×1.2))
  T ≥ 40 → 자동매매 중단 (수동 전환)
```

### baseRate(동적 비율)의 의미

| T (진행률) | baseRate | pivotPrice (평단 $10 기준) |
|-----------|----------|--------------------------|
| 0 | 1.100 | $11.00 |
| 4 | 1.080 | $10.80 |
| 10 | 1.050 | $10.50 |
| 20 | 1.000 | $10.00 (= 평단) |
| 30 | 0.950 | $9.50 |
| 40 | 0.900 | $9.00 |

→ 초기에는 평단보다 높은 가격에 매도 (수익 실현), 후반에는 평단 아래에서 매수 (물타기)
