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
