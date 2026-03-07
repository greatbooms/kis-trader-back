import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Search } from 'lucide-react'
import {
  useGetPositionsQuery,
  useGetTradesQuery,
  useGetQuoteQuery,
  useGetStrategyExecutionsQuery,
  type Market,
  type Side,
} from '@/graphql/generated'
import { formatCurrency, formatPercent, formatNumber, formatDate } from '@/lib/utils'
import { COUNTRY_OPTIONS, EXCHANGE_LABELS, filterByCountry } from '@/lib/market-constants'

export function PortfolioPage() {
  const [countryFilter, setCountryFilter] = useState<string | null>(null)
  const selectedCountry = COUNTRY_OPTIONS.find((c) => c.value === countryFilter)
  const marketFilter: Market | null = selectedCountry?.market ?? null

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">포트폴리오</h2>
        <p className="text-sm text-muted-foreground mt-1">보유 종목, 매매 기록, 전략 실행 이력을 확인하세요</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Button
          variant={countryFilter === null ? 'default' : 'outline'}
          size="sm"
          onClick={() => setCountryFilter(null)}
        >
          전체
        </Button>
        {COUNTRY_OPTIONS.map((c) => (
          <Button
            key={c.value}
            variant={countryFilter === c.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => setCountryFilter(c.value)}
          >
            {c.label}
          </Button>
        ))}
      </div>

      <PositionsCard market={marketFilter} countryFilter={countryFilter} />
      <StrategyExecutionsCard />
      <TradesCard market={marketFilter} countryFilter={countryFilter} />
      <QuoteLookup />
    </div>
  )
}

function PositionsCard({ market, countryFilter }: { market: Market | null; countryFilter: string | null }) {
  const { data, loading } = useGetPositionsQuery({ variables: { market } })
  const allPositions = data?.positions ?? []
  const positions = filterByCountry(allPositions, countryFilter)
  const totalInvested = positions.reduce((sum, p) => sum + p.totalInvested, 0)
  const totalPnl = positions.reduce((sum, p) => sum + p.profitLoss, 0)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>보유 포지션 ({positions.length})</CardTitle>
          {totalInvested > 0 && (
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">투자금: {formatCurrency(totalInvested)}</span>
              <Badge variant={totalPnl >= 0 ? 'success' : 'danger'}>
                총 손익: {formatCurrency(totalPnl)} ({formatPercent(totalPnl / totalInvested)})
              </Badge>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-8">로딩중...</p>
        ) : positions.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">보유 포지션이 없습니다</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border">
                <TableHead>종목</TableHead>
                <TableHead>시장</TableHead>
                <TableHead className="text-right">수량</TableHead>
                <TableHead className="text-right">평균가</TableHead>
                <TableHead className="text-right">현재가</TableHead>
                <TableHead className="text-right">투자금</TableHead>
                <TableHead className="text-right">손익</TableHead>
                <TableHead className="text-right">수익률</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {positions.map((pos) => (
                <TableRow key={pos.id}>
                  <TableCell>
                    <div className="font-medium">{pos.stockName}</div>
                    <div className="text-xs text-muted-foreground">{pos.stockCode}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={pos.market === 'DOMESTIC' ? 'default' : 'info'}>
                      {pos.exchangeCode ? (EXCHANGE_LABELS[pos.exchangeCode] ?? pos.exchangeCode) : (pos.market === 'DOMESTIC' ? '한국' : '해외')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{formatNumber(pos.quantity)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(pos.avgPrice, pos.market)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(pos.currentPrice, pos.market)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(pos.totalInvested, pos.market)}</TableCell>
                  <TableCell className={`text-right font-medium ${pos.profitLoss >= 0 ? 'text-success' : 'text-danger'}`}>
                    {formatCurrency(pos.profitLoss, pos.market)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant={pos.profitRate >= 0 ? 'success' : 'danger'}>{formatPercent(pos.profitRate)}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function StrategyExecutionsCard() {
  const { data, loading } = useGetStrategyExecutionsQuery({ variables: { limit: 20 } })
  const executions = data?.strategyExecutions ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>전략 실행 이력</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-8">로딩중...</p>
        ) : executions.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">실행 이력이 없습니다</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border">
                <TableHead>날짜</TableHead>
                <TableHead>종목</TableHead>
                <TableHead>전략</TableHead>
                <TableHead className="text-right">진행률</TableHead>
                <TableHead className="text-right">시그널</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {executions.map((exec) => (
                <TableRow key={exec.id}>
                  <TableCell className="py-2">{formatDate(exec.createdAt)}</TableCell>
                  <TableCell className="py-2">{exec.stockCode}</TableCell>
                  <TableCell className="py-2"><Badge>{exec.strategyName}</Badge></TableCell>
                  <TableCell className="py-2 text-right">{(exec.progress * 100).toFixed(0)}%</TableCell>
                  <TableCell className="py-2 text-right">{exec.signalCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function QuoteLookup() {
  const [quoteCountry, setQuoteCountry] = useState('KR')
  const quoteMarket = COUNTRY_OPTIONS.find((c) => c.value === quoteCountry)?.market ?? ('DOMESTIC' as Market)
  const [stockCode, setStockCode] = useState('')
  const [searchCode, setSearchCode] = useState('')

  const { data, loading } = useGetQuoteQuery({
    variables: { stockCode: searchCode },
    skip: !searchCode,
  })
  const quote = data?.quote

  return (
    <Card>
      <CardHeader>
        <CardTitle>실시간 시세 조회</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2 mb-4">
          <Select
            value={quoteCountry}
            onChange={(e) => setQuoteCountry(e.target.value)}
            className="w-auto"
          >
            {COUNTRY_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </Select>
          <Input
            placeholder="종목코드 입력 (예: 005930)"
            value={stockCode}
            onChange={(e) => setStockCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && stockCode && setSearchCode(stockCode)}
          />
          <Button onClick={() => stockCode && setSearchCode(stockCode)} disabled={!stockCode}>
            <Search size={16} /> 조회
          </Button>
        </div>
        {loading && <p className="text-sm text-muted-foreground">조회중...</p>}
        {quote && (
          <div className="rounded-lg border border-border/50 p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <span className="font-bold text-lg">{quote.stockName}</span>
                <span className="text-sm text-muted-foreground ml-2">{quote.stockCode}</span>
              </div>
              <span className="text-2xl font-bold">{formatCurrency(quote.currentPrice, quoteMarket)}</span>
            </div>
            <div className="grid grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">시가</span>
                <div className="font-medium">{quote.openPrice ? formatCurrency(quote.openPrice, quoteMarket) : '-'}</div>
              </div>
              <div>
                <span className="text-muted-foreground">고가</span>
                <div className="font-medium text-danger">{quote.highPrice ? formatCurrency(quote.highPrice, quoteMarket) : '-'}</div>
              </div>
              <div>
                <span className="text-muted-foreground">저가</span>
                <div className="font-medium text-info">{quote.lowPrice ? formatCurrency(quote.lowPrice, quoteMarket) : '-'}</div>
              </div>
              <div>
                <span className="text-muted-foreground">거래량</span>
                <div className="font-medium">{quote.volume ? formatNumber(quote.volume) : '-'}</div>
              </div>
            </div>
          </div>
        )}
        {searchCode && !loading && !quote && (
          <p className="text-sm text-muted-foreground">시세 정보를 찾을 수 없습니다</p>
        )}
      </CardContent>
    </Card>
  )
}

function TradesCard({ market, countryFilter }: { market: Market | null; countryFilter: string | null }) {
  const [sideFilter, setSideFilter] = useState<Side | null>(null)
  const [page, setPage] = useState(0)
  const limit = 20

  const { data, loading } = useGetTradesQuery({
    variables: { market, side: sideFilter, limit, offset: page * limit },
  })
  const allTrades = data?.trades ?? []
  const trades = filterByCountry(allTrades, countryFilter)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>매매 기록</CardTitle>
          <div className="flex gap-2">
            {([null, 'BUY', 'SELL'] as const).map((s) => (
              <Button key={s ?? 'all'} variant={sideFilter === s ? 'default' : 'outline'} size="sm" onClick={() => { setSideFilter(s); setPage(0) }}>
                {s === null ? '전체' : s === 'BUY' ? '매수' : '매도'}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-8">로딩중...</p>
        ) : trades.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">매매 기록이 없습니다</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border">
                  <TableHead>일시</TableHead>
                  <TableHead>종목</TableHead>
                  <TableHead>구분</TableHead>
                  <TableHead className="text-right">수량</TableHead>
                  <TableHead className="text-right">가격</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead>전략</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trades.map((trade) => (
                  <TableRow key={trade.id}>
                    <TableCell className="py-2 text-xs">{formatDate(trade.createdAt)}</TableCell>
                    <TableCell className="py-2">
                      <div className="font-medium">{trade.stockName}</div>
                      <div className="text-xs text-muted-foreground">{trade.stockCode}</div>
                    </TableCell>
                    <TableCell className="py-2">
                      <Badge variant={trade.side === 'BUY' ? 'danger' : 'info'}>
                        {trade.side === 'BUY' ? '매수' : '매도'}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-2 text-right">{formatNumber(trade.quantity)}</TableCell>
                    <TableCell className="py-2 text-right">{formatCurrency(trade.executedPrice ?? trade.price, trade.market)}</TableCell>
                    <TableCell className="py-2">
                      <Badge variant={trade.status === 'FILLED' ? 'success' : trade.status === 'FAILED' ? 'danger' : 'warning'}>
                        {trade.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground">{trade.strategyName ?? '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex justify-between items-center mt-4">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>
                이전
              </Button>
              <span className="text-sm text-muted-foreground">페이지 {page + 1}</span>
              <Button size="sm" variant="outline" disabled={trades.length < limit} onClick={() => setPage(page + 1)}>
                다음
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
