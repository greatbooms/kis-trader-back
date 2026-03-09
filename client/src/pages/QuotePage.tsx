import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { TrendingUp, TrendingDown, BarChart3, ArrowUpDown } from 'lucide-react'
import {
  useGetQuoteQuery,
  useGetOverseasQuoteQuery,
  type Market,
  type StockSearchResult,
} from '@/graphql/generated'
import { formatCurrency, formatNumber } from '@/lib/utils'
import { COUNTRY_OPTIONS, EXCHANGE_LABELS } from '@/lib/market-constants'
import { StockSearchInput } from '@/components/StockSearchInput'

export function QuotePage() {
  const [country, setCountry] = useState('KR')
  const [searchParams, setSearchParams] = useState<{ country: string; code: string; exchangeCode: string } | null>(null)

  const countryOption = COUNTRY_OPTIONS.find((c) => c.value === country)

  const handleSelect = (stock: StockSearchResult) => {
    const selectedCountry = COUNTRY_OPTIONS.find((c) => c.exchanges.includes(stock.exchangeCode))
    setSearchParams({
      country: selectedCountry?.value ?? country,
      code: stock.stockCode,
      exchangeCode: stock.exchangeCode,
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">시세 조회</h2>
        <p className="text-sm text-muted-foreground mt-1">종목명 또는 코드로 실시간 시세를 조회하세요</p>
      </div>

      <Card>
        <CardContent className="pt-5">
          <div className="flex gap-2">
            <Select
              value={country}
              onChange={(e) => { setCountry(e.target.value); setSearchParams(null) }}
              className="w-32 shrink-0"
            >
              {COUNTRY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </Select>
            <div className="flex-1">
              <StockSearchInput
                market={countryOption?.market}
                placeholder="종목명 또는 코드 검색 (예: 삼성전자, AAPL)"
                onSelect={handleSelect}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {searchParams && (
        searchParams.country === 'KR' ? (
          <DomesticQuoteResult stockCode={searchParams.code} />
        ) : (
          <OverseasQuoteResult
            exchangeCode={searchParams.exchangeCode}
            symbol={searchParams.code}
            countryLabel={COUNTRY_OPTIONS.find((c) => c.value === searchParams.country)?.label ?? '해외'}
          />
        )
      )}
    </div>
  )
}

function DomesticQuoteResult({ stockCode }: { stockCode: string }) {
  const { data, loading, error } = useGetQuoteQuery({ variables: { stockCode } })
  const quote = data?.quote

  if (loading) return <QuoteLoading />
  if (error || !quote) return <QuoteNotFound />

  return <QuoteCard quote={quote} market="DOMESTIC" />
}

function OverseasQuoteResult({ exchangeCode, symbol, countryLabel }: { exchangeCode: string; symbol: string; countryLabel: string }) {
  const { data, loading, error } = useGetOverseasQuoteQuery({ variables: { input: { exchangeCode, symbol } } })
  const quote = data?.overseasQuote

  if (loading) return <QuoteLoading />
  if (error || !quote) return <QuoteNotFound />

  return <QuoteCard quote={quote} market="OVERSEAS" exchangeLabel={EXCHANGE_LABELS[exchangeCode] ?? countryLabel} />
}

function QuoteLoading() {
  return (
    <Card>
      <CardContent className="py-12 text-center text-sm text-muted-foreground">조회중...</CardContent>
    </Card>
  )
}

function QuoteNotFound() {
  return (
    <Card>
      <CardContent className="py-12 text-center text-sm text-muted-foreground">
        시세 정보를 찾을 수 없습니다. 종목코드를 확인해주세요.
      </CardContent>
    </Card>
  )
}

interface QuoteData {
  stockCode: string
  stockName: string
  currentPrice: number
  openPrice?: number | null
  highPrice?: number | null
  lowPrice?: number | null
  volume?: number | null
}

function QuoteCard({ quote, market, exchangeLabel }: { quote: QuoteData; market: Market; exchangeLabel?: string }) {
  const changeFromOpen = quote.openPrice ? quote.currentPrice - quote.openPrice : 0
  const changeRate = quote.openPrice ? (changeFromOpen / quote.openPrice) * 100 : 0
  const isUp = changeFromOpen >= 0

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <CardTitle className="text-xl">{quote.stockName}</CardTitle>
              <span className="text-sm text-muted-foreground">{quote.stockCode}</span>
              {exchangeLabel && <Badge variant="info">{exchangeLabel}</Badge>}
            </div>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold">{formatCurrency(quote.currentPrice, market)}</p>
            {quote.openPrice != null && (
              <div className={`flex items-center justify-end gap-1 mt-1 ${isUp ? 'text-success' : 'text-danger'}`}>
                {isUp ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                <span className="text-sm font-medium">
                  {isUp ? '+' : ''}{formatCurrency(changeFromOpen, market)} ({isUp ? '+' : ''}{changeRate.toFixed(2)}%)
                </span>
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
          <PriceItem label="시가" value={quote.openPrice} market={market} />
          <PriceItem label="고가" value={quote.highPrice} market={market} className="text-danger" />
          <PriceItem label="저가" value={quote.lowPrice} market={market} className="text-info" />
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">거래량</span>
            </div>
            <p className="text-lg font-semibold">{quote.volume ? formatNumber(quote.volume) : '-'}</p>
          </div>
        </div>

        {quote.highPrice != null && quote.lowPrice != null && quote.highPrice > quote.lowPrice && (
          <div className="mt-6">
            <div className="flex items-center gap-1.5 mb-2">
              <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">일중 가격 범위</span>
            </div>
            <div className="relative h-2 rounded-full bg-muted">
              {(() => {
                const range = quote.highPrice! - quote.lowPrice!
                const pos = range > 0 ? ((quote.currentPrice - quote.lowPrice!) / range) * 100 : 50
                return (
                  <>
                    <div
                      className="absolute h-full rounded-full bg-gradient-to-r from-info to-danger"
                      style={{ width: '100%' }}
                    />
                    <div
                      className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-foreground border-2 border-background shadow"
                      style={{ left: `${Math.min(Math.max(pos, 2), 98)}%`, transform: 'translate(-50%, -50%)' }}
                    />
                  </>
                )
              })()}
            </div>
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>{formatCurrency(quote.lowPrice!, market)}</span>
              <span>{formatCurrency(quote.highPrice!, market)}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function PriceItem({ label, value, market, className }: { label: string; value?: number | null; market: Market; className?: string }) {
  return (
    <div>
      <span className="text-sm text-muted-foreground">{label}</span>
      <p className={`text-lg font-semibold ${className ?? ''}`}>
        {value != null ? formatCurrency(value, market) : '-'}
      </p>
    </div>
  )
}
