# Slack Bot 설정 가이드

KIS Trader의 Slack 알림봇을 설정하는 방법입니다. 매매 체결 알림, 포트폴리오 요약, 슬래시 명령어(`/잔고`, `/요약`, `/종목`, `/확인필요주문`)를 사용할 수 있습니다.

---

## 1단계: Slack App 생성 (App Manifest)

1. [Slack API](https://api.slack.com/apps)에 접속합니다.
2. **Create New App** → **"From an app manifest"** 를 선택합니다.
3. 앱을 설치할 **워크스페이스**를 선택합니다.
4. 아래 **JSON** 또는 **YAML** 중 하나를 선택하여 붙여넣습니다.

> **주의:** 포맷 탭이 기본값인 **JSON** 상태라면 JSON 버전을 사용하세요. YAML을 붙여넣으려면 반드시 포맷 탭을 **YAML**로 먼저 변경해야 합니다.

### JSON (기본 포맷)

```json
{
  "display_information": {
    "name": "KIS Trader",
    "description": "무한매수법 자동매매 알림봇",
    "background_color": "#1a73e8"
  },
  "features": {
    "bot_user": {
      "display_name": "KIS Trader",
      "always_online": true
    },
    "slash_commands": [
      {
        "command": "/잔고",
        "description": "현재 보유 포지션 조회 (국내+해외)",
        "should_escape": false
      },
      {
        "command": "/요약",
        "description": "오늘 매매 요약 + 포트폴리오 현황",
        "should_escape": false
      },
      {
        "command": "/종목",
        "description": "특정 종목 상세 조회 (보유량, 평단, T값, 수익률)",
        "usage_hint": "[종목코드] 예: /종목 SOXL",
        "should_escape": false
      },
      {
        "command": "/확인필요주문",
        "description": "제출 또는 취소 결과가 불명확한 주문 조회",
        "should_escape": false
      }
    ]
  },
  "oauth_config": {
    "scopes": {
      "bot": [
        "chat:write",
        "app_mentions:read",
        "commands"
      ]
    }
  },
  "settings": {
    "event_subscriptions": {
      "bot_events": [
        "app_mention"
      ]
    },
    "interactivity": {
      "is_enabled": true
    },
    "org_deploy_enabled": false,
    "socket_mode_enabled": true,
    "token_rotation_enabled": false
  }
}
```

5. **Next** → **Create** 를 눌러 앱을 생성합니다.

---

## 2단계: App-Level Token 발급

1. 앱 설정 페이지에서 **Settings → Basic Information** 으로 이동합니다.
2. **App-Level Tokens** 섹션에서 **Generate Token and Scopes** 를 클릭합니다.
3. 토큰 이름: `socket-mode` (아무 이름 가능)
4. Scope: **`connections:write`** 를 추가합니다.
5. **Generate** → 생성된 토큰(`xapp-...`)을 복사합니다.
   - 이것이 **`SLACK_APP_TOKEN`** 입니다.

---

## 3단계: 워크스페이스에 앱 설치

> **중요:** 이 단계를 완료해야 Bot Token이 생성됩니다.

1. **Features → OAuth & Permissions** 으로 이동합니다.
2. **Install to (워크스페이스 이름)** 버튼을 클릭합니다.
3. 권한 요청 화면에서 **Allow** 를 눌러 승인합니다.
4. 설치 완료 후 화면에 표시되는 **Bot User OAuth Token** (`xoxb-...`)을 복사합니다.
   - 이것이 **`SLACK_BOT_TOKEN`** 입니다.

---

## 4단계: 채널 설정

1. Slack에서 알림을 받을 채널을 생성합니다 (예: `#trading-alerts`).
2. 해당 채널에서 `/invite @KIS Trader` 를 입력하여 봇을 초대합니다.

---

## 5단계: 환경변수 설정

프로젝트의 `.env` 파일에 아래 값을 추가합니다:

```bash
# Slack Bot
SLACK_BOT_TOKEN=xoxb-여기에-봇-토큰-붙여넣기
SLACK_APP_TOKEN=xapp-여기에-앱-토큰-붙여넣기
SLACK_CHANNEL="#trading-alerts"
SLACK_ENABLED=true
SLACK_APPROVER_USER_IDS=U012ABCDEF,U034GHIJKL
```

| 변수 | 설명 |
|------|------|
| `SLACK_BOT_TOKEN` | Bot User OAuth Token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | App-Level Token (`xapp-...`), Socket Mode 연결용 |
| `SLACK_CHANNEL` | 알림을 보낼 채널 이름 (봇이 초대된 채널). `#`으로 시작하면 dotenv 주석으로 해석되지 않도록 따옴표로 감쌈 |
| `SLACK_ENABLED` | `true`로 설정해야 Slack 연동 활성화 (`false`면 알림 비활성) |
| `SLACK_APPROVER_USER_IDS` | 매도 승인과 불명 주문 복구를 수행할 Slack 사용자 ID의 쉼표 구분 allowlist. 누락/빈값이면 모든 관련 액션이 차단됨 |

Slack 사용자 ID는 멤버 프로필의 **더 보기 → 멤버 ID 복사**에서 확인할 수 있습니다. 표시 이름이나 이메일이 아니라 `U...` 형식의 ID를 입력하세요.

---

## 6단계: 서버 시작 및 확인

```bash
yarn start:dev
```

정상 연결되면 로그에 다음이 표시됩니다:
```
[SlackService] Slack Bot connected (Socket Mode)
```

---

## 사용 가능한 명령어

| 명령어 | 설명 | 예시 |
|--------|------|------|
| `/잔고` | 국내+해외 전체 보유 포지션 조회 | `/잔고` |
| `/요약` | 오늘 매매 요약 + 포트폴리오 현황 | `/요약` |
| `/종목 [코드]` | 특정 종목 상세 (보유량, 평단, T값, 수익률) | `/종목 SOXL` |
| `/확인필요주문` | 제출/취소 결과 불명 주문 조회 및 복구 시작 (승인 사용자 전용) | `/확인필요주문` |
| `@KIS Trader [질문]` | 앱 멘션으로 자유 질문 | `@KIS Trader 현재잔고` |

---

## 자동 알림 종류

서버가 실행되면 아래 알림이 자동으로 전송됩니다:

| 알림 | 시점 | 내용 |
|------|------|------|
| 체결 알림 | 매수/매도 주문 체결 시 | 종목, 수량, 가격, 전략 상세, 보유 현황 |
| 손절 알림 | 손절 매도 트리거 시 | 손절 사유, 실현 손실, 포지션 상태 |
| 불명 주문/취소 알림 | KIS 주문 제출 또는 취소 결과를 확정할 수 없을 때 | 주문 의도, 수량, 가격, 시작 시각, TradeRecord ID, 안전한 조회 액션 |
| 필터 스킵 | 전략에서 매수 스킵 시 | 스킵 사유 (MA200, 지수, RSI 등) |
| 일일 요약 | Cron 실행 완료 후 | 전체 포트폴리오, 오늘 체결 건수, 시장 상황 |

---

## 불명 주문 복구 안전 절차

1. `SLACK_APPROVER_USER_IDS`에 등록된 운영자만 `/확인필요주문`과 알림의 조회 버튼을 사용할 수 있습니다. 권한 검사는 DB 또는 KIS 조회 전에 수행됩니다.
2. `KIS 주문 조회`는 완전한 KIS 주문 이력을 읽어 후보만 표시합니다. 후보가 있어도 자동으로 선택하거나 연결하지 않습니다.
3. `이 주문 연결`, `미주문 확정`, `기존 기록과 동일`, 계좌 컨텍스트 지정, 취소 상태 확인/미접수 확정은 모두 상세 내용을 보여주는 확인 modal과 필수 동의를 거칩니다.
4. 확정 결과는 공용 복구 서비스가 감사 actor를 `slack:<사용자 ID>`, channel을 `SLACK`으로 기록합니다. 원본 Slack 메시지 갱신은 best effort이며, 갱신 실패가 DB의 확정 결과를 되돌리지는 않습니다.

> **자금 안전:** Slack 복구 액션은 주문이나 취소를 제출·재시도하지 않습니다. KIS 앱/관리 화면에서 실제 상태를 확인한 뒤 복구 결정을 확정하세요.
