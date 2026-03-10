import type { Market } from '@/graphql/generated'

export interface CountryOption {
  value: string
  label: string
  market: Market
  exchanges: string[]
  regimeExchangeCode: string
}

export const COUNTRY_OPTIONS: CountryOption[] = [
  { value: 'KR', label: '한국', market: 'DOMESTIC', exchanges: ['KRX'], regimeExchangeCode: 'KRX' },
  { value: 'US', label: '미국', market: 'OVERSEAS', exchanges: ['NASD', 'NYSE', 'AMEX'], regimeExchangeCode: 'NASD' },
  { value: 'HK', label: '홍콩', market: 'OVERSEAS', exchanges: ['SEHK'], regimeExchangeCode: 'SEHK' },
  { value: 'CN', label: '중국', market: 'OVERSEAS', exchanges: ['SHAA', 'SZAA'], regimeExchangeCode: 'SHAA' },
  { value: 'JP', label: '일본', market: 'OVERSEAS', exchanges: ['TKSE'], regimeExchangeCode: 'TKSE' },
  { value: 'VN', label: '베트남', market: 'OVERSEAS', exchanges: ['HASE', 'VNSE'], regimeExchangeCode: 'HASE' },
]

export const EXCHANGE_LABELS: Record<string, string> = {
  KRX: '한국',
  NASD: '나스닥', NYSE: '뉴욕', AMEX: '아멕스',
  SEHK: '홍콩', SHAA: '상해', SZAA: '심천',
  TKSE: '일본', HASE: '하노이', VNSE: '호치민',
}

export function exchangeToCountry(exchangeCode?: string | null): string {
  if (!exchangeCode) return 'KR'
  const found = COUNTRY_OPTIONS.find((c) => c.exchanges.includes(exchangeCode))
  return found?.value ?? 'KR'
}

export function getCountryByValue(value: string | null): CountryOption | undefined {
  return COUNTRY_OPTIONS.find((c) => c.value === value) ?? undefined
}

export function filterByCountry<T extends { exchangeCode?: string | null }>(
  items: T[],
  countryFilter: string | null,
): T[] {
  if (!countryFilter) return items
  const country = getCountryByValue(countryFilter)
  if (!country) return items
  return items.filter((item) => country.exchanges.includes(item.exchangeCode ?? ''))
}

export function countByCountry<T extends { exchangeCode?: string | null }>(
  items: T[],
  country: CountryOption,
): number {
  return items.filter((item) => country.exchanges.includes(item.exchangeCode ?? '')).length
}
