import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Tooltip } from '@/components/ui/tooltip'
import { Wallet, TrendingUp, TrendingDown, PiggyBank, BarChart3, Info } from 'lucide-react'
import {
  useGetPositionsQuery,
  useGetTradesQuery,
  useGetAccountSummaryQuery,
  useManualSellMutation,
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
        <p className="text-sm text-muted-foreground mt-1">계좌 현황, 보유 종목, 매매 기록을 확인하세요</p>
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

      <AccountSummaryCard />
      <PositionsCard market={marketFilter} countryFilter={countryFilter} />
      <TradesCard market={marketFilter} countryFilter={countryFilter} />
    </div>
  )
}

// ── 계좌 요약 ──

function AccountSummaryCard() {
  const { data, loading } = useGetAccountSummaryQuery()
  const summary = data?.accountSummary

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">로딩중...</CardContent>
      </Card>
    )
  }

  if (!summary) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">계좌 정보를 불러올 수 없습니다</CardContent>
      </Card>
    )
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-2 mb-2">
            <Wallet className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">예수금</span>
            <Tooltip text="현재 매수 가능한 현금 잔고입니다. 국내/해외 계좌의 합산 금액입니다.">
              <Info className="h-3 w-3 text-muted-foreground/60 cursor-help" />
            </Tooltip>
          </div>
          <p className="text-xl font-bold">{formatCurrency(summary.cashBalance)}</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-2 mb-2">
            <PiggyBank className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">총 투자금</span>
            <Tooltip text="현재 보유 중인 종목에 투입된 총 매수 금액입니다.">
              <Info className="h-3 w-3 text-muted-foreground/60 cursor-help" />
            </Tooltip>
          </div>
          <p className="text-xl font-bold">{formatCurrency(summary.totalInvested)}</p>
          <p className="text-xs text-muted-foreground mt-1">{summary.positionCount}개 종목 보유</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">총 자산</span>
            <Tooltip text="예수금 + 보유 종목 평가금액을 합산한 총 자산입니다.">
              <Info className="h-3 w-3 text-muted-foreground/60 cursor-help" />
            </Tooltip>
          </div>
          <p className="text-xl font-bold">{formatCurrency(summary.totalAssets)}</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">미실현 손익</span>
            <Tooltip text="보유 종목의 매입가 대비 현재가 차이로 계산한 평가 손익입니다. 아직 매도하지 않은 보유 포지션의 손익입니다.">
              <Info className="h-3 w-3 text-muted-foreground/60 cursor-help" />
            </Tooltip>
          </div>
          <p className={`text-xl font-bold ${summary.totalProfitLoss >= 0 ? 'text-success' : 'text-danger'}`}>
            {formatCurrency(summary.totalProfitLoss)}
          </p>
          <p className={`text-xs mt-1 ${summary.profitRate >= 0 ? 'text-success' : 'text-danger'}`}>
            {summary.profitRate >= 0 ? '+' : ''}{summary.profitRate.toFixed(2)}%
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingDown className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">실현 손익</span>
            <Tooltip text="매도 완료된 거래에서 발생한 확정 손익입니다. (매도가 - 평균매수가) × 수량의 합계입니다.">
              <Info className="h-3 w-3 text-muted-foreground/60 cursor-help" />
            </Tooltip>
          </div>
          <p className={`text-xl font-bold ${summary.realizedPnL >= 0 ? 'text-success' : 'text-danger'}`}>
            {formatCurrency(summary.realizedPnL)}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

// ── 보유 포지션 ──

function PositionsCard({ market, countryFilter }: { market: Market | null; countryFilter: string | null }) {
  const { data, loading, refetch } = useGetPositionsQuery({ variables: { input: { market } } })
  const allPositions = data?.positions ?? []
  const positions = filterByCountry(allPositions, countryFilter)
  const [sellTarget, setSellTarget] = useState<string | null>(null)
  const [sellQty, setSellQty] = useState<string>('')
  const [sellStep, setSellStep] = useState<'input' | 'confirm'>('input')
  const [manualSell, { loading: sellLoading }] = useManualSellMutation()

  const openSellPanel = (posId: string, maxQty: number) => {
    if (sellTarget === posId) {
      closeSellPanel()
      return
    }
    setSellTarget(posId)
    setSellQty(String(maxQty))
    setSellStep('input')
  }

  const closeSellPanel = () => {
    setSellTarget(null)
    setSellQty('')
    setSellStep('input')
  }

  const handleSell = async (pos: typeof positions[0]) => {
    if (sellStep === 'input') {
      setSellStep('confirm')
      return
    }
    const qty = parseInt(sellQty, 10)
    if (!qty || qty <= 0 || qty > pos.quantity) {
      alert(`1 ~ ${pos.quantity} 사이의 수량을 입력해주세요.`)
      setSellStep('input')
      return
    }
    try {
      const { data: result } = await manualSell({
        variables: {
          input: {
            stockCode: pos.stockCode,
            market: pos.market,
            exchangeCode: pos.exchangeCode ?? undefined,
            quantity: qty,
          },
        },
      })
      if (result?.manualSell.success) {
        alert(result.manualSell.message || '매도 완료')
        refetch()
      } else {
        alert(result?.manualSell.message || '매도 실패')
      }
    } catch (e: any) {
      alert(`매도 실패: ${e.message}`)
    }
    closeSellPanel()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>보유 포지션 ({positions.length})</CardTitle>
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
                <TableHead className="text-center">매도</TableHead>
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
                  <TableCell className="text-center">
                    {sellTarget === pos.id ? (
                      <div className="flex flex-col items-center gap-1.5">
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            min={1}
                            max={pos.quantity}
                            value={sellQty}
                            onChange={(e) => { setSellQty(e.target.value); setSellStep('input') }}
                            className="w-20 h-7 text-sm text-center"
                          />
                          <Button variant="outline" size="sm" className="h-7 px-1.5 text-xs" onClick={() => setSellQty(String(pos.quantity))}>
                            전량
                          </Button>
                        </div>
                        <span className="text-xs text-muted-foreground">최대 {formatNumber(pos.quantity)}주</span>
                        <div className="flex gap-1">
                          <Button
                            variant={sellStep === 'confirm' ? 'danger' : 'default'}
                            size="sm"
                            className="h-7 text-xs"
                            disabled={sellLoading}
                            onClick={() => handleSell(pos)}
                          >
                            {sellStep === 'confirm' ? '확인' : '매도'}
                          </Button>
                          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={closeSellPanel}>
                            취소
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => openSellPanel(pos.id, pos.quantity)}>
                        매도
                      </Button>
                    )}
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

// ── 매매 기록 ──

function TradesCard({ market, countryFilter }: { market: Market | null; countryFilter: string | null }) {
  const [sideFilter, setSideFilter] = useState<Side | null>(null)
  const today = new Date().toISOString().slice(0, 10)
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const [dateFrom, setDateFrom] = useState<string>(weekAgo)
  const [dateTo, setDateTo] = useState<string>(today)
  const [page, setPage] = useState(0)
  const limit = 20

  const { data, loading } = useGetTradesQuery({
    variables: {
      input: {
        market,
        side: sideFilter,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        limit,
        offset: page * limit,
      },
    },
  })
  const allTrades = data?.trades ?? []
  const trades = filterByCountry(allTrades, countryFilter)

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3">
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
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(0) }}
              className="w-40"
            />
            <span className="text-sm text-muted-foreground">~</span>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(0) }}
              className="w-40"
            />
            {(dateFrom || dateTo) && (
              <Button variant="outline" size="sm" onClick={() => { setDateFrom(weekAgo); setDateTo(today); setPage(0) }}>
                초기화
              </Button>
            )}
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

