import { useEffect, useState } from 'react'
import type { Market } from '@/graphql/generated'
import { COUNTRY_OPTIONS } from '@/lib/market-constants'
import type { PortfolioPosition } from './types'

// 국가별 통화 매핑 (이 페이지 한정 — 전역 share 안 함)
const COUNTRY_CURRENCY: Record<string, string> = {
  KR: 'KRW',
  US: 'USD',
  HK: 'HKD',
  CN: 'CNY',
  JP: 'JPY',
  VN: 'VND',
}

export function getCurrencyCodeByCountry(countryValue: string | null): string | null {
  if (!countryValue) return null
  return COUNTRY_CURRENCY[countryValue] ?? null
}

export function getDisplayCashAmount(balance: {
  amount: number
  withdrawableAmount?: number | null
}): number {
  return balance.withdrawableAmount ?? balance.amount
}

export function buildCountryPortfolioSummary(
  countryFilter: string | null,
  positions: PortfolioPosition[],
  cashBalances: Array<{
    market: Market
    currencyCode: string
    currencyName?: string | null
    amount: number
    withdrawableAmount?: number | null
  }>,
) {
  if (!countryFilter) return null

  const country = COUNTRY_OPTIONS.find((item) => item.value === countryFilter)
  const currencyCode = getCurrencyCodeByCountry(countryFilter)
  if (!country || !currencyCode) return null

  const countryPositions = positions.filter((position) =>
    country.exchanges.includes(position.exchangeCode ?? ''),
  )
  const countryCashBalances = cashBalances.filter((balance) => balance.currencyCode === currencyCode)
  const costBasis = countryPositions.reduce((sum, position) => sum + position.totalInvested, 0)
  const totalProfitLoss = countryPositions.reduce((sum, position) => sum + position.profitLoss, 0)
  const currentValue = costBasis + totalProfitLoss
  const cashBalance = countryCashBalances.reduce((sum, balance) => sum + getDisplayCashAmount(balance), 0)
  const totalAssets = currentValue + cashBalance
  const profitRate = costBasis > 0 ? (totalProfitLoss / costBasis) * 100 : 0

  return {
    country,
    currencyCode,
    countryPositions,
    countryCashBalances,
    costBasis,
    totalProfitLoss,
    currentValue,
    cashBalance,
    totalAssets,
    profitRate,
  }
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)')
    const update = () => setIsMobile(mediaQuery.matches)
    update()
    mediaQuery.addEventListener('change', update)
    return () => mediaQuery.removeEventListener('change', update)
  }, [])

  return isMobile
}
