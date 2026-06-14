# Notification Module

## 책임
Slack 기반 알림 송신과 슬래시 커맨드 처리. 실거래 체결 알림, 위험 알림, 일일 요약, 공지(딥 분석 리포트), Socket Mode 양방향 채널을 담당한다. 다른 모듈은 `SlackService` 한 곳만 주입해서 사용.

## 주요 서비스 / 컴포넌트
- `notification.module.ts` — `SlackService`/`SlackCommandsService` export. `TradingModule`은 `forwardRef`(순환 의존성 — Slack 명령어가 trading API 호출하기 때문)
- `slack.service.ts` — Slack Bolt App life-cycle. Socket Mode 연결, 자동 재접속(지수 backoff, 최대 5회), 메시지 빌더(blocks 포맷팅), 송신 메서드들 (`notifyTrade`, `sendDailySummary`, `sendStopLossApproval`, `sendDeepAnalysisReport` 등)
- `slack-commands.service.ts` — `OnModuleInit`에서 슬래시 커맨드 등록 (`/잔고`, `/요약`, `/종목 [코드]` 등). DB + KIS + TradingService 조합으로 응답 빌드
- `types/notification.types.ts` — `PositionInfo`, `TradeAlertContext`, `DailySummaryContext`, `StopLossApprovalRequest` 등 컨텍스트 타입

## 외부 의존성
- `@slack/bolt`, `@slack/types` — App + Socket Mode + Block Kit
- `@nestjs/config` — `slack.enabled`, `slack.channel`, `slack.botToken`, `slack.appToken`
- `TradeRecordModule` — 잔고/요약 조회
- `TradingModule` (forwardRef) — `/잔고` 등 명령어가 `TradingService`/`MarketAnalysisService` 사용

## 주의사항 / 비자명한 규칙
- **두 서비스 책임 분리**:
  - `SlackService` = 송신/연결/포맷팅 전담 (outbound)
  - `SlackCommandsService` = 인바운드 슬래시 커맨드 핸들러 등록만. 직접 `app.client.chat.postMessage` 호출 금지 — `SlackService`의 메서드 사용
- **`slack.enabled=false`이면 송신 메서드는 noop**: `app === null` 가드. 토큰 미설정도 동일
- **운영 환경에서만 활성화**: `.env.dev`에는 보통 `SLACK_ENABLED=false`. 실거래 알림이 개발환경에서 발송되지 않도록
- Trading 흐름의 Slack 호출은 **`TradingOrderReconciliationService.notifyTradeFill`** 또는 **`TradingService`** 경유 — 전략(`*.strategy.ts`)에서 `SlackService` 직접 주입 금지 (루트 AGENTS.md)
- 재접속 backoff: 3s → 6s → 12s → 24s → 48s (5회). 모두 실패 시 메시지 드롭, 다음 성공 재접속까지 송신 안 됨
- ping timeout 클라이언트 15s / 서버 45s — Socket Mode가 끊겨도 빠르게 감지하기 위해 짧게 설정
- WebSocket 에러가 프로세스를 죽이지 않도록 `app.error()` 핸들러로 흡수
- Slack Block Kit 포맷팅은 `KnownBlock[]` 타입 — Slack API 변경 시 `@slack/types` 버전 확인
