# Common Module

## 책임
여러 모듈이 공유하는 **순수 유틸**(외부 의존 없는 함수)을 모아두는 곳. 도메인 로직은 두지 말고, 단순 파싱/포맷/요약 헬퍼만.

## 주요 파일
- `types/` — 여러 모듈이 공유하는 외부 의존 없는 순수 TypeScript 타입
- `broker-mutation.error.ts` — broker mutation의 명시적 거절과 제출 결과 불명 의미론을 공유하는 기반 에러
- `utils/broker-account-hash.util.ts` — broker account context용 SHA-256 해시
- `utils/broker-label.util.ts` — 사용자 표시용 broker enum 한글 라벨
- `utils/api-data.util.ts` — KIS API 응답에서 숫자/문자 안전 추출 (`pickNumeric`, `pickString`)
- `utils/consensus.util.ts` — 컨센서스/투자의견 데이터 요약 (`summarizeEstimatePerform`, `summarizeInvestOpinion`)
- `utils/dividend.util.ts` — 배당 일정/캘린더 요약 (`summarizeDividendSchedule`)

이 유틸들은 원래 `src/screening/utils/`에 있었으나 `trading-orchestrator`도 사용하면서 cross-module dependency가 생겨 `common/utils/`로 이전됨.

## 외부 의존성
- `@prisma/client` — 표시 전용 `Broker` enum 타입

## 주의사항
- **순수 함수/타입만**: NestJS 데코레이터(`@Injectable` 등) 사용 금지. DB/HTTP 호출 금지. 의존성 주입 없음.
- **도메인 로직 금지**: 전략 계산, 거래 결정, 사용자별 상태 변형 같은 로직은 각 도메인 모듈에 둘 것. 여기는 데이터 정규화/요약만.
- **단방향 의존**: `common/utils/`는 다른 모듈을 import하지 않음. 다른 모듈은 자유롭게 import 가능.
- 새 utility 추가 시: (1) 두 모듈 이상에서 사용하는지 확인 (2) 외부 의존이 없는지 확인 (3) 한 모듈 전용이면 해당 모듈 내부에 두는 것이 우선
