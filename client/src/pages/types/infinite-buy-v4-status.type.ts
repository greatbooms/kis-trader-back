// `WatchStock.strategyParams.v4`에서 상태 카드 표시에 쓰는 필드만 뽑은 뷰 타입.
// 백엔드 `InfiniteBuyV4Params`(src/trading/types)와 형태를 맞추되, 프론트는 표시에 필요한 값만 읽는다.
export interface InfiniteBuyV4Status {
  mode?: 'NORMAL' | 'REVERSE'
  turn?: number
  cashRemaining?: number
  lastKnownHoldQty?: number
}
