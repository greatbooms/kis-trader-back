#!/usr/bin/env bash
# KIS Trading MCP 실행 래퍼 (stdio 모드, Docker 불필요)
#
# .mcp.json 에서 호출됨. 머신 요구사항: git, uv (https://docs.astral.sh/uv/)
# - open-trading-api 를 PINNED_SHA 로 고정 체크아웃 (실행 코드 공급망 고정,
#   업데이트는 이 파일의 SHA 변경 PR로만)
# - 프로젝트 .env 의 KIS_* 값을 서버 요구 환경변수로 매핑
# - HOME 을 전용 디렉토리로 격리: 서버가 생성하는 KIS/config/kis_devlp.yaml 이
#   사용자 전역 파일을 건드리지 않게 함
# - 실전 키(KIS_ENV=prod)는 .env 에 KIS_MCP_LIVE=1 명시 시에만 전달
#   (Trading MCP 는 주문 API 도 노출하므로 기본은 차단)
# - 의도적 분리: TRADING_ENABLED 는 백엔드 자동매매 게이트, KIS_MCP_LIVE 는 MCP 노출
#   게이트. TRADING_ENABLED=false 인 개발 머신에서도 실전 시세 조회가 필요해 별도 옵트인
set -euo pipefail
umask 077

PINNED_SHA="885dd4e2f5c37e4f7e23dd63c15555a9967bc7bc"
BASE_DIR="${HOME}/.cache/kis-trading-mcp"
SRC_DIR="${BASE_DIR}/open-trading-api"
MCP_HOME="${BASE_DIR}/home"
MCP_DIR="${SRC_DIR}/MCP/Kis Trading MCP"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env"

# 부모 프로세스에서 상속된 KIS_* 제거 — 아래에서 매핑한 값만 서버로 전달
unset KIS_APP_KEY KIS_APP_SECRET KIS_ACCT_STOCK KIS_ACCT_FUTURE \
  KIS_PAPER_APP_KEY KIS_PAPER_APP_SECRET KIS_PAPER_STOCK KIS_PAPER_FUTURE \
  KIS_HTS_ID KIS_PROD_TYPE KIS_URL_REST KIS_URL_REST_PAPER KIS_URL_WS KIS_URL_WS_PAPER

# 1) .env 에서 KIS 값 추출 (.env 전체 source 는 특수문자 위험)
#    grep 무매치(값 없음)는 정상 케이스라 || true 로 흡수, 필수값은 아래에서 별도 검증
env_val() {
  { grep -E "^$1=" "${ENV_FILE}" 2>/dev/null | tail -1 | cut -d= -f2- \
    | tr -d '"' | tr -d "'" | tr -d '\r'; } || true
}

APP_KEY="$(env_val KIS_APP_KEY)"
APP_SECRET="$(env_val KIS_APP_SECRET)"
ACCOUNT_NO="$(env_val KIS_ACCOUNT_NO)"
ACCT8="${ACCOUNT_NO:0:8}"
KIS_ENV_VAL="$(env_val KIS_ENV)"
PROD_TYPE="$(env_val KIS_PROD_CODE)"
HTS_ID="$(env_val KIS_HTS_ID)" # 선택값 (없으면 서버가 경고만)

if [ -z "${APP_KEY}" ] || [ -z "${APP_SECRET}" ] || [ -z "${ACCOUNT_NO}" ]; then
  echo "[kis-trading-mcp] ${ENV_FILE} 에 KIS_APP_KEY / KIS_APP_SECRET / KIS_ACCOUNT_NO 가 필요합니다." >&2
  exit 1
fi
case "${ACCT8}" in
  [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) ;;
  *)
    echo "[kis-trading-mcp] KIS_ACCOUNT_NO 앞 8자리가 계좌번호 형식(숫자 8자리)이 아닙니다." >&2
    exit 1
    ;;
esac

case "${KIS_ENV_VAL}" in
  paper)
    KIS_PAPER_APP_KEY="${APP_KEY}"
    KIS_PAPER_APP_SECRET="${APP_SECRET}"
    KIS_PAPER_STOCK="${ACCT8}"
    export KIS_PAPER_APP_KEY KIS_PAPER_APP_SECRET KIS_PAPER_STOCK
    ;;
  prod)
    if [ "$(env_val KIS_MCP_LIVE)" != "1" ]; then
      echo "[kis-trading-mcp] .env 가 실전(KIS_ENV=prod) 키입니다. Trading MCP 는 주문 API 까지 노출되므로 기본 차단합니다." >&2
      echo "[kis-trading-mcp] 실전 계좌로 사용하려면 .env 에 KIS_MCP_LIVE=1 을 추가하세요." >&2
      exit 1
    fi
    KIS_APP_KEY="${APP_KEY}"
    KIS_APP_SECRET="${APP_SECRET}"
    KIS_ACCT_STOCK="${ACCT8}"
    export KIS_APP_KEY KIS_APP_SECRET KIS_ACCT_STOCK
    ;;
  *)
    echo "[kis-trading-mcp] .env 의 KIS_ENV 가 paper/prod 가 아닙니다: '${KIS_ENV_VAL}'" >&2
    exit 1
    ;;
esac

export KIS_PROD_TYPE="${PROD_TYPE:-01}"
export KIS_HTS_ID="${HTS_ID}"

# 2) 소스 준비: 고정 SHA 체크아웃 (한 번 받으면 오프라인 기동 가능)
if [ ! -d "${SRC_DIR}/.git" ]; then
  mkdir -p "${SRC_DIR}"
  git -C "${SRC_DIR}" init --quiet
  git -C "${SRC_DIR}" remote add origin https://github.com/koreainvestment/open-trading-api.git
fi
if [ "$(git -C "${SRC_DIR}" rev-parse HEAD 2>/dev/null || true)" != "${PINNED_SHA}" ]; then
  git -C "${SRC_DIR}" fetch --depth 1 origin "${PINNED_SHA}" >&2
  git -C "${SRC_DIR}" checkout --force --quiet "${PINNED_SHA}"
fi
# tracked 파일이 로컬 수정된 상태면 고정 커밋으로 복원 (.venv 등 untracked 는 유지)
if [ -n "$(git -C "${SRC_DIR}" status --porcelain --untracked-files=no)" ]; then
  echo "[kis-trading-mcp] 캐시된 소스에 로컬 수정이 있어 고정 커밋으로 복원합니다." >&2
  git -C "${SRC_DIR}" checkout --force --quiet "${PINNED_SHA}"
fi
# untracked .py 는 import 가로채기(예: requests.py 셰도잉) 벡터라 제거
# (.venv 는 gitignore 라 --exclude-standard 에 안 걸리지만 방어적으로 한 번 더 제외)
git -C "${SRC_DIR}" ls-files --others --exclude-standard -- "MCP/Kis Trading MCP" \
  | { grep '\.py$' || true; } | { grep -v '/\.venv/' || true; } \
  | while IFS= read -r f; do
      echo "[kis-trading-mcp] 추적되지 않은 .py 제거: ${f}" >&2
      rm -f "${SRC_DIR}/${f}"
    done

# 3) stdio 모드용 env 파일 (서버가 .env.${ENV} 를 요구함)
[ -f "${MCP_DIR}/.env.stdio" ] || printf 'MCP_TYPE=stdio\n' > "${MCP_DIR}/.env.stdio"

# 4) 격리 HOME 준비. 서버는 kis_devlp.yaml 을 최초 1회만 생성하므로,
#    자격증명 지문(내용 기준)이 바뀌면 삭제해 최신 값으로 재생성을 유도
mkdir -p "${MCP_HOME}"
KIS_YAML="${MCP_HOME}/KIS/config/kis_devlp.yaml"
sha256() { if command -v shasum >/dev/null 2>&1; then shasum -a 256; else sha256sum; fi; }
CRED_FP="$(printf '%s' "${KIS_ENV_VAL}|${APP_KEY}|${APP_SECRET}|${ACCT8}|${KIS_PROD_TYPE}|${KIS_HTS_ID}" | sha256 | cut -d' ' -f1)"
FP_FILE="${MCP_HOME}/.cred-fingerprint"
if [ ! -f "${FP_FILE}" ] || [ "$(cat "${FP_FILE}")" != "${CRED_FP}" ]; then
  rm -f "${KIS_YAML}"
  printf '%s\n' "${CRED_FP}" > "${FP_FILE}"
fi

cd "${MCP_DIR}"
exec env HOME="${MCP_HOME}" ENV=stdio uv run server.py
