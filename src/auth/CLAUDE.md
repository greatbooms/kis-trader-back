# Auth Module

## 책임
관리자(admin) 단일 계정 기반 JWT 인증. GraphQL `login`/`logout` mutation에서 토큰을 발급하고 HTTP-only 쿠키(`access_token`)로 전달. `GqlAuthGuard`가 모든 보호된 resolver를 가드한다.

## 주요 서비스 / 컴포넌트
- `auth.module.ts` — `JwtModule.registerAsync`로 `auth.jwtSecret` 설정 주입, `AuthService`/`GqlAuthGuard` export
- `auth.service.ts` — 로그인 검증, JWT 발급, IP+username 단위 brute-force 방어 (15분 슬라이딩 윈도우, 5회 실패 시 15분 차단)
- `auth.resolver.ts` — `login`/`logout` mutation. 응답 시 `access_token` 쿠키 set/clear (httpOnly, sameSite, secure는 `auth.cookieSecure` 또는 `x-forwarded-proto`로 자동 판단)
- `jwt.strategy.ts` — 쿠키 → Authorization 헤더 순으로 토큰 추출하는 passport-jwt 전략
- `auth.guard.ts` — `GqlExecutionContext`에서 request를 꺼내는 GraphQL용 JWT 가드

## 외부 의존성
- `@nestjs/jwt`, `@nestjs/passport`, `passport-jwt`
- `@nestjs/config` — `auth.adminUsername`, `auth.adminPassword`, `auth.jwtSecret`, `auth.cookieSecure`

## 주의사항 / 비자명한 규칙
- **단일 admin 계정**: DB User 모델 없음. 자격증명은 환경 변수(`ADMIN_USERNAME`, `ADMIN_PASSWORD`, `JWT_SECRET`)로만 관리. 누락 시 부팅 실패
- 토큰 만료 7일. 쿠키 `maxAge`도 7일로 일치
- `loginAttempts`는 in-memory `Map` — 인스턴스 재시작 시 초기화. 다중 인스턴스 환경에서는 분산 동기화 안 됨
- `cookieSecure` 설정값이 명시되지 않으면 요청의 `req.secure` / `x-forwarded-proto`로 동적 판단 (HTTPS 프록시 환경 고려)
- `GqlAuthGuard`는 `auth.module.ts`에서 export됨 — 다른 모듈의 resolver에서 `@UseGuards(GqlAuthGuard)`로 import해 사용
- DTO: `dto/auth.object.ts`의 `AuthPayload`(success: boolean), `dto/login.input.ts`의 `LoginInput`
