# Config Module

## 책임
환경 변수를 NestJS `ConfigService`가 읽을 수 있는 trees-of-keys 객체로 매핑. `AppModule`이 `ConfigModule.forRoot({ load: [configuration] })`로 한 번만 로드한다.

## 주요 컴포넌트
- `configuration.ts` — `process.env` → 설정 트리 변환. 다음 네임스페이스 제공:
  - `port` — HTTP 포트 (기본 3000)
  - `kis.*` — KIS API (`appKey`, `appSecret`, `accountNo`, `prodCode`, `env: 'paper' | 'prod'`, `debugRawBalance`)
  - `toss.*` — 토스증권 Open API (`clientId`, `clientSecret`, `accountNo`)
  - `openDart.apiKey` — OpenDART (한국 공시)
  - `sec.userAgent` — SEC EDGAR (이메일 포함 UA 필수)
  - `fred.apiKey` — FRED (St. Louis Fed)
  - `trading.enabled` — 실전 거래 마스터 스위치 (`TRADING_ENABLED`가 정규화된 `true`일 때만 활성)
  - `auth.*` — admin 자격증명, JWT 시크릿, 쿠키 secure 플래그
  - `slack.*` — Bot/App token, channel, enabled, 승인자 user ID allowlist

## 외부 의존성
- 없음 (`process.env` 직접 접근만)

## 주의사항 / 비자명한 규칙
- **ConfigModule은 다른 모듈에서 import할 필요 없음**: `AppModule`에서 `isGlobal: true`로 등록. 모든 서비스에서 `ConfigService` 직접 주입 가능
- 코드 다른 곳에서 `process.env` 직접 접근 금지 — 반드시 `configService.get<T>('namespace.key')` 경유 (루트 `CLAUDE.md` 원칙)
- **민감값 fallback 주의**: `ADMIN_PASSWORD`, `JWT_SECRET`은 빈 문자열 fallback이지만 `AuthModule`/`AuthService`에서 누락 시 throw → 부팅 실패
- `kis.env` 기본값 `'paper'` — 운영 시 반드시 `KIS_ENV=prod` 명시 (KIS_BASE_URLS는 이 값으로 결정됨)
- `slack.enabled`는 `'true'` 문자열 비교 — 명시적 활성화 필요
- `slack.approverUserIds`는 `SLACK_APPROVER_USER_IDS`를 쉼표 기준으로 trim/filter/dedupe한 배열이다. 누락·빈값은 빈 배열이며 승인/거절 액션을 fail-closed한다.
- `trading.enabled`는 trim/lowercase 정규화 후 정확히 `'true'`인 경우만 활성 (누락/빈값/오입력은 비활성)
- `trading.enabled=false`는 신규 주문·취소 POST와 거래 cron을 막지만, 인증된 Slack/웹 확인 필요 주문 조회·복구까지 끄지 않는다. 운영 첫 롤아웃은 false 상태에서 migration/시작 인계/불명 주문 정리를 마친 뒤 true로 전환한다.
- `auth.cookieSecure`는 `undefined` 시 런타임에 `req.secure` / `x-forwarded-proto`로 자동 판단 (auth resolver)
- 새 환경 변수 추가 시: `configuration.ts` 매핑 + `.env.example`(있다면) 갱신 + 모듈 `CLAUDE.md` 메모
