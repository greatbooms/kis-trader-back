export const TECHNICAL_INDICATOR_TOOLTIPS: Record<string, string> = {
  rsi14: '상대강도지수입니다. 보통 30 이하는 과매도, 70 이상은 과매수 구간으로 봅니다.',
  stochasticK: '최근 가격 범위 안에서 현재 종가 위치를 보는 스토캐스틱 오실레이터입니다.',
  cci20: '가격이 통계적 평균에서 얼마나 벗어났는지 보는 추세/모멘텀 지표입니다.',
  adx14: '추세 강도를 보는 지표입니다. 보통 20 이상이면 추세가 형성된 것으로 해석합니다.',
  ao: '5일/34일 중간가격 차이로 계산하는 모멘텀 지표입니다.',
  momentum10: '현재 가격이 10기간 전보다 얼마나 강한지 보는 모멘텀 지표입니다.',
  macd12269: 'EMA 차이를 이용한 추세/모멘텀 지표입니다. MACD가 시그널 위면 매수 우위로 봅니다.',
  stochRsiFast: 'RSI를 다시 스토캐스틱으로 계산한 민감한 과열/침체 지표입니다.',
  williamsR14: '최근 고저 범위에서 현재 가격 위치를 보는 지표입니다. -80 아래는 과매도, -20 위는 과매수로 봅니다.',
  bullBearPower13: 'EMA(13) 대비 고가/저가의 힘을 보는 지표입니다.',
  uo71428: '세 구간의 매수 압력을 가중 평균한 모멘텀 지표입니다.',
  sma10: '최근 10기간 단순이동평균입니다.',
  sma20: '최근 20기간 단순이동평균입니다.',
  sma30: '최근 30기간 단순이동평균입니다.',
  sma50: '최근 50기간 단순이동평균입니다.',
  sma100: '최근 100기간 단순이동평균입니다.',
  sma200: '최근 200기간 단순이동평균입니다.',
  ema10: '최근 10기간 지수이동평균입니다.',
  ema20: '최근 20기간 지수이동평균입니다.',
  ema30: '최근 30기간 지수이동평균입니다.',
  ema50: '최근 50기간 지수이동평균입니다.',
  ema100: '최근 100기간 지수이동평균입니다.',
  ema200: '최근 200기간 지수이동평균입니다.',
  hma9: 'Hull 이동평균입니다. 일반 이동평균보다 반응이 빠른 편입니다.',
  vwma20: '거래량을 가중한 20기간 이동평균입니다.',
  ichimoku: '일목균형표 기준선/전환선/선행스팬을 사용한 종합 추세 지표입니다.',
}

export function technicalRecommendationLabel(recommendation?: string | null): string {
  switch (recommendation) {
    case 'STRONG_BUY':
      return '강력 매수'
    case 'BUY':
      return '매수'
    case 'SELL':
      return '매도'
    case 'STRONG_SELL':
      return '강력 매도'
    default:
      return '중립'
  }
}

export function technicalRecommendationVariant(recommendation?: string | null): 'success' | 'warning' | 'danger' | 'outline' {
  switch (recommendation) {
    case 'STRONG_BUY':
    case 'BUY':
      return 'success'
    case 'SELL':
    case 'STRONG_SELL':
      return 'danger'
    default:
      return 'outline'
  }
}

export function technicalActionLabel(action?: string | null): string {
  switch (action) {
    case 'BUY':
      return '매수'
    case 'SELL':
      return '매도'
    default:
      return '중립'
  }
}

export function technicalActionClass(action?: string | null): string {
  switch (action) {
    case 'BUY':
      return 'text-success'
    case 'SELL':
      return 'text-danger'
    default:
      return 'text-muted-foreground'
  }
}
