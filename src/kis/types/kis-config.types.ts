export type KisEnv = 'paper' | 'prod';

export interface KisConfig {
  appKey: string;
  appSecret: string;
  accountNo: string;
  prodCode: string;
  env: KisEnv;
}

export const KIS_BASE_URLS = {
  prod: 'https://openapi.koreainvestment.com:9443',
  paper: 'https://openapivts.koreainvestment.com:29443',
} as const;

/** 해외 거래소 코드 */
export enum ExchangeCode {
  // 국내
  KRX = 'KRX',
  // 미국
  NASD = 'NASD',
  NYSE = 'NYSE',
  AMEX = 'AMEX',
  // 아시아
  SEHK = 'SEHK', // 홍콩
  SHAA = 'SHAA', // 중국 상해
  SZAA = 'SZAA', // 중국 심천
  TKSE = 'TKSE', // 일본
  HASE = 'HASE', // 베트남 하노이
  VNSE = 'VNSE', // 베트남 호치민
}

/** KIS API에서 사용하는 해외 거래소 코드 (시세 조회용) */
export const EXCHANGE_CODE_MAP: Record<string, string> = {
  NASD: 'NAS',
  NYSE: 'NYS',
  AMEX: 'AMS',
  SEHK: 'HKS',
  SHAA: 'SHS',
  SZAA: 'SZS',
  TKSE: 'TSE',
  HASE: 'HNX',
  VNSE: 'HSX',
};

/** 해외 거래소별 주문 TR ID 매핑 */
export const OVERSEAS_ORDER_TR_IDS: Record<
  string,
  { buy: string; sell: string; buyPaper: string; sellPaper: string }
> = {
  NASD: { buy: 'TTTT1002U', sell: 'TTTT1006U', buyPaper: 'VTTT1002U', sellPaper: 'VTTT1006U' },
  NYSE: { buy: 'TTTT1002U', sell: 'TTTT1006U', buyPaper: 'VTTT1002U', sellPaper: 'VTTT1006U' },
  AMEX: { buy: 'TTTT1002U', sell: 'TTTT1006U', buyPaper: 'VTTT1002U', sellPaper: 'VTTT1006U' },
  SEHK: { buy: 'TTTS1002U', sell: 'TTTS1001U', buyPaper: 'VTTS1002U', sellPaper: 'VTTS1001U' },
  SHAA: { buy: 'TTTS0202U', sell: 'TTTS1005U', buyPaper: 'VTTS0202U', sellPaper: 'VTTS1005U' },
  SZAA: { buy: 'TTTS0305U', sell: 'TTTS0304U', buyPaper: 'VTTS0305U', sellPaper: 'VTTS0304U' },
  TKSE: { buy: 'TTTS0308U', sell: 'TTTS0307U', buyPaper: 'VTTS0308U', sellPaper: 'VTTS0307U' },
  HASE: { buy: 'TTTS0311U', sell: 'TTTS0310U', buyPaper: 'VTTS0311U', sellPaper: 'VTTS0310U' },
  VNSE: { buy: 'TTTS0311U', sell: 'TTTS0310U', buyPaper: 'VTTS0311U', sellPaper: 'VTTS0310U' },
};

/** 거래소별 참조 지수 매핑 (개선 E: 시장 상황 판단용) */
export const EXCHANGE_REFERENCE_INDEX: Record<string, { code: string; name: string; type: 'domestic' | 'overseas' }> = {
  KRX:  { code: '0001',    name: 'KOSPI',      type: 'domestic' },
  NASD: { code: 'SPX',     name: 'S&P500',     type: 'overseas' },
  NYSE: { code: 'SPX',     name: 'S&P500',     type: 'overseas' },
  AMEX: { code: 'SPX',     name: 'S&P500',     type: 'overseas' },
  SEHK: { code: 'HSI',     name: '항셍지수',    type: 'overseas' },
  TKSE: { code: 'N225',    name: '닛케이225',   type: 'overseas' },
  SHAA: { code: 'SHCOMP',  name: '상해종합',    type: 'overseas' },
  SZAA: { code: 'SHCOMP',  name: '상해종합',    type: 'overseas' },
  HASE: { code: 'VNINDEX', name: 'VN지수',     type: 'overseas' },
  VNSE: { code: 'VNINDEX', name: 'VN지수',     type: 'overseas' },
};

/** 거래소별 운영시간 (KST, 24h format) */
export interface MarketHours {
  open: { hour: number; minute: number };
  close: { hour: number; minute: number };
  /** true이면 자정을 넘기는 시간대 (예: 미국 23:30~06:00) */
  overnight: boolean;
}

export const MARKET_HOURS: Record<string, MarketHours> = {
  KRX: { open: { hour: 9, minute: 0 }, close: { hour: 15, minute: 30 }, overnight: false },
  NASD: { open: { hour: 23, minute: 30 }, close: { hour: 6, minute: 0 }, overnight: true },
  NYSE: { open: { hour: 23, minute: 30 }, close: { hour: 6, minute: 0 }, overnight: true },
  AMEX: { open: { hour: 23, minute: 30 }, close: { hour: 6, minute: 0 }, overnight: true },
  SEHK: { open: { hour: 10, minute: 30 }, close: { hour: 17, minute: 0 }, overnight: false },
  SHAA: { open: { hour: 10, minute: 30 }, close: { hour: 16, minute: 0 }, overnight: false },
  SZAA: { open: { hour: 10, minute: 30 }, close: { hour: 16, minute: 0 }, overnight: false },
  TKSE: { open: { hour: 9, minute: 0 }, close: { hour: 15, minute: 0 }, overnight: false },
  HASE: { open: { hour: 9, minute: 0 }, close: { hour: 14, minute: 30 }, overnight: false },
  VNSE: { open: { hour: 9, minute: 0 }, close: { hour: 14, minute: 30 }, overnight: false },
};
