export interface TossHoldingItem {
  symbol: string;
  name: string;
  marketCountry: 'KR' | 'US' | (string & {});
  currency: 'KRW' | 'USD' | (string & {});
  quantity: string;
  lastPrice: string;
  averagePurchasePrice: string;
  marketValue: {
    purchaseAmount: string;
    amount: string;
    amountAfterCost: string;
  };
  profitLoss: {
    amount: string;
    amountAfterCost: string;
    rate: string;
    rateAfterCost: string;
  };
  dailyProfitLoss: { amount: string; rate: string };
  cost: { commission: string; tax: string | null };
}

interface TossCurrencyAmounts {
  krw: string;
  usd: string | null;
}

export interface TossHoldingsOverview {
  totalPurchaseAmount: TossCurrencyAmounts;
  marketValue: {
    amount: TossCurrencyAmounts;
    amountAfterCost: TossCurrencyAmounts;
  };
  profitLoss: {
    amount: TossCurrencyAmounts;
    amountAfterCost: TossCurrencyAmounts;
    rate: string;
    rateAfterCost: string;
  };
  dailyProfitLoss: { amount: TossCurrencyAmounts; rate: string };
  items: TossHoldingItem[];
}
