export interface TossAccount {
  accountNo: string;
  accountSeq: number;
  accountType: string;
}

export interface TossBuyingPower {
  currency: 'KRW' | 'USD' | (string & {});
  cashBuyingPower: string;
}

export interface TossExchangeRate {
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  midRate: string;
  basisPoint: string;
  rateChangeType: string;
  validFrom: string;
  validUntil: string;
}
