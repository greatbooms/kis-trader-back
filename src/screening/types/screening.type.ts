export interface ScreeningCandidate {
  stockCode: string;
  stockName: string;
  exchangeCode: string;
  market: 'DOMESTIC' | 'OVERSEAS';
  currentPrice: number;
  changeRate: number;
  volume: number;
  marketCap: number;
  per?: number; // 해외 조건검색 API에서 제공
  eps?: number; // 해외 조건검색 API에서 제공
  // 거래량순위 API 추가 필드
  volumeIncreaseRate?: number; // 거래량 증가율 (vol_inrt)
  avgVolume?: number; // 평균 거래량 (avrg_vol)
  avgTradingValue?: number; // 평균 거래대금 (avrg_tr_pbmn)
  volumeTurnoverRate?: number; // 거래량 회전율 (vol_tnrt)
  nDayPriceRate?: number; // N일전종가 대비 현재가 비율 (n_befr_clpr_vrss_prpr_rate)
  // 등락률순위 API 추가 필드
  consecutiveUpDays?: number; // 연속 상승 일수 (cnnt_ascn_dynu)
  consecutiveDownDays?: number; // 연속 하락 일수 (cnnt_down_dynu)
  highVsPriceRate?: number; // 최고가 대비 현재가 비율 (hgpr_vrss_prpr_rate)
  lowVsPriceRate?: number; // 최저가 대비 현재가 비율 (lwpr_vrss_prpr_rate)
  // 해외 현재가상세 추가 필드
  sector?: string; // 업종/섹터 (e_icod)
  prevDayVolume?: number; // 전일거래량 (pvol)
}

export interface SuggestedStrategy {
  name: string;
  displayName: string;
  matchScore: number; // 0~100
  reason: string;
}

export interface StockScore {
  stockCode: string;
  stockName: string;
  exchangeCode: string;
  market: 'DOMESTIC' | 'OVERSEAS';
  totalScore: number;
  technicalScore: number;
  fundamentalScore: number;
  momentumScore: number;
  reasons: string[];
  indicators: StockIndicatorDetail;
  suggestedStrategies: SuggestedStrategy[];
  currentPrice: number;
  changeRate: number;
  volume: number;
  marketCap: number;
  isEtf: boolean;
}

/** ETF/ETN/펀드 판별 키워드 */
const ETF_NAME_KEYWORDS = [
  // 해외 ETF
  'ETF', 'ISHARES', 'SPDR', 'VANGUARD', 'PROSHARES', 'DIREXION',
  'INVESCO', 'WISDOMTREE', 'VANECK', 'SCHWAB', 'FIRST TRUST',
  'GLOBAL X', 'ARK ', 'AMPLIFY', 'GRANITESHARES',
  'SELECT SECTOR', 'ULTRA ', 'LEVERAGED',
  // 국내 ETF
  'KODEX', 'TIGER', 'KBSTAR', 'ARIRANG', 'HANARO', 'SOL', 'ACE',
  'KOSEF', 'KINDEX', 'TIMEFOLIO', 'WOORI',
  // ETN
  'ETN', '레버리지', '인버스',
  // 액티브펀드
  'KOACT', 'TIME ', '액티브',
  // SPAC
  '스팩',
];

/** 종목코드 패턴 기반 ETF/ETN 판별 (국내) */
const ETF_CODE_PATTERNS = [
  /^[0-9]{3}[A-Z][0-9]/, // ETN: 예) Q530031
  /^[0-9]{4}[A-Z][0-9]/, // 액티브펀드: 예) 0162Y0
];

/** 종목명 + 종목코드 기반 ETF/ETN/펀드 판별 */
export function detectEtf(stockName: string, stockCode?: string): boolean {
  const upper = stockName.toUpperCase();
  if (ETF_NAME_KEYWORDS.some((kw) => upper.includes(kw))) return true;
  if (stockCode && ETF_CODE_PATTERNS.some((p) => p.test(stockCode))) return true;
  return false;
}

export interface StockIndicatorDetail {
  rsi14?: number;
  ma20?: number;
  ma60?: number;
  ma200?: number;
  priceAboveMa200?: boolean;
  goldenCrossNear?: boolean;
  per?: number;
  pbr?: number;
  roe?: number;
  eps?: number;
  bps?: number;
  debtRatio?: number;
  foreignNetBuy?: boolean;
  institutionNetBuy?: boolean;
  volumeSurgeRate?: number;
  // 추가 기관/외인 세부 데이터
  fundNetBuy?: boolean; // 기금(연기금) 순매수
  trustNetBuy?: boolean; // 투자신탁 순매수
  foreignNetBuyAmount?: number; // 외국인 순매수 거래대금 (백만원)
  // 추가 리스크/가격 위치 지표
  loanBalanceRate?: number; // 융자잔고 비율 (%)
  shortSellable?: boolean; // 공매도 가능 여부
  d250High?: number; // 250일 최고가
  d250Low?: number; // 250일 최저가
  d250HighRate?: number; // 250일 최고가 대비 현재가 비율
  d250LowRate?: number; // 250일 최저가 대비 현재가 비율
  yearHigh?: number; // 연중 최고가
  yearLow?: number; // 연중 최저가
  yearHighRate?: number; // 연중 최고가 대비 현재가 비율
  yearLowRate?: number; // 연중 최저가 대비 현재가 비율
  // 거래량 관련 추가 지표
  volumeIncreaseRate?: number; // API 직접 제공 거래량 증가율
  avgVolume?: number; // 평균 거래량
  volumeToAvgRatio?: number; // 현재거래량 / 평균거래량 비율
  // 해외 추가
  sector?: string; // 업종/섹터
  prevDayVolumeChangeRate?: number; // 전일거래량 대비 변화율 (해외)
}
