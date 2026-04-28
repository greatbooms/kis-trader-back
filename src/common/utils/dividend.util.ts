import { pickNumeric, pickString } from './api-data.util';

const RECORD_DATE_KEYS = [
  'cash_div_dt',
  'ex_dividend_date',
  '배당기준일',
  'record_date',
];

const PAYMENT_DATE_KEYS = [
  'pay_dt',
  'payment_date',
  'divi_pay_dt',
];

const DIVIDEND_AMOUNT_KEYS = [
  'cash_divi_rate',
  'dividend_amount',
  '주당배당금',
  'per_sto_divi_amt',
];

interface DividendRecordSummary {
  consecutiveDividendYears?: number;
  dividendGrowthRate5y?: number;
  latestDividendAmount?: number;
  latestAnnualDividendAmount?: number;
  exDividendDate?: string;
  nextPaymentDate?: string;
}

function normalizeDate(value?: string): string | undefined {
  if (!value) return undefined;
  const digits = String(value).replace(/\D/g, '');
  if (digits.length >= 8) return digits.slice(0, 8);
  if (digits.length >= 6) return digits.slice(0, 6);
  if (digits.length >= 4) return digits.slice(0, 4);
  return undefined;
}

export function summarizeDividendSchedule(dividendSchedule: any[] | undefined): DividendRecordSummary {
  const records = (dividendSchedule ?? [])
    .map((item) => ({
      recordDate: normalizeDate(pickString(item, RECORD_DATE_KEYS)),
      paymentDate: normalizeDate(pickString(item, PAYMENT_DATE_KEYS)),
      amount: pickNumeric(item, DIVIDEND_AMOUNT_KEYS),
    }))
    .filter((item) => item.recordDate || item.paymentDate || item.amount !== undefined);

  if (records.length === 0) {
    return {};
  }

  const years = new Set(
    records
      .map((item) => item.recordDate?.slice(0, 4))
      .filter((value): value is string => Boolean(value)),
  );

  const annualAmounts = new Map<string, number>();
  for (const record of records) {
    const year = record.recordDate?.slice(0, 4);
    if (!year || record.amount === undefined) continue;
    annualAmounts.set(year, (annualAmounts.get(year) ?? 0) + record.amount);
  }

  const annualSeries = Array.from(annualAmounts.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-5)
    .map(([, amount]) => amount);
  const latestAnnualDividendAmount = Array.from(annualAmounts.entries())
    .sort(([left], [right]) => right.localeCompare(left))[0]?.[1];

  const dividendGrowthRate5y = annualSeries.length >= 2 && annualSeries[0] > 0
    ? ((annualSeries[annualSeries.length - 1] / annualSeries[0]) ** (1 / Math.max(annualSeries.length - 1, 1)) - 1) * 100
    : undefined;

  const latestRecord = [...records]
    .sort((left, right) => (right.recordDate ?? '').localeCompare(left.recordDate ?? ''))[0];

  return {
    consecutiveDividendYears: years.size || undefined,
    dividendGrowthRate5y,
    latestDividendAmount: latestRecord?.amount,
    latestAnnualDividendAmount,
    exDividendDate: latestRecord?.recordDate,
    nextPaymentDate: latestRecord?.paymentDate,
  };
}
