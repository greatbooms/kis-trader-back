# Notification Module

## 책임
Slack 기반 알림 송신. 실거래 체결 알림, 위험 알림, 일일 요약, 공지(딥 분석 리포트), Socket Mode 연결을 담당한다. 다른 모듈은 `SlackService` 한 곳만 주입해서 사용.

## 주요 서비스 / 컴포넌트
- `notification.module.ts` — 의존 모듈 없이 `SlackService`만 provide/export
- `slack.service.ts` — Slack Bolt App life-cycle. Socket Mode 연결, 자동 재접속(지수 backoff, 최대 5회), 메시지 빌더(blocks 포맷팅), 송신 메서드들 (`sendTradeAlert`, `sendDailySummary`, `sendStopLossApproval`, `sendDeepAnalysisReport` 등)
- `types/notification.types.ts` — `PositionInfo`, `TradeAlertContext`, `DailySummaryContext`, `StopLossApprovalRequest` 등 컨텍스트 타입

## 외부 의존성
- `@slack/bolt`, `@slack/types` — App + Socket Mode + Block Kit
- `@nestjs/config` — `slack.enabled`, `slack.channel`, `slack.botToken`, `slack.appToken`

## 주의사항 / 비자명한 규칙
- `SlackService`는 송신/연결/포맷팅 전담(outbound). 인바운드 슬래시 커맨드 어댑터는 거래 도메인의 `TradingSlackCommandsService`가 담당한다.
- 불명 주문의 개별/시작 요약 메시지와 복구 modal 표현은 Trading 모듈의 recovery presentation 서비스가 담당한다. 시작 시에는 DB의 확인 필요 총건수를 한 번만 best-effort로 알리며, 웹 포트폴리오 큐가 authoritative source다.
- **`slack.enabled=false`이면 송신 메서드는 noop**: `app === null` 가드. 토큰 미설정도 동일
- **운영 환경에서만 활성화**: `.env.dev`에는 보통 `SLACK_ENABLED=false`. 실거래 알림이 개발환경에서 발송되지 않도록
- Trading 흐름의 Slack 호출 게이트웨이: 체결 알림은 `TradingOrderReconciliationService`, 승인 요청/결과 갱신은 `TradingSellApprovalService`/`TradingSellApprovalNotificationService`, 불명 주문 복구 표현은 Trading recovery presentation 서비스가 담당 — 전략(`*.strategy.ts`)에서 `SlackService` 직접 주입 금지 (`src/trading/CLAUDE.md` 참조)
- 재접속 backoff: 3s → 6s → 12s → 24s → 48s (5회). 모두 실패 시 메시지 드롭, 다음 성공 재접속까지 송신 안 됨
- ping timeout 클라이언트 15s / 서버 45s — Socket Mode가 끊겨도 빠르게 감지하기 위해 짧게 설정
- WebSocket 에러가 프로세스를 죽이지 않도록 `app.error()` 핸들러로 흡수
- Slack Block Kit 포맷팅은 `KnownBlock[]` 타입 — Slack API 변경 시 `@slack/types` 버전 확인
