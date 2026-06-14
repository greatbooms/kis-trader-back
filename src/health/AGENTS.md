# Health Module

## 책임
컨테이너/로드밸런서가 호출하는 헬스체크 엔드포인트. NestJS 모듈이 아닌 단일 컨트롤러만 존재.

## 주요 컴포넌트
- `health.controller.ts` — `GET /health` → `{ status: 'ok', timestamp }`

## 외부 의존성
- 없음 (`@nestjs/common`만)

## 주의사항 / 비자명한 규칙
- 별도 `*.module.ts` 없음 — `AppModule.controllers`에 직접 등록
- 인증 가드 적용 안 됨 (외부 헬스체크용). 비밀 정보 응답 금지
- DB/외부 API 상태까지 체크하는 deep health가 필요해지면 별도 컨트롤러 분리 검토
