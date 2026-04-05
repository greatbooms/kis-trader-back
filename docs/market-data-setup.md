# 보조 시장데이터 API 설정 가이드

스크리닝과 분석 품질을 높이기 위한 **선택형 보조 데이터 소스** 설정 방법입니다.

- 국내 주식 보강: `OpenDART`
- 미국 주식 보강: `SEC EDGAR`, `FRED`

> KIS만으로도 서비스는 동작합니다. 아래 키를 추가하면 스크리닝 지표와 전략 판단에 보조 데이터가 반영됩니다.
>
> 보조 데이터와 일부 느리게 변하는 KIS 데이터는 `market_data_snapshots` 테이블에 스냅샷으로 저장되어, 스크리닝/시뮬레이션/실매매가 매번 외부 API를 다시 호출하지 않고 재사용합니다.

## 1. OpenDART 설정

국내 주식 스크리닝에서 최근 공시와 주요주주 지분 변화를 보강합니다.

### 1-1. 키 발급

1. [OpenDART](https://opendart.fss.or.kr/) 접속
2. 로그인 또는 회원가입
3. **인증키 신청/관리** → **인증키 신청**
4. 발급된 인증키 확인

### 1-2. 환경변수

```bash
OPENDART_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 1-3. 반영되는 데이터

- 최근 30일 공시 건수
- 최근 정기공시(사업/반기/분기보고서) 여부
- 최근 주요사항 공시 건수
- 최근 주요주주/임원 지분 변동률

### 1-4. 호출 제한

OpenDART 개발가이드의 메시지 설명에는 일반적으로 **20,000건 이상 요청 시 제한 에러(`020`)**가 발생할 수 있다고 안내되어 있습니다.

## 2. SEC EDGAR 설정

미국 종목 스크리닝에서 무료 공시/XBRL 재무 데이터를 보강합니다.

### 2-1. 준비 사항

SEC는 별도 API 키 없이 사용할 수 있지만, 요청 헤더에 **식별 가능한 User-Agent**를 넣어야 합니다.

권장 형식:

```text
MyCompany kis-trader admin@example.com
```

### 2-2. 환경변수

```bash
SEC_USER_AGENT=MyCompany kis-trader admin@example.com
```

### 2-3. 반영되는 데이터

- 매출 성장률
- 영업이익 성장률
- EPS 성장률
- 영업이익률 / 순이익률 / 매출총이익률
- 부채비율 / 유동비율
- 총자산 성장률 / 자기자본 성장률
- 배당수익률 / 배당성향
- 최근 `10-K`, `10-Q`, `8-K` filing 메타데이터

### 2-4. 호출 제한

SEC의 `Accessing EDGAR Data` 안내 기준 현재 최대 요청률은 **초당 10회**입니다.

## 3. FRED 설정

미국 금리 환경을 보강하기 위한 거시지표 소스입니다.

### 3-1. 키 발급

1. [FRED 계정](https://fredaccount.stlouisfed.org/) 생성
2. 로그인
3. [API Keys 페이지](https://fred.stlouisfed.org/docs/api/api_key.html)에서 키 발급

### 3-2. 환경변수

```bash
FRED_API_KEY=abcdefghijklmnopqrstuvwxyz123456
```

### 3-3. 반영되는 데이터

- 미국 기준금리(`FEDFUNDS`)
- 금리 상승 여부 판단

> 현재 구현은 미국 시장(`NASD`, `NYSE`, `AMEX`)의 시장 상황 판단에 FRED 기준금리를 우선 사용합니다.

## 4. `.env` 예시

```bash
# KIS API
KIS_APP_KEY=PSxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
KIS_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
KIS_ACCOUNT_NO=5012345601
KIS_PROD_CODE=01
KIS_ENV=prod

# Screening data enrichment (선택)
OPENDART_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SEC_USER_AGENT=MyCompany kis-trader admin@example.com
FRED_API_KEY=abcdefghijklmnopqrstuvwxyz123456
```

## 5. 배포 환경변수

Koyeb, Railway, Render 같은 배포 환경에서는 아래 3개만 추가로 넣으면 됩니다.

| 변수 | 용도 |
|------|------|
| `OPENDART_API_KEY` | 국내 공시/지분 공시 보강 |
| `SEC_USER_AGENT` | 미국 SEC API 요청 식별 |
| `FRED_API_KEY` | 미국 금리 데이터 조회 |

## 6. 동작 확인

1. 서버 실행 후 종목 스크리닝을 수행합니다.
2. 국내 종목은 OpenDART 기반 공시/지분 정보가 `indicators`와 추천 사유에 반영됩니다.
3. 미국 종목은 SEC 기반 재무 성장성/수익성/리스크 지표가 점수에 반영됩니다.
4. 미국 시장 상황 판단은 FRED 금리를 우선 사용합니다.
5. `market_data_snapshots` 테이블에 `kis`, `opendart`, `sec`, `fred` 소스의 스냅샷이 저장되는지 확인합니다.

## 7. 스냅샷 운영 방식

- 저장 위치: `market_data_snapshots`
- 저장 대상:
  - `OpenDART` 공시/지분 신호
  - `SEC` 미국 펀더멘털/filing 메타데이터
  - `FRED` 기준금리 스냅샷
  - 느리게 변하는 `KIS` 재무비율, 성장성/수익성, 배당, 컨센서스, 투자자 수급 일부
- 사용 경로:
  - 스크리닝
  - 딥 분석
  - 시뮬레이션
  - 실제 매매전략
- 갱신 방식:
  - 조회 시 만료되지 않은 스냅샷이 있으면 DB/메모리 캐시를 우선 사용
  - 만료되었거나 없으면 외부 API 호출 후 스냅샷 갱신
  - 활성 관심종목 기준으로 6시간마다 워밍업 크론이 선행 갱신

## 참고

- [OpenDART](https://opendart.fss.or.kr/)
- [SEC Accessing EDGAR Data](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)
- [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- [FRED API Key 안내](https://fred.stlouisfed.org/docs/api/api_key.html)
