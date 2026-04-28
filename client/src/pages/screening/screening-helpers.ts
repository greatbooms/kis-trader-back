import { formatNumber } from '@/lib/utils'
import type { FactorScores, ScreeningRecommendationItem } from './types'

// ── 스크리닝 페이지 공통 헬퍼/상수 ──

export function scoreColor(score: number): string {
  if (score >= 70) return 'text-emerald-600'
  if (score >= 50) return 'text-amber-600'
  return 'text-red-500'
}

export function scoreBadgeVariant(score: number): 'success' | 'warning' | 'danger' {
  if (score >= 70) return 'success'
  if (score >= 50) return 'warning'
  return 'danger'
}

export function formatScreeningDate(date: string): string {
  if (date.length === 8) {
    return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
  }
  return date
}

export function parseJson<T>(value?: string | null): T | undefined {
  if (!value) return undefined
  try {
    return JSON.parse(value) as T
  } catch {
    return undefined
  }
}

export function riskBadgeVariant(riskGrade?: string | null): 'success' | 'warning' | 'danger' | 'outline' {
  if (riskGrade === 'LOW') return 'success'
  if (riskGrade === 'MEDIUM') return 'warning'
  if (riskGrade === 'HIGH' || riskGrade === 'EXTREME') return 'danger'
  return 'outline'
}

export const COUNTRY_FLAG: Record<string, string> = {
  KR: '🇰🇷', US: '🇺🇸', HK: '🇭🇰', CN: '🇨🇳', JP: '🇯🇵', VN: '🇻🇳',
}

export const CELL_TOOLTIPS: Record<string, string> = {
  현재가: '조회 시점의 현재 체결가입니다.',
  거래량: '당일 누적 거래량입니다.',
  시가총액: '현재가 기준 시가총액입니다. 국내 값은 억 원 단위 원천 데이터를 사용합니다.',
  등락률: '전일 종가 대비 현재가 변화율입니다.',
}

export const INDICATOR_TOOLTIPS: Record<string, string> = {
  'RSI(14)': '14일 기준 상대강도지수입니다. 보통 30 이하는 과매도, 70 이상은 과매수로 봅니다.',
  MA20: '최근 20거래일 종가 평균입니다.',
  MA60: '최근 60거래일 종가 평균입니다.',
  PER: '주가수익비율입니다. 현재 주가가 주당순이익의 몇 배인지 보여줍니다.',
  ROE: '자기자본이익률입니다. 자본 대비 수익 창출 효율을 뜻합니다.',
  'EV/EBITDA': '기업가치를 EBITDA로 나눈 값입니다. 업종 내 상대가치 비교에 자주 씁니다.',
  배당수익률: '현재 주가 대비 연간 배당금 비율입니다.',
  안전마진: '내부 DCF 적정가 대비 현재가가 얼마나 할인 또는 고평가 상태인지 보여줍니다. 음수면 현재가가 적정가보다 높다는 뜻입니다.',
}

export const FACTOR_TOOLTIPS: Record<string, string> = {
  trend: '이동평균 구조, Ichimoku, MACD, ADX, Bollinger 등 가격 구조와 방향성 점수입니다.',
  timing: 'RSI, Stochastic, CCI, Williams %R 등 과열/침체와 눌림·반등 타이밍 점수입니다.',
  riskSupply: '변동성·낙폭·재무안정성과 함께 거래량·외인/기관 흐름을 합친 점수입니다.',
  valuation: 'PER, PBR, EV/EBITDA, 안전마진 등 가치평가 지표 기반 점수입니다.',
  growth: '매출, 이익, 자본 성장률 중심의 성장성 점수입니다.',
  profitability: '영업이익률, ROE, 순이익률 등 수익성 지표 점수입니다.',
  risk: '변동성, MDD, 부채비율, 유동비율, 차입금 의존도 등을 반영한 리스크 점수입니다.',
  supplyDemand: '거래량, 수급, 외국인/기관 흐름 등 수급 기반 점수입니다.',
  dividend: '배당수익률, 배당성향, 연속 배당 여부 등 주주환원 점수입니다.',
  consensus: '증권사 목표가, 투자의견, 추정 실적 등 시장 컨센서스를 바탕으로 한 점수입니다.',
  fundamental: '가치, 성장, 수익성 등 펀더멘털 팩터를 종합한 보조 점수입니다.',
}

export const SECTION_TOOLTIPS: Record<string, string> = {
  DCF: '우리 내부 DCF 모델로 계산한 적정가와 안전마진입니다. 목표가는 별도의 증권사 컨센서스 값입니다.',
  리스크: '변동성, MDD, 재무안정성, 공매도·신용 데이터 기반 위험 요약입니다.',
  기술적: '추세 방향과 함께 배당, 증권사 컨센서스 같은 보조 판단 지표를 묶어 보여줍니다.',
  '기술 상세': '기술적 지표 세부값입니다. 지지선, 저항선, ADX를 확인할 수 있습니다.',
  '배당/컨센서스': '배당 이력과 배당성향, 증권사 목표가 대비 괴리, 실적 서프라이즈를 보여줍니다.',
}

export const DEEP_ANALYSIS_GLOSSARY = [
  { term: '내부 DCF', description: '우리 내부 할인현금흐름(DCF) 모델 기준으로 계산한 적정가 영역입니다.' },
  { term: '내부 DCF 적정가', description: '매출 성장, 영업이익률, 할인율(WACC)을 넣어 우리 모델이 계산한 적정 주가입니다.' },
  { term: '안전마진', description: '내부 DCF 적정가 대비 현재가의 할인율입니다. 음수면 현재가가 적정가보다 높은 상태입니다.' },
  { term: '증권사 컨센서스 목표가', description: '여러 증권사 리포트의 목표가를 모아 본 시장 평균 목표가입니다.' },
  { term: '리스크', description: '변동성과 낙폭, 재무안정성, 공매도·신용 관련 위험을 종합해 보는 영역입니다.' },
  { term: '등급', description: '리스크 종합 결과를 LOW, MEDIUM, HIGH, EXTREME 같은 단계로 요약한 값입니다.' },
  { term: '30일 변동성', description: '최근 30거래일 가격 움직임이 얼마나 큰지 연율화해 보여주는 값입니다.' },
  { term: '90일 MDD', description: '최근 90거래일 기준 가장 큰 낙폭입니다. 값이 낮을수록 하락 폭이 컸다는 뜻입니다.' },
  { term: '기술적', description: '추세와 차트 위치, 보조지표를 바탕으로 현재 기술적 상태를 요약한 영역입니다.' },
  { term: '추세', description: '이동평균, MACD, ADX 등으로 본 현재 가격 흐름 방향입니다. 보통 상승, 하락, 횡보로 표시합니다.' },
  { term: '배당', description: '현재 주가 대비 연간 배당금 비율인 배당수익률을 뜻합니다.' },
  { term: '증권사 컨센서스', description: '여러 증권사 애널리스트의 투자의견, 목표가, 추정 실적을 모아 본 시장 평균 의견입니다.' },
  { term: '지지선', description: '최근 가격 흐름에서 주가가 버티기 쉬운 가격 구간입니다.' },
  { term: '저항선', description: '최근 가격 흐름에서 매물 부담이 커질 수 있는 가격 구간입니다.' },
  { term: 'ADX', description: '추세 강도를 보는 지표입니다. 보통 값이 높을수록 추세가 더 강하다고 해석합니다.' },
  { term: '배당/컨센서스', description: '배당 이력과 주주환원 지표, 증권사 목표가·실적 기대를 함께 보는 영역입니다.' },
  { term: '연속 배당', description: '배당 지급이 이어진 연수를 뜻합니다. 값이 높을수록 배당 이력이 꾸준하다는 의미입니다.' },
  { term: '배당성향', description: '순이익 대비 배당금 비율입니다. 벌어들인 이익 중 얼마를 배당에 쓰는지 보여줍니다.' },
  { term: '목표가 괴리(상승여력)', description: '현재가와 증권사 컨센서스 목표가의 차이입니다. 플러스면 목표가가 현재가보다 높다는 뜻입니다.' },
  { term: '최근 서프라이즈', description: '시장 예상 실적과 실제 실적의 차이를 뜻합니다. 플러스면 예상보다 좋았다는 의미입니다.' },
]

export function getAxisMax(rec: Pick<ScreeningRecommendationItem, 'isEtf'>, axis: 'trend' | 'timing' | 'fundamental' | 'riskSupply') {
  if (rec.isEtf) {
    return { trend: 35, timing: 25, fundamental: 10, riskSupply: 30 }[axis]
  }
  return { trend: 30, timing: 20, fundamental: 30, riskSupply: 20 }[axis]
}

export function axisRatio(score: number, max: number) {
  if (max <= 0) return 0
  return (score / max) * 100
}

export function buildRadarData(rec: Pick<ScreeningRecommendationItem, 'factorScores' | 'trendScore' | 'timingScore' | 'fundamentalScore' | 'riskSupplyScore' | 'isEtf'>) {
  return [
    ['추세', rec.trendScore, getAxisMax(rec, 'trend')],
    ['타이밍', rec.timingScore, getAxisMax(rec, 'timing')],
    ['펀더', rec.fundamentalScore, getAxisMax(rec, 'fundamental')],
    ['리스크·수급', rec.riskSupplyScore, getAxisMax(rec, 'riskSupply')],
  ]
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([label, value, max]) => ({ label, value: (Number(value) / Number(max)) * 100 }))
}

export function factorEntries(factors?: FactorScores) {
  if (!factors) return []
  return Object.entries(factors).filter(([key, value]) => key !== '__typename' && Number.isFinite(Number(value)))
}

export function factorLabel(key: string): string {
  const map: Record<string, string> = {
    trend: '추세',
    timing: '타이밍',
    valuation: '가치',
    growth: '성장',
    profitability: '수익성',
    risk: '리스크',
    riskSupply: '리스크·수급',
    supplyDemand: '수급',
    dividend: '배당',
    consensus: '컨센서스',
    fundamental: '펀더 종합',
  }
  return map[key] || key
}

export function formatMaybeNumber(value?: number | null) {
  if (value === undefined || value === null) return 'N/A'
  return formatNumber(value)
}

export function formatMaybePercent(value?: number | null) {
  if (value === undefined || value === null) return 'N/A'
  return `${value.toFixed(1)}%`
}

export function arrayHead(values?: number[], suffix = '') {
  if (!values || values.length === 0) return 'N/A'
  return values.slice(0, 3).map((value) => `${formatNumber(value)}${suffix}`).join(', ')
}

export function valueOf(value: unknown) {
  if (value === undefined || value === null || value === '') return 'N/A'
  return String(value)
}
