# KIS API 키 발급 가이드

한국투자증권 Open Trading API를 사용하기 위한 앱 키 발급 및 설정 방법입니다.

## 1. 한국투자증권 계좌 개설

실전투자 API를 사용하려면 한국투자증권 계좌가 필요합니다.

1. [한국투자증권 홈페이지](https://www.truefriend.com/) 가입
2. 비대면 계좌 개설 (주식 거래 가능 계좌)
3. 계좌번호 확인 (10자리, 예: `50123456-01`)

## 2. KIS Developers API 키 발급

1. [KIS Developers](https://apiportal.koreainvestment.com/) 접속
2. 회원가입 후 로그인
3. **API 신청** 메뉴 이동
4. **실전투자** 앱 키 발급 신청
   - 앱 이름: 자유 입력 (예: `kis-trader`)
   - 용도: 자유 입력
5. 발급 완료 후 다음 정보를 확인:
   - **APP KEY** — `KIS_APP_KEY`에 사용
   - **APP SECRET** — `KIS_APP_SECRET`에 사용

> 모의투자(paper) 키도 별도로 발급 가능합니다. 모의투자 사용 시 `KIS_ENV=paper`로 설정하세요.

## 3. 환경변수 설정

`.env` 파일에 발급받은 키를 입력합니다:

```bash
# KIS API
KIS_APP_KEY=PSxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
KIS_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
KIS_ACCOUNT_NO=5012345601    # 계좌번호 10자리 (하이픈 제외)
KIS_PROD_CODE=01             # 상품코드 (기본값 01)
KIS_ENV=prod                 # prod: 실전투자, paper: 모의투자
```

| 변수 | 설명 | 비고 |
|------|------|------|
| `KIS_APP_KEY` | API 앱 키 | KIS Developers에서 발급 |
| `KIS_APP_SECRET` | API 앱 시크릿 | KIS Developers에서 발급 |
| `KIS_ACCOUNT_NO` | 계좌번호 (10자리) | 하이픈 없이 입력 |
| `KIS_PROD_CODE` | 상품코드 | 일반적으로 `01` |
| `KIS_ENV` | 환경 구분 | `prod` (실전) / `paper` (모의) |

## 4. 토큰 관리

- 서버가 시작되면 `KIS_APP_KEY`와 `KIS_APP_SECRET`으로 **접근 토큰(Access Token)**을 자동 발급합니다.
- 토큰은 DB에 저장되며, 만료 전 자동으로 갱신됩니다.
- 수동 개입 없이 토큰 라이프사이클이 관리됩니다.

## 5. API 사용 제한

KIS Open API에는 다음 제한이 있습니다:

| 항목 | 제한 |
|------|------|
| 초당 요청 | 20건 |
| 일일 요청 | 제한 없음 (정상 사용) |
| 동시 접속 | 앱 키 1개당 1세션 |

> 동일 앱 키로 여러 서버에서 동시 접속하면 토큰 충돌이 발생할 수 있습니다.
> 하나의 서버에서만 운영하세요.

## 6. 해외주식 거래 사전 설정

해외주식 자동매매를 사용하려면 한국투자증권 앱(MTS)에서 **해외주식 거래 신청**이 필요합니다:

1. 한국투자증권 앱 → 해외주식 → 거래 신청
2. 미국, 홍콩, 중국, 일본, 베트남 등 원하는 시장 선택
3. 환전 (원화 → 외화) 또는 원화 자동환전 설정

## 참고

- [KIS Developers 포털](https://apiportal.koreainvestment.com/)
- [KIS Open API 문서](https://apiportal.koreainvestment.com/apiservice)
