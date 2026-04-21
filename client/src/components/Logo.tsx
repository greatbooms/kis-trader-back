/**
 * KIS Trader 로고.
 * - 둥근 사각 인디고 그라디언트 배경
 * - 흰색 "K" 모노그램 (오른쪽 획이 상승 추세선처럼 보이도록 살짝 연장)
 * - 우상단 에메랄드 닷: 성장/체결 신호 느낌
 *
 * size 속성으로 픽셀 단위 확대/축소. 기본 32 (collapsed sidebar 1행에 맞춤).
 */
export function Logo({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="KIS Trader"
      role="img"
    >
      <defs>
        <linearGradient id="kis-logo-bg" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#4338ca" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#kis-logo-bg)" />
      {/* K letter — strokes kept open so growth dot visually completes the top-right stroke */}
      <path
        d="M10.5 8v16 M10.5 16l7.5-8 M10.5 16l7.5 8"
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* 상승 추세 액센트 */}
      <circle cx="22.5" cy="8.5" r="1.8" fill="#10b981" />
    </svg>
  );
}
