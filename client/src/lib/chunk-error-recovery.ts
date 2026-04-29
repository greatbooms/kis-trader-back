/**
 * Vite 코드 스플리팅 환경에서 새 빌드 배포 시 발생하는 chunk-load 실패를 자동 복구한다.
 *
 * 시나리오:
 *  - 사용자가 옛 `index-XXX.js`를 들고 있는 채로 새 빌드가 배포되면,
 *    각 페이지 청크의 해시가 달라져 옛 import 경로(`PortfolioPage-OLD.js`)는 404 → SPA fallback HTML 반환 →
 *    브라우저가 "JS 모듈인 줄 알았는데 text/html" 이라며 거부한다.
 *  - 자동으로 1회 새로고침하면 새 `index.html`을 받아 새 해시로 정상화된다.
 *
 * 무한 리로드 루프를 막기 위해 마지막 자동 reload 시각을 sessionStorage에 기록하고,
 * 30초 이내에 또 실패하면 (= 진짜 코드 버그일 가능성) 더 이상 자동 reload 하지 않고 호출자에게 false 반환.
 */

const STORAGE_KEY = 'kis.chunkErrorAutoReloadAt';
const REPEAT_GUARD_MS = 30 * 1000;

const CHUNK_ERROR_HINTS = [
  'failed to fetch dynamically imported module',
  'failed to fetch dynamically imported chunk',
  'importing a module script failed',
  'loading chunk',
  'loading css chunk',
  'expected a javascript-or-wasm module script',
];

export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : (error as { message?: string })?.message ?? '';
  if (!message) return false;
  const lower = message.toLowerCase();
  return CHUNK_ERROR_HINTS.some((hint) => lower.includes(hint));
}

/**
 * chunk load 오류가 의심될 때 안전하게 1회 자동 reload.
 * 직전 30초 내에 이미 자동 reload를 시도했다면 false 반환 (호출자가 일반 ErrorBoundary 화면을 노출).
 */
export function tryAutoReloadForChunkError(reason: string): boolean {
  try {
    const last = Number(sessionStorage.getItem(STORAGE_KEY) || 0);
    if (last && Date.now() - last < REPEAT_GUARD_MS) {
      // 직전 자동 reload 직후에 또 실패 = chunk 문제가 아닐 가능성 → 자동 복구 포기
      // eslint-disable-next-line no-console
      console.warn(`[chunk-recovery] suppressing repeated auto-reload (${reason})`);
      return false;
    }
    sessionStorage.setItem(STORAGE_KEY, String(Date.now()));
  } catch {
    // sessionStorage 접근 불가(시크릿 모드 등) — 그냥 reload 시도
  }
  // eslint-disable-next-line no-console
  console.warn(`[chunk-recovery] auto-reloading due to ${reason}`);
  // 즉시 새로고침. 사용자에게는 ErrorBoundary가 잠시 보이거나 곧바로 새 페이지로 전환됨.
  window.location.reload();
  return true;
}
