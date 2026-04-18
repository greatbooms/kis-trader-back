# KIS Trader Backend

## Project Overview
KIS (Korea Investment & Securities) 자동매매 백엔드 서비스
- Backend: NestJS + Prisma + GraphQL
- Frontend: client/ (React + Vite, 같은 레포 내 통합)

## Code Conventions

### 타입 정의 규칙

타입은 역할에 따라 별도 디렉토리/파일로 분리한다.

**디렉토리 구조:**
```
src/
├── {module}/
│   ├── types/
│   │   ├── {type-name}.type.ts      # 타입/인터페이스 1개당 1파일
│   │   └── index.ts                 # re-export
│   ├── dto/
│   │   ├── {object-name}.object.ts  # @ObjectType 1개당 1파일
│   │   ├── {input-name}.input.ts    # @InputType 1개당 1파일
│   │   └── index.ts                 # re-export
│   ├── {module}.service.ts
│   ├── {module}.resolver.ts
│   └── {module}.module.ts
```

**규칙:**
1. **1타입 1파일**: 모든 타입/인터페이스와 DTO 클래스는 각각 개별 파일로 분리 (유지보수 용이)
2. **`types/`** - 순수 TypeScript 타입 (interface, type alias, enum). 서비스/비즈니스 로직에서 사용
   - 파일명: `{type-name}.type.ts` (예: `trading-signal.type.ts`, `stock-indicators.type.ts`)
   - 밀접하게 연관된 소규모 타입(2~3개 이하)은 하나의 파일에 포함 가능
3. **`dto/`** - GraphQL 리졸버용 클래스. 데코레이터(@ObjectType, @InputType, @Field 등)가 붙은 클래스
   - `*.object.ts`: `@ObjectType()` 클래스 1개당 1파일 (예: `strategy-info.object.ts`)
   - `*.input.ts`: `@InputType()` 클래스 1개당 1파일 (예: `set-strategy-allocation.input.ts`)
   - GraphQL enum 등록(`registerEnumType()`)은 해당 enum을 처음 사용하는 object 파일에 배치
4. **index.ts로 re-export**: types/와 dto/ 각각 index.ts에서 모든 항목을 re-export하여 import 편의성 확보
5. **서비스 파일(.service.ts)에 타입 정의 금지**: types/에서 import
6. **리졸버 파일(.resolver.ts)에 타입 정의 금지**: dto/에서 import
7. 모듈 간 공유 타입은 `src/common/types/`에, 공유 DTO는 `src/common/dto/`에 정의

### 프론트엔드 타입 정의 규칙

프론트엔드(client/)에서도 타입은 별도 파일로 분리한다.

**디렉토리 구조:**
```
src/
├── types/
│   ├── common.types.ts              # 공통 타입 (유틸리티 타입, 공유 인터페이스)
│   └── index.ts                     # 타입 re-export
├── graphql/
│   ├── generated.ts                 # codegen 자동 생성 (수정 금지)
│   ├── *.graphql                    # GraphQL operation 정의
│   └── ...
├── pages/
│   └── {page}/
│       └── types/
│           └── {page}.types.ts      # 페이지 전용 타입 (props, state, form 등)
├── components/
│   └── types/
│       └── components.types.ts      # 공통 컴포넌트 props 타입
└── hooks/
    └── types/
        └── hooks.types.ts           # 커스텀 훅 반환 타입
```

**규칙:**
1. **GraphQL 타입은 codegen이 생성**: `src/graphql/generated.ts`에서 import (직접 정의 금지)
2. **컴포넌트 파일에 타입 정의 금지**: 별도 types/ 파일에서 import
3. **페이지별 전용 타입**: 해당 페이지 디렉토리의 types/에 정의
4. **공통 타입**: `src/types/`에 정의
5. 단순 props 타입(3개 이하 속성)은 컴포넌트 파일 내 인라인 허용

**기존 예시 (이미 적용됨):**
- `src/kis/types/kis-api.types.ts` - KIS API 요청/응답 타입
- `src/kis/types/kis-config.types.ts` - KIS 설정, 거래소 코드 enum

**리팩토링 필요 (현재 타입이 섞여있는 파일):**
- `src/trading/trading.resolver.ts`:
  - StrategyInfo, StrategyAllocationType, MarketRegimeType, RiskStateType → `src/trading/dto/trading.object.ts`
  - SetStrategyAllocationInput → `src/trading/dto/trading.input.ts`
- `src/trading/strategy/strategy.interface.ts` → `src/trading/types/trading.types.ts`
- `src/trade-record/trade-record.resolver.ts`:
  - TradeRecordType, PositionType, StockPriceType, DashboardSummaryType, StrategyExecutionType → `src/trade-record/dto/trade-record.object.ts`
- `src/auth/auth.resolver.ts`:
  - AuthPayload → `src/auth/dto/auth.object.ts`
- `src/notification/slack.service.ts`:
  - PositionInfo, TradeAlertContext, DailySummaryContext, FilterLogContext → `src/notification/types/notification.types.ts`

## Agent Team Configuration

복잡한 기능 개발이나 다중 파일 변경이 필요할 때, 아래 구성으로 에이전트 팀을 생성하세요.

### Team Roles

1. **Backend Developer** (backend)
   - NestJS 백엔드 코드 구현 담당
   - 작업 범위: src/ 디렉토리의 서비스, 리졸버, 모듈, 타입 등
   - Prisma 스키마 및 DB 관련 작업
   - KIS API 연동 및 트레이딩 로직

2. **Frontend Developer** (frontend)
   - React 프론트엔드 코드 구현 담당
   - 작업 범위: client/ 디렉토리
   - React 컴포넌트, 페이지, 훅, GraphQL 쿼리/뮤테이션

3. **Test Engineer** (tester)
   - 테스트 코드 작성 및 검증 담당
   - 유닛 테스트, 통합 테스트, e2e 테스트
   - 테스트 커버리지 확인 및 엣지 케이스 검증

4. **Code Reviewer** (reviewer)
   - 코드 리뷰 및 품질 검증 담당
   - 버그, 보안 취약점, 성능 이슈 검토
   - 코드 컨벤션 및 아키텍처 패턴 준수 확인
   - 다른 팀원의 작업 완료 후 리뷰 수행

### Team Creation Prompt Example

```
다음 구성으로 에이전트 팀을 만들어줘:
- backend: 백엔드 개발자. src/ 디렉토리의 NestJS 코드 구현 담당.
- frontend: React 프론트엔드 개발자. client/ 디렉토리 코드 구현 담당.
- tester: 테스트 엔지니어. 테스트 코드 작성 및 검증 담당.
- reviewer: 코드 리뷰어. 코드 품질 검증 및 리뷰 담당. 다른 팀원 작업 완료 후 리뷰. plan approval 필요.
```

### Team Rules
- reviewer는 plan approval을 요구하여, 리드가 승인하기 전까지 read-only 모드로 동작
- backend과 frontend는 서로 다른 디렉토리에서 작업하므로 파일 충돌 없음
- tester는 backend/frontend 작업 완료 후 테스트 작성

## Module Documentation (CLAUDE.md per module)

각 모듈 디렉토리(`src/{module}/`)에는 **`CLAUDE.md`**가 존재해야 하며, 해당 모듈이 어떤 책임을 가지는지 기술한다.

**모듈별 CLAUDE.md 템플릿:**
```markdown
# {Module Name}

## 책임
이 모듈이 다루는 핵심 책임 1~3문장 요약.

## 주요 서비스 / 컴포넌트
- `{file}.ts` — 역할
- ...

## 외부 의존성
- `@nestjs/...`, `@prisma/client`, ...
- 내부 모듈: `KisModule`, `TradingModule`, ...

## 주의사항 / 비자명한 규칙
- (예) "이 서비스는 public API 호환성을 위해 메서드 시그니처 변경 금지"
- (예) "Slack 호출은 TradingNotificationService로만 (직접 SlackService 사용 금지)"
```

- **루트 `CLAUDE.md`(이 파일)**에는 프로젝트 전체 규칙만 담고, 모듈 세부사항은 각 모듈 CLAUDE.md로 이관
- 모듈 분리/신설 시 `CLAUDE.md`를 함께 작성

## Service Responsibility / Size Rules

서비스/리졸버 파일이 커지면 책임을 분리한다.

**경계선:**
- **~600줄**: 정상
- **600~900줄**: 경고. 리팩토링 검토 권장
- **900줄 이상**: 분리 필수 (신규 파일 작성 시 자제, 기존 파일도 분리 계획 필요)

**책임 분리 기준:**
1. 하나의 서비스는 **하나의 responsibility** (예: "신호 실행"과 "알림"을 한 서비스에 섞지 말 것)
2. 의존성이 **8개 초과**하면 조합(composition) 구조로 재설계
3. public 메서드 **10개 초과**하면 세분화 신호
4. 한 메서드 **80줄 초과**는 재구성 대상

**예시 — `src/trading/`**:
- `trading.service.ts` — 신호 → 주문 제출 (signal executor)
- `trading-notification.service.ts` — Slack 알림 + 실행 로그
- `trading-position.service.ts` — Broker ↔ DB 포지션 동기화
- `trading.scheduler.ts` — 크론만 (오케스트레이션은 `trading-orchestrator.service.ts`로)

## Refactoring Principles

기존 코드 리팩토링 시 준수:
1. **행동 보존**: 공개 API(GraphQL schema, 서비스의 public 메서드 시그니처) 변경 금지가 원칙
2. **테스트 우선**: 분리 전 최소 회귀 테스트 추가 → 분리 → 테스트 통과 확인
3. **의존성 최소화**: 새 서비스는 필요한 것만 주입 (상위 서비스 전체 주입 금지)
4. **순환 의존 방지**: 분리된 서비스 간 상호 참조 금지. 필요 시 인터페이스로 추상화
5. **한 번에 하나의 모듈**: 동시에 여러 모듈 리팩토링하지 말 것 (커밋 단위 작게)
6. **커밋**: 리팩토링은 `refactor: ...` type 사용. 기능 변경 없는 순수 이동이면 `refactor: move X to Y`
