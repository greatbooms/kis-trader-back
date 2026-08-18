# Deferred Prisma migrations

이 디렉토리는 **생성은 완료됐지만 부팅 시 `prisma migrate deploy`로 자동 적용되면 안 되는 migration**을 보관한다.

## 왜 deferred가 필요한가

- 현재 배포 이미지의 부팅 경로는 `yarn prisma migrate deploy && node dist/main` 이다.
- `prisma migrate deploy`는 `prisma/migrations` 아래 migration만 자동 적용한다.
- 따라서 one-way schema boundary를 만드는 migration은 `prisma/migrations`에 두는 순간 다음 부팅에서 즉시 적용된다.

## 현재 보관 중인 migration

- `20260814163000_drop_legacy_brokerless_uniques`
  - `positions`
  - `watch_stocks`
  - `risk_snapshots`
  - `strategy_allocations`
  의 legacy brokerless unique index 4개만 제거한다.
  - SQL은 생성본 그대로 유지하며, promotion 전까지는 **byte-for-byte unchanged** 상태를 유지한다.

## 왜 지금은 자동 적용하면 안 되나

- 이 migration은 멀티 브로커 rollout의 **one-way boundary**다.
- 적용 후에는 pre-broker binary로의 rollback이 지원되지 않는다.
- Phase 3 배선 직후에는 KIS-only 안정화 구간이 먼저 필요하다.
- 특히 **KIS에서 이미 들고 있는 종목을 TOSS에도 추가로 들고 싶어지는 시점 직전**까지는 legacy unique를 남겨 두는 편이 rollback/운영 가드에 유리하다.

## promotion 규칙

이 migration은 다음 조건을 모두 만족할 때만 `prisma/migrations/`로 승격한다.

1. Phase 3 release가 운영에서 안정화됐다.
2. KIS-only 경로, broker-scoped sync, approval/recovery가 정상임을 확인했다.
3. 다음 release에서 **동일 종목을 KIS와 TOSS에 동시에 보유/등록**할 계획이 있다.

즉, promotion은 **별도 release**로 수행한다. 순서는 다음과 같다.

1. Release 1: migration 27까지만 자동 적용되는 Phase 3 binary 배포(TOSS 비활성)
2. 안정화 확인
3. Release 2: `prisma/schema.prisma`에서 legacy brokerless `@@unique` 4개를 제거하고, 이 디렉토리의 migration을 `prisma/migrations/`로 같은 release에 승격한 뒤 배포

Release 2 이후에는 pre-broker binary rollback을 지원하지 않는다.
