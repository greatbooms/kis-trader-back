/**
 * 호가단위(tick size) 헬퍼.
 *
 * - 해외(미국 등): 0.01달러 균일. 페니스톡(<$1)은 0.0001이지만 ETF/일반주식엔 적용 안 됨.
 * - 국내(KRX 통합, 2024-06 기준):
 *   - <2,000원      : 1원
 *   - 2,000~5,000   : 5원
 *   - 5,000~20,000  : 10원
 *   - 20,000~50,000 : 50원
 *   - 50,000~200,000: 100원
 *   - 200,000~500,000: 500원
 *   - ≥500,000      : 1,000원
 *
 * 가격대 경계(예: 정확히 2,000원)는 윗 구간의 단위를 적용한다 (KRX 호가단위 표 관례).
 */
export function tickSize(isOverseas: boolean, price: number): number {
  if (isOverseas) return 0.01;
  if (price < 2_000) return 1;
  if (price < 5_000) return 5;
  if (price < 20_000) return 10;
  if (price < 50_000) return 50;
  if (price < 200_000) return 100;
  if (price < 500_000) return 500;
  return 1_000;
}
