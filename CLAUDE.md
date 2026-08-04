# KIS Trader Backend

한국투자증권(KIS) OpenAPI 기반 자동매매 백엔드. 전략이 장중에 신호를 생성하고 실제 주문을 제출하는 **금융 시스템**이라는 점을 모든 결정에서 전제한다.

## Tech Stack

- **Backend**: NestJS + Prisma + GraphQL (Apollo) on TypeScript
- **DB**: PostgreSQL
- **Frontend**: `client/` — React + Vite + Apollo Client + codegen
- **외부**: 한국투자증권 REST/WebSocket API, Slack Bolt, OpenDART, SEC EDGAR

## Architecture 원칙

### 계층
```
Resolver (GraphQL)      ← 입출력/인증만
  │
Service (Business Logic) ← 도메인 규칙, 트랜잭션 경계
  │
Infrastructure          ← Prisma / KIS API / Slack / Cache
```

- **Resolver는 얇게**: DTO ↔ Service 중계만. 비즈니스 로직 금지. 결과 매핑도 최소화
- **Service는 좁은 책임**: 한 서비스는 한 responsibility. 섞이면 분리 (아래 "Service Size Rules" 참조)
- **Infrastructure는 격리**: KIS API 호출은 `src/kis/*.service.ts`에만. 전략/거래 서비스에서 직접 fetch/axios 금지
- **모듈 경계 존중**: 다른 모듈의 private 내부 구현을 참조하지 말 것. `*.module.ts`의 `exports`에 없으면 쓰지 않는 것이 원칙

### 의존성 방향

- `resolver → service → service` (같은 모듈 내)
- `service → 하위 모듈의 exported service` (예: `TradingService → KisDomesticService`)
- **금지**: 순환 의존. `A → B → A` 경로 생기면 공유 기능을 별도 서비스로 추출
- **금지**: `service → resolver`, `service → scheduler`

## Code Conventions

### 타입 / DTO 파일 규칙

타입은 역할에 따라 별도 디렉토리/파일로 분리한다.

```
src/{module}/
├── types/                          # 순수 TS 타입 (interface, type, enum)
│   ├── {type-name}.type.ts         # 1타입 1파일 원칙
│   └── index.ts                    # re-export
├── dto/                            # GraphQL 데코레이터 클래스
│   ├── {name}.object.ts            # @ObjectType
│   ├── {name}.input.ts             # @InputType
│   └── index.ts
├── {module}.service.ts
├── {module}.resolver.ts
├── {module}.module.ts
└── CLAUDE.md                       # 필수 (아래 참조)
```

**규칙**:
1. **1타입 1파일**: 유지보수 우선. 밀접한 소규모 타입(~3개)은 한 파일 허용
2. **서비스/리졸버 파일에 타입 정의 금지** — 각각 `types/`, `dto/`에서 import
3. **모듈 간 공유 타입/DTO**: `src/common/types/`, `src/common/dto/`
4. **GraphQL enum 등록** (`registerEnumType`): 처음 사용하는 object 파일 하단에 배치

### 프론트엔드 타입 규칙

```
client/src/
├── types/common.types.ts           # 공통 타입
├── graphql/generated.ts            # codegen 자동 생성 (수정 금지)
├── pages/{page}/types/*.types.ts   # 페이지 전용
├── components/types/*.types.ts     # 공통 컴포넌트 props
└── hooks/types/*.types.ts          # 커스텀 훅 반환
```

- **GraphQL 타입은 codegen**: `generated.ts`에서 import, 직접 정의 금지
- 단순 props(~3개 속성)는 컴포넌트 파일 내 인라인 허용

### 네이밍

- **파일**: `kebab-case.type.ts`, `kebab-case.service.ts`
- **클래스**: `PascalCase`
- **함수/변수**: `camelCase`
- **상수**: `UPPER_SNAKE_CASE` (모듈 내 불변 상수만)
- **언어**: **비즈니스 도메인 용어는 한국어 OK** (주석, 로그, UI 문자열). 코드 심볼(변수/함수명)은 **영어**

### Async / 에러 처리

- `async/await`만 사용. Promise 체인 금지
- 서비스 메서드는 **성공 시 값 반환, 실패 시 throw**. boolean 반환으로 실패 신호 주지 말 것
- **외부 API 호출(KIS, Slack 등)은 try/catch + logger.warn** 로 감싸서 호출자에게 선택권을 주는 식 (전체 실행이 죽지 않게)
- `logger.error`는 정말 장애(스택 남겨야 할 상황)에만
- 빈 catch 금지. 최소 `logger.debug(reason)`이라도 남길 것

### 로그

- 모든 서비스는 `private readonly logger = new Logger(ClassName.name)` 사용
- **고정 prefix**: `[${stockCode}]` 또는 `[SIM ${sessionId}]`처럼 검색 가능하게
- **운영 레벨 기준**:
  - `error`: 장애 / 복구 필요
  - `warn`: 이상 징후 / 부분 실패
  - `log`: 의사결정 포인트 (시그널 생성, 주문 제출, 청산 등)
  - `debug`: 상세 추적 (기본 비활성)

## Module Documentation (CLAUDE.md per module)

각 모듈 디렉토리(`src/{module}/`)에는 **`CLAUDE.md`가 있어야 한다**. 모듈 분리/신설 시 함께 작성.

**템플릿**:
```markdown
# {Module Name}

## 책임
이 모듈이 다루는 핵심 책임 1~3문장.

## 주요 서비스 / 컴포넌트
- `{file}.ts` — 역할

## 외부 의존성
- npm 패키지, 내부 모듈 목록

## 주의사항 / 비자명한 규칙
- (예) "Slack 호출은 OrderReconciliationService만 거침"
- (예) "이 서비스의 public API는 resolver에서 호출 — 시그니처 변경 시 resolver/frontend codegen 함께 수정"
```

- **루트 `CLAUDE.md`(이 파일)**: 프로젝트 전체 규칙
- **모듈 `CLAUDE.md`**: 모듈 특화 규칙/주의사항

## Service Size Rules

| 파일 길이 | 상태 |
|---|---|
| ~600줄 | 정상 |
| 600~900줄 | 경고. 리팩토링 검토 |
| 900줄+ | 분리 필수. 신규 코드는 새 서비스로 |

**분리 신호**:
- 의존성 **8개 초과** → composition으로 재설계
- public 메서드 **10개 초과** → 세분화
- 한 메서드 **80줄 초과** → 재구성
- 서로 무관한 책임(예: "계산 + DB + Slack")이 섞임 → 분리

## 개발 원칙 (모든 코드 작성 시)

### 1. 행동 보존 우선
- 공개 API(GraphQL schema, service public method, frontend 컴포넌트 props) 변경 시 호환성 확인
- breaking change는 마이그레이션 계획과 함께

### 2. 테스트 / 검증
- **신규 서비스/전략**: 유닛 테스트 필수 (`*.spec.ts`)
- **수정 시**: 기존 테스트가 지나가는지 먼저 확인 → 변경 → 다시 확인
- 테스트 없는 코드 변경은 **기능 변경 금지, 이동/이름 변경만** 허용
- 빌드 + 테스트 통과 없이 커밋 금지: `npm run build`, `npx jest`

### 3. 의존성 최소화
- 새 서비스는 필요한 것만 주입 (상위 서비스 통째로 주입 금지)
- `Optional()` 주입은 명확한 이유가 있을 때만 (예: Slack off 환경)

### 4. 결정 문서화
- 비자명한 선택(예: "왜 일일 상한을 3×로?")은 **모듈 CLAUDE.md**에 근거 남기기
- 구현만 보고 의도 추측할 수 없으면 주석 1~2줄

### 5. KIS / 외부 API
- **Rate limit**: `KisBaseService`가 직렬화 큐로 일괄 관리 (prod 67ms ≈ 15req/s, paper 300ms ≈ 3req/s). 호출자에서 별도 딜레이/throttle 추가 금지 (이중 지연)
- **수정주가 기본**: 백테스트/과거 데이터 조회 시 수정주가(`MODP=1`/`FID_ORG_ADJ_PRC=0`) 강제
- **시세 캐시**: 반복 조회는 `MarketDataCacheService` 경유. 직접 API 호출 반복 금지
- **장 시간 외 호출**: 스케줄러는 장 시간 내에만 작동해야 함. `isMarketOpen` 체크 필수

### 6. 자금 안전
- **실전 주문은 `trading.enabled=true`인 환경에서만** (`ConfigService`로 가드)
- 손절/청산 시그널은 별도 승인(`StopLossApproval`) 후 실행
- 동시 실행 방지 플래그(`isRunning`) — 중복 주문 방지
- **액션 전 재동기화**: `TradingPositionRefreshService.refresh(market)` — 주문 제출 직전 KIS 최신 잔고 재조회 + DB 포지션 동기화

### 7. 비밀키 / 환경
- `.env.dev`, `.env.prod` 커밋 금지 (`.gitignore` 확인)
- 코드에서 `process.env` 직접 접근 금지. `ConfigService` 경유
- 로그/에러 메시지에 API 키/토큰 노출 금지

### 8. 데이터베이스
- Prisma 스키마 변경 시 **반드시 마이그레이션 생성**: `npm run prisma:migrate -- --name descriptive_name`
- 마이그레이션 파일 수동 편집 가능 (Prisma 생성 SQL + 보정)
- `prisma.$transaction` — 여러 테이블 동시 수정 시 원자성 보장
- 인덱스: 외래키 자동 / 자주 `where` 걸리는 컬럼은 `@@index` 수동 추가

### 9. GraphQL
- **Query/Mutation 추가 시**: 클라이언트 `*.graphql` 파일에 operation 추가 → `npm run client:codegen` 으로 `generated.ts` 재생성
- **서버 스키마(`src/schema.gql`) 변경 시**: 리졸버 추가/변경 후 `npm run client:codegen`을 돌리기 전에 `start:dev`로 앱을 부팅해 NestJS 코드-퍼스트가 `src/schema.gql`을 갱신할 것
- Resolver는 **trivial CRUD만 인라인**, 복잡한 로직은 Service로
- N+1 주의: DataLoader 없이 배치 조회는 `prisma.model.findMany({ where: { id: { in: [...] } } })` 패턴

## 커밋 / 브랜치

- **Conventional Commits** (글로벌 CLAUDE.md 참조)
  - `feat`, `fix`, `refactor`, `chore`, `docs`, `style`, `perf`, `test`
- **커밋 메시지 형식**: `type(scope): summary` 형태를 기본으로 한다.
  - 예: `fix(deploy): verify pm2 release path`
  - scope는 선택이지만, 변경 영역이 분명하면 사용한다 (`deploy`, `trading`, `screening` 등)
- **브랜치명 형식**: 에이전트/도구 이름 prefix를 쓰지 말고 Conventional Commits의 type을 앞세운다.
  - 예: `fix/deploy-pm2-release-path`, `feat/news-scoring`, `docs/update-agent-rules`
  - 금지 예: `codex/fix-deploy-pm2-release-path`, `claude/...`, `agent/...`
- **작업 시작 절차**: 작업 전에는 항상 `main` 브랜치로 전환해 최신 원격 변경을 pull 받은 뒤, 그 최신 `main`을 베이스로 작업 브랜치를 생성하고 작업을 진행한다.
- **커밋 단위 작게**: 한 커밋 = 한 논리적 변경
- **리팩토링과 기능 변경 섞지 말 것**: `refactor:` 먼저, 이어서 `feat:`
- 커밋/푸시는 **사용자가 요청할 때만** 수행

## Claude / Codex 역할 분담

- **설계는 Claude, 구현은 Codex**: Claude가 설계(스펙/계획)를 작성하고, 구현 작업은 Codex에게 위임한다. 아래 Agent Team Configuration의 backend/frontend/tester 구현 role도 Codex 위임 대상이며, reviewer와 설계는 Claude가 맡는다.
- **푸시 전 Codex 적대적 리뷰 필수**: push 전에 Codex 적대적 리뷰를 실행한다. 수정해야 할 사항이 나오면 푸시를 취소하고, 수정 후 리뷰를 다시 통과한 뒤에만 푸시한다.
- **리뷰 범위는 브랜치 작업분에 한정**: 푸시 전 적대적 리뷰는 해당 브랜치에서 작업한 변경분(main 대비 diff)만 대상으로 한다. 변경분과 무관한 기존 코드/문서의 문제는 푸시를 막지 않으며 별도 이슈나 후속 브랜치로 다룬다. 단, 변경분의 동작·안전에 영향을 주는 기존 문제는 리뷰 대상이며 푸시를 막는다.

## Agent Team Configuration

복잡한 다중 파일 작업 시 아래 구성으로 팀 생성.

| Role | 범위 | 특징 |
|---|---|---|
| backend | `src/` 서비스/리졸버/Prisma | NestJS 코드 구현 |
| frontend | `client/` | React/GraphQL/codegen |
| tester | `*.spec.ts` 전반 | 유닛/통합/e2e |
| reviewer | read-only 모드 (plan approval) | 컨벤션/보안/성능 검토 |

**규칙**:
- reviewer는 plan approval을 받아야 write 모드 전환
- backend/frontend는 디렉토리 충돌 없음 → 병렬 가능
- tester는 backend/frontend 작업 완료 후 진입

## 참고 체크리스트

신규 기능/수정 작업 시 아래 항목 통과 확인:

- [ ] 해당 모듈의 `CLAUDE.md` 읽음 (있다면)
- [ ] 타입/DTO는 `types/`, `dto/`에 정의
- [ ] 서비스 파일에 타입 정의 없음
- [ ] 서비스 크기 가이드 준수 (600줄 이하 지향)
- [ ] `process.env` 직접 접근 없음 (ConfigService 경유)
- [ ] 외부 API 호출에 에러 처리 있음
- [ ] 테스트 작성/수정
- [ ] `npm run build` 성공
- [ ] `npx jest` 통과
- [ ] Prisma 스키마 변경 시 마이그레이션 생성
- [ ] GraphQL 스키마 변경 시 codegen 재생성 (`npm run client:codegen`)
- [ ] 신규 모듈 생성 시 `CLAUDE.md` 작성
