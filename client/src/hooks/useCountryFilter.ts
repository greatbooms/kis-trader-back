import { useCallback, useState } from 'react'
import type { Market } from '@/graphql/generated'
import { COUNTRY_OPTIONS, type CountryOption } from '@/lib/market-constants'

export interface UseCountryFilterResult {
  /** 현재 선택된 국가 코드 (`KR`, `US` 등). null이면 전체. */
  countryFilter: string | null
  setCountryFilter: (value: string | null) => void
  /** 선택된 country option 객체 (없으면 undefined). */
  selectedCountry: CountryOption | undefined
  /** 선택된 국가의 market (`DOMESTIC`/`OVERSEAS`). 전체일 땐 undefined. */
  marketFilter: Market | undefined
}

/**
 * 페이지 상단의 국가 칩 필터에서 공유되는 상태 + 파생값.
 * Watchlist / Portfolio 등 여러 페이지가 동일한 모양으로 사용한다.
 *
 * @param initial 초기 country code (기본 null = 전체)
 */
export function useCountryFilter(initial: string | null = null): UseCountryFilterResult {
  const [countryFilter, setCountryFilterState] = useState<string | null>(initial)

  const setCountryFilter = useCallback((value: string | null) => {
    setCountryFilterState(value)
  }, [])

  const selectedCountry = countryFilter
    ? COUNTRY_OPTIONS.find((c) => c.value === countryFilter)
    : undefined
  const marketFilter: Market | undefined = selectedCountry?.market

  return { countryFilter, setCountryFilter, selectedCountry, marketFilter }
}
