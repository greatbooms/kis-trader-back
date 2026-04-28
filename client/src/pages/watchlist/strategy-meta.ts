// 전략별 기본값/문구 메타 정보 — Add/Edit 모달이 공통으로 사용

export interface StrategyMeta {
  defaultStopLoss: number
  hasMaxCycles: boolean
  hasSellRates: boolean
  quotaDesc: string
  stopLossDesc: string
}

export const STRATEGY_META: Record<string, StrategyMeta> = {
  'infinite-buy': {
    defaultStopLoss: 50,
    hasMaxCycles: true,
    hasSellRates: false,
    quotaDesc: '이 종목에 배정할 총 투자 금액입니다. 최대 사이클에 걸쳐 분할 매수합니다.',
    stopLossDesc: '평균 매수가 대비 이 비율만큼 하락하면 Slack 알림을 보내고, 포트폴리오에서 수동 매도합니다.',
  },
  'grid-mean-reversion': {
    defaultStopLoss: 8,
    hasMaxCycles: false,
    hasSellRates: false,
    quotaDesc: '이 종목에 배정할 투자 금액입니다. 그리드 3단계(-2%, -4%, -6%)로 분할 매수합니다.',
    stopLossDesc: '평균 매수가 대비 이 비율만큼 하락하면 손절 매도합니다.',
  },
  'momentum-breakout': {
    defaultStopLoss: 3,
    hasMaxCycles: false,
    hasSellRates: false,
    quotaDesc: '이 종목에 배정할 투자 금액입니다. 돌파 시그널 발생 시 한 번에 매수합니다.',
    stopLossDesc: '진입가 대비 이 비율만큼 하락하면 손절합니다. 단기 전략이므로 낮은 손절률을 권장합니다.',
  },
  'conservative': {
    defaultStopLoss: 5,
    hasMaxCycles: false,
    hasSellRates: false,
    quotaDesc: '이 종목에 배정할 투자 금액입니다. 극단적 과매도 시 투자금의 30%만 사용합니다.',
    stopLossDesc: '평균 매수가 대비 이 비율만큼 하락하면 손절합니다.',
  },
  'trend-following': {
    defaultStopLoss: 7,
    hasMaxCycles: false,
    hasSellRates: false,
    quotaDesc: '이 종목에 배정할 투자 금액입니다. 추세 진입 시 한 번에 매수하고, 수익 5% 이상 시 50%를 추가 매수(피라미딩)합니다.',
    stopLossDesc: '진입가 대비 이 비율만큼 하락하면 손절합니다. 추세 소멸(데드크로스, ADX<20) 시에도 자동 청산됩니다.',
  },
  'value-factor': {
    defaultStopLoss: 10,
    hasMaxCycles: false,
    hasSellRates: false,
    quotaDesc: '이 종목에 배정할 투자 금액입니다. 재무 지표(PER, PBR, EPS, ROE, 부채비율, EV/EBITDA 등) 조건 충족 시 매수합니다. 해외 종목은 PER+PBR+EPS+RSI로 판단하며, ROE/부채비율/EV/EBITDA/증가율 지표는 국내 전용입니다. 투자유의/시장경고 종목은 자동 차단됩니다.',
    stopLossDesc: '평균 매수가 대비 이 비율만큼 하락하면 손절합니다. +15% 수익 또는 RSI > 70 과열 시에도 자동 청산됩니다.',
  },
}

export const DEFAULT_STRATEGY_META: StrategyMeta = {
  defaultStopLoss: 30,
  hasMaxCycles: false,
  hasSellRates: false,
  quotaDesc: '이 종목에 배정할 최대 투자 금액입니다.',
  stopLossDesc: '평균 매수가 대비 이 비율만큼 하락하면 손절 매도합니다.',
}

export function parseStrategyParams(value?: string | null): Record<string, unknown> {
  if (!value) return {}
  try {
    return JSON.parse(value) as Record<string, unknown>
  } catch {
    return {}
  }
}

export function formatCycleValue(value: number): string {
  return value.toFixed(1)
}
