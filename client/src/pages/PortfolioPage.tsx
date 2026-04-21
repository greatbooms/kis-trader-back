import { useEffect, useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Tooltip } from '@/components/ui/tooltip'
import { Wallet, TrendingUp, TrendingDown, PiggyBank, BarChart3, Info, RefreshCw, ChevronDown } from 'lucide-react'
import {
  GetAccountSummaryDocument,
  GetDashboardSummaryDocument,
  GetPositionsDocument,
  GetTradesDocument,
  useGetPositionsQuery,
  useGetTradesQuery,
  useGetAccountSummaryQuery,
  useRefreshAccountStateMutation,
  useManualSellMutation,
  useCancelTradeOrderMutation,
  type Market,
  type GetPositionsQuery,
  type Side,
} from '@/graphql/generated'
import { canCancelTrade, getTradeRecordDisplayInfo } from '@/lib/trade-record'
import { formatCurrency, formatCurrencyByCode, formatPercent, formatNumber, formatDate, formatDateInputInTimeZone } from '@/lib/utils'
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

      <AccountSummaryCard countryFilter={countryFilter} />
      <PositionsCard market={marketFilter} countryFilter={countryFilter} />
      <TradesCard market={marketFilter} countryFilter={countryFilter} />
    </div>
  )
}

type PortfolioPosition = GetPositionsQuery['positions'][number]

const COUNTRY_CURRENCY: Record<string, string> = {
  KR: 'KRW',
  US: 'USD',
  HK: 'HKD',
  CN: 'CNY',
  JP: 'JPY',
  VN: 'VND',
}

function getCurrencyCodeByCountry(countryValue: string | null): string | null {
  if (!countryValue) return null
  return COUNTRY_CURRENCY[countryValue] ?? null
}

function getDisplayCashAmount(balance: {
  amount: number
  withdrawableAmount?: number | null
}): number {
  return balance.withdrawableAmount ?? balance.amount
}

function buildCountryPortfolioSummary(
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

function useIsMobile() {
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

function SectionToggleButton({
  collapsed,
  onClick,
  label,
}: {
  collapsed: boolean
  onClick: () => void
  label: string
}) {
  return (
    <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-muted-foreground" onClick={onClick}>
      <span className="text-xs">{collapsed ? `${label} 펼치기` : `${label} 접기`}</span>
      <ChevronDown className={`h-4 w-4 transition-transform ${collapsed ? '' : 'rotate-180'}`} />
    </Button>
  )
}

function SummaryMetricCard({
  icon,
  label,
  tooltip,
  value,
  subValue,
  tone = 'default',
}: {
  icon: React.ReactNode
  label: string
  tooltip?: string
  value: React.ReactNode
  subValue?: React.ReactNode
  tone?: 'default' | 'success' | 'danger'
}) {
  const valueToneClass =
    tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-foreground'
  const subToneClass =
    tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-muted-foreground'

  return (
    <div className="rounded-xl border border-border/80 bg-card/60 px-4 py-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <span className="text-sm text-muted-foreground">{label}</span>
        {tooltip ? (
          <Tooltip text={tooltip}>
            <Info className="h-3 w-3 cursor-help text-muted-foreground/60" />
          </Tooltip>
        ) : null}
      </div>
      <p className={`text-xl font-bold ${valueToneClass}`}>{value}</p>
      {subValue ? <p className={`mt-1 text-xs ${subToneClass}`}>{subValue}</p> : null}
    </div>
  )
}

// ── 계좌 요약 ──

function AccountSummaryCard({ countryFilter }: { countryFilter: string | null }) {
  const isMobile = useIsMobile()
  const [collapsed, setCollapsed] = useState(false)
  const { data, loading, refetch } = useGetAccountSummaryQuery()
  const { data: positionsData } = useGetPositionsQuery()
  const [refreshAccountState, { loading: refreshLoading }] = useRefreshAccountStateMutation({
    refetchQueries: [
      GetAccountSummaryDocument,
      GetPositionsDocument,
      GetDashboardSummaryDocument,
    ],
    awaitRefetchQueries: true,
  })
  const summary = data?.accountSummary
  const positions = positionsData?.positions ?? []
  const scopedSummary = summary
    ? buildCountryPortfolioSummary(
        countryFilter,
        positions,
        summary.cashBalances.map((cash) => ({
          market: cash.market,
          currencyCode: cash.currencyCode,
          amount: cash.amount,
          withdrawableAmount: cash.withdrawableAmount,
        })),
      )
    : null
  const overallDomesticCash = summary?.cashBalances
    .filter((cash) => cash.currencyCode === 'KRW')
    .reduce((sum, cash) => sum + getDisplayCashAmount(cash), 0) ?? 0
  const overallOverseasCurrencies = Array.from(
    new Set((summary?.cashBalances ?? []).filter((cash) => cash.currencyCode !== 'KRW').map((cash) => cash.currencyCode)),
  )

  useEffect(() => {
    setCollapsed(false)
  }, [isMobile])

  const handleRefresh = async () => {
    try {
      const result = await refreshAccountState()
      await refetch()
      alert(result.data?.refreshAccountState.message || '계좌 상태를 새로고침했습니다.')
    } catch (e: any) {
      alert(`계좌 상태 새로고침 실패: ${e.message}`)
    }
  }

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
    <Card className="overflow-hidden">
      <CardHeader className="gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>{scopedSummary ? '국가별 자산 요약' : '계좌 개요'}</CardTitle>
            <CardDescription>
              {scopedSummary
                ? `${scopedSummary.country.label} 탭 기준으로 ${scopedSummary.currencyCode} 통화 자산만 집계합니다.`
                : '전체 탭은 통화 혼합 총액 대신 계좌 전반 상태만 간단히 보여줍니다.'}
              {summary.lastSyncedAt ? ` 마지막 갱신 ${formatDate(summary.lastSyncedAt)}` : ' 아직 새로고침 이력이 없습니다.'}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isMobile ? (
              <SectionToggleButton
                collapsed={collapsed}
                onClick={() => setCollapsed((prev) => !prev)}
                label="계좌 요약"
              />
            ) : null}
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshLoading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${refreshLoading ? 'animate-spin' : ''}`} />
              계좌 상태 새로고침
            </Button>
          </div>
        </div>
      </CardHeader>
      {!collapsed ? (
        <CardContent className="space-y-5">
          {scopedSummary ? (
            <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 lg:grid-cols-5">
              <SummaryMetricCard
                icon={<Wallet className="h-4 w-4 text-muted-foreground" />}
                label="예수금"
                tooltip="선택한 국가 탭 기준 현금입니다."
                value={formatCurrencyByCode(scopedSummary.cashBalance, scopedSummary.currencyCode)}
                subValue={`${scopedSummary.countryCashBalances.length}개 계좌 현금 항목`}
              />
              <SummaryMetricCard
                icon={<PiggyBank className="h-4 w-4 text-muted-foreground" />}
                label="매입원가"
                tooltip="선택한 국가 탭 포지션의 총 매수 금액입니다."
                value={formatCurrencyByCode(scopedSummary.costBasis, scopedSummary.currencyCode)}
                subValue={`${scopedSummary.countryPositions.length}개 종목 보유`}
              />
              <SummaryMetricCard
                icon={<BarChart3 className="h-4 w-4 text-muted-foreground" />}
                label="평가자산"
                tooltip="선택한 국가 탭의 현금 + 보유 평가금액입니다."
                value={formatCurrencyByCode(scopedSummary.totalAssets, scopedSummary.currencyCode)}
                subValue={`보유 평가금액 ${formatCurrencyByCode(scopedSummary.currentValue, scopedSummary.currencyCode)}`}
              />
              <SummaryMetricCard
                icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
                label="미실현 손익"
                tooltip="선택한 국가 탭 포지션의 평가 손익입니다."
                value={formatCurrencyByCode(scopedSummary.totalProfitLoss, scopedSummary.currencyCode)}
                subValue={`${scopedSummary.profitRate >= 0 ? '+' : ''}${scopedSummary.profitRate.toFixed(2)}%`}
                tone={scopedSummary.totalProfitLoss >= 0 ? 'success' : 'danger'}
              />
              <SummaryMetricCard
                icon={<TrendingDown className="h-4 w-4 text-muted-foreground" />}
                label="통화 기준"
                tooltip="선택한 국가 탭의 기준 통화입니다."
                value={scopedSummary.currencyCode}
                subValue={`${scopedSummary.country.label} 시장 자산만 표시 중`}
                tone="default"
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 xl:grid-cols-4">
              <SummaryMetricCard
                icon={<Wallet className="h-4 w-4 text-muted-foreground" />}
                label="국내 KRW 예수금"
                tooltip="전체 탭에서는 국내 원화 예수금만 별도로 보여줍니다."
                value={formatCurrencyByCode(overallDomesticCash, 'KRW')}
                subValue="국내 계좌 기준"
              />
              <SummaryMetricCard
                icon={<PiggyBank className="h-4 w-4 text-muted-foreground" />}
                label="보유 종목"
                tooltip="전체 포트폴리오의 보유 종목 수입니다."
                value={`${summary.positionCount}개 종목`}
                subValue="정확한 자산 금액은 국가 탭에서 확인하세요."
              />
              <SummaryMetricCard
                icon={<BarChart3 className="h-4 w-4 text-muted-foreground" />}
                label="해외 예수금 통화"
                tooltip="전체 탭에서는 해외 예수금의 통화 종류만 요약합니다."
                value={`${overallOverseasCurrencies.length}개`}
                subValue={overallOverseasCurrencies.length > 0 ? overallOverseasCurrencies.join(', ') : '해외 예수금 없음'}
              />
              <SummaryMetricCard
                icon={<TrendingDown className="h-4 w-4 text-muted-foreground" />}
                label="마지막 갱신"
                tooltip="전체 탭은 통화 혼합 총액 대신 계좌 전반 상태만 보여줍니다."
                value={summary.lastSyncedAt ? formatDate(summary.lastSyncedAt) : '-'}
                tone="default"
              />
            </div>
          )}
        </CardContent>
      ) : null}
    </Card>
  )
}

// ── 보유 포지션 ──

function PositionsCard({ market, countryFilter }: { market: Market | null; countryFilter: string | null }) {
  const isMobile = useIsMobile()
  const [collapsed, setCollapsed] = useState(false)
  const { data, loading, refetch } = useGetPositionsQuery({ variables: { input: { market } } })
  const allPositions = data?.positions ?? []
  const positions = filterByCountry(allPositions, countryFilter)
  const [sellTarget, setSellTarget] = useState<string | null>(null)
  const [sellQty, setSellQty] = useState<string>('')
  const [sellStep, setSellStep] = useState<'input' | 'confirm'>('input')
  const [manualSell, { loading: sellLoading }] = useManualSellMutation()

  useEffect(() => {
    setCollapsed(false)
  }, [isMobile])

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
            exchangeCode: pos.exchangeCode,
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
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>보유 포지션 ({positions.length})</CardTitle>
        {isMobile ? (
          <SectionToggleButton
            collapsed={collapsed}
            onClick={() => setCollapsed((prev) => !prev)}
            label="보유 포지션"
          />
        ) : null}
      </CardHeader>
      {!collapsed ? (
        <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-8">로딩중...</p>
        ) : positions.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">보유 포지션이 없습니다</p>
        ) : (
          <>
            <div className="space-y-3 md:hidden">
              {positions.map((pos) => (
                <div key={pos.id} className="rounded-lg border border-border p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{pos.stockName}</div>
                      <div className="text-xs text-muted-foreground">{pos.stockCode}</div>
                    </div>
                    <Badge variant={pos.market === 'DOMESTIC' ? 'default' : 'info'}>
                      {pos.exchangeCode ? (EXCHANGE_LABELS[pos.exchangeCode] ?? pos.exchangeCode) : (pos.market === 'DOMESTIC' ? '한국' : '해외')}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <MetricItem label="수량" value={formatNumber(pos.quantity)} />
                    <MetricItem label="평균가" value={formatCurrency(pos.avgPrice, pos.market)} />
                    <MetricItem label="현재가" value={formatCurrency(pos.currentPrice, pos.market)} />
                    <MetricItem label="투자금" value={formatCurrency(pos.totalInvested, pos.market)} />
                    <MetricItem
                      label="손익"
                      value={formatCurrency(pos.profitLoss, pos.market)}
                      valueClassName={pos.profitLoss >= 0 ? 'text-success font-medium' : 'text-danger font-medium'}
                    />
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">수익률</div>
                      <Badge variant={pos.profitRate >= 0 ? 'success' : 'danger'}>{formatPercent(pos.profitRate)}</Badge>
                    </div>
                  </div>
                  <div>
                    {sellTarget === pos.id ? (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min={1}
                            max={pos.quantity}
                            value={sellQty}
                            onChange={(e) => { setSellQty(e.target.value); setSellStep('input') }}
                            className="h-9 text-sm"
                          />
                          <Button variant="outline" size="sm" onClick={() => setSellQty(String(pos.quantity))}>
                            전량
                          </Button>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant={sellStep === 'confirm' ? 'danger' : 'default'}
                            size="sm"
                            disabled={sellLoading}
                            onClick={() => handleSell(pos)}
                          >
                            {sellStep === 'confirm' ? '확인' : '매도'}
                          </Button>
                          <Button variant="outline" size="sm" onClick={closeSellPanel}>
                            취소
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => openSellPanel(pos.id, pos.quantity)}>
                        매도
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden md:block">
              <Table className="table-fixed [&_th]:px-2 [&_td]:px-2">
                <colgroup>
                  <col className="w-44" /> {/* 종목 */}
                  <col className="w-16" /> {/* 시장 */}
                  <col className="w-16" /> {/* 수량 */}
                  <col className="w-24" /> {/* 평균가 */}
                  <col className="w-24" /> {/* 현재가 */}
                  <col className="w-28" /> {/* 투자금 */}
                  <col className="w-24" /> {/* 손익 */}
                  <col className="w-20" /> {/* 수익률 */}
                  <col className="w-28" /> {/* 매도 */}
                </colgroup>
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
                      <TableCell className="align-top min-w-0">
                        <div className="font-medium truncate">{pos.stockName}</div>
                        <div className="text-xs text-muted-foreground truncate">{pos.stockCode}</div>
                      </TableCell>
                      <TableCell className="align-top">
                        <Badge variant={pos.market === 'DOMESTIC' ? 'default' : 'info'}>
                          {pos.exchangeCode ? (EXCHANGE_LABELS[pos.exchangeCode] ?? pos.exchangeCode) : (pos.market === 'DOMESTIC' ? '한국' : '해외')}
                        </Badge>
                      </TableCell>
                      <TableCell className="align-top text-right whitespace-nowrap">{formatNumber(pos.quantity)}</TableCell>
                      <TableCell className="align-top text-right whitespace-nowrap">{formatCurrency(pos.avgPrice, pos.market)}</TableCell>
                      <TableCell className="align-top text-right whitespace-nowrap">{formatCurrency(pos.currentPrice, pos.market)}</TableCell>
                      <TableCell className="align-top text-right whitespace-nowrap">{formatCurrency(pos.totalInvested, pos.market)}</TableCell>
                      <TableCell className={`align-top text-right font-medium whitespace-nowrap ${pos.profitLoss >= 0 ? 'text-success' : 'text-danger'}`}>
                        {formatCurrency(pos.profitLoss, pos.market)}
                      </TableCell>
                      <TableCell className="align-top text-right whitespace-nowrap">
                        <Badge variant={pos.profitRate >= 0 ? 'success' : 'danger'}>{formatPercent(pos.profitRate)}</Badge>
                      </TableCell>
                      <TableCell className="align-top text-center">
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
            </div>
          </>
        )}
        </CardContent>
      ) : null}
    </Card>
  )
}

// ── 매매 기록 ──

function TradesCard({ market, countryFilter }: { market: Market | null; countryFilter: string | null }) {
  const isMobile = useIsMobile()
  const [sideFilter, setSideFilter] = useState<Side | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const today = formatDateInputInTimeZone(new Date())
  const weekAgo = formatDateInputInTimeZone(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
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
  const [cancelTradeOrder, { loading: cancelLoading }] = useCancelTradeOrderMutation()
  const allTrades = data?.trades ?? []
  const trades = filterByCountry(allTrades, countryFilter)

  const handleCancelTrade = async (tradeId: string) => {
    if (!window.confirm('이 미체결 주문을 취소할까요?')) {
      return
    }

    try {
      const { data: result } = await cancelTradeOrder({
        variables: {
          input: {
            tradeRecordId: tradeId,
          },
        },
        refetchQueries: [GetTradesDocument],
        awaitRefetchQueries: true,
      })

      if (result?.cancelTradeOrder.success) {
        alert(result.cancelTradeOrder.message || '주문 취소 요청을 접수했습니다.')
        return
      }

      alert(result?.cancelTradeOrder.message || '주문 취소 실패')
    } catch (e: any) {
      alert(`주문 취소 실패: ${e.message}`)
    }
  }

  useEffect(() => {
    setCollapsed(isMobile)
  }, [isMobile])

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <CardTitle>매매 기록</CardTitle>
              {isMobile ? (
                <SectionToggleButton
                  collapsed={collapsed}
                  onClick={() => setCollapsed((prev) => !prev)}
                  label="매매 기록"
                />
              ) : null}
            </div>
            {!collapsed ? (
              <div className="flex gap-2 flex-wrap">
                {([null, 'BUY', 'SELL'] as const).map((s) => (
                  <Button key={s ?? 'all'} variant={sideFilter === s ? 'default' : 'outline'} size="sm" onClick={() => { setSideFilter(s); setPage(0) }}>
                    {s === null ? '전체' : s === 'BUY' ? '매수' : '매도'}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
          {!collapsed ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(0) }}
                className="w-full sm:w-40"
              />
              <span className="text-sm text-muted-foreground">~</span>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(0) }}
                className="w-full sm:w-40"
              />
              {(dateFrom || dateTo) ? (
                <Button variant="outline" size="sm" onClick={() => { setDateFrom(weekAgo); setDateTo(today); setPage(0) }}>
                  초기화
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </CardHeader>
      {!collapsed ? (
        <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-8">로딩중...</p>
        ) : trades.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">매매 기록이 없습니다</p>
        ) : (
          <>
            <div className="space-y-3 md:hidden">
              {trades.map((trade) => {
                const info = getTradeRecordDisplayInfo(trade)
                return (
                  <div
                    key={trade.id}
                    className={`rounded-lg border border-border p-4 space-y-3 ${trade.status === 'FAILED' ? 'bg-red-50/60' : trade.status === 'PARTIAL' ? 'bg-amber-50/40' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{trade.stockName}</div>
                        <div className="text-xs text-muted-foreground">{trade.stockCode}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{formatDate(trade.createdAt)}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge variant={trade.side === 'BUY' ? 'danger' : 'info'}>
                          {trade.side === 'BUY' ? '매수' : '매도'}
                        </Badge>
                        <Badge variant={info.variant}>{info.label}</Badge>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <MetricItem label="수량" value={formatNumber(trade.quantity)} />
                      <MetricItem label="가격" value={formatCurrency(trade.executedPrice ?? trade.price, trade.market)} />
                      <MetricItem label="전략" value={trade.strategyName ?? '-'} />
                      <MetricItem label="상세" value={info.detail ?? '-'} />
                    </div>
                    <div className="text-xs text-muted-foreground">{trade.reason ?? '-'}</div>
                    {canCancelTrade(trade) ? (
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={cancelLoading}
                          onClick={() => handleCancelTrade(trade.id)}
                        >
                          주문 취소
                        </Button>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
            <div className="hidden md:block">
              <Table className="table-fixed [&_th]:px-2 [&_td]:px-2">
                <colgroup>
                  <col className="w-36" /> {/* 일시 */}
                  <col className="w-32" /> {/* 종목 */}
                  <col className="w-16" /> {/* 구분 */}
                  <col className="w-16" /> {/* 수량 */}
                  <col className="w-24" /> {/* 가격 */}
                  <col className="w-24" /> {/* 주문 상태 */}
                  <col className="w-28" /> {/* 상세 */}
                  <col className="w-24" /> {/* 전략 */}
                  <col />                  {/* 사유 (남는 공간) */}
                  <col className="w-16" /> {/* 액션 */}
                </colgroup>
                <TableHeader>
                  <TableRow className="border-b border-border">
                    <TableHead>일시</TableHead>
                    <TableHead>종목</TableHead>
                    <TableHead>구분</TableHead>
                    <TableHead className="text-right">수량</TableHead>
                    <TableHead className="text-right">가격</TableHead>
                    <TableHead className="text-center">주문 상태</TableHead>
                    <TableHead>상세</TableHead>
                    <TableHead>전략</TableHead>
                    <TableHead>사유</TableHead>
                    <TableHead className="text-center">액션</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trades.map((trade) => {
                    const info = getTradeRecordDisplayInfo(trade)

                    return (
                      <TableRow
                        key={trade.id}
                        className={trade.status === 'FAILED' ? 'bg-red-50/60' : trade.status === 'PARTIAL' ? 'bg-amber-50/40' : undefined}
                      >
                        <TableCell className="align-top py-2 text-xs whitespace-nowrap">{formatDate(trade.createdAt)}</TableCell>
                        <TableCell className="align-top py-2 min-w-0">
                          <div className="font-medium truncate">{trade.stockName}</div>
                          <div className="text-xs text-muted-foreground truncate">{trade.stockCode}</div>
                        </TableCell>
                        <TableCell className="align-top py-2">
                          <Badge variant={trade.side === 'BUY' ? 'danger' : 'info'}>
                            {trade.side === 'BUY' ? '매수' : '매도'}
                          </Badge>
                        </TableCell>
                        <TableCell className="align-top py-2 text-right whitespace-nowrap">
                          <div>{formatNumber(trade.quantity)}</div>
                          {(trade.executedQty ?? 0) > 0 && (trade.executedQty ?? 0) !== trade.quantity ? (
                            <div className="text-xs text-muted-foreground">체결 {formatNumber(trade.executedQty ?? 0)}</div>
                          ) : null}
                        </TableCell>
                        <TableCell className="align-top py-2 text-right whitespace-nowrap">
                          {formatCurrency(trade.executedPrice ?? trade.price, trade.market)}
                        </TableCell>
                        <TableCell className="align-top py-2 text-center">
                          <div className="flex justify-center">
                            <Badge variant={info.variant} className="whitespace-nowrap">
                              {info.label}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="align-top py-2 text-xs text-muted-foreground break-words">
                          {info.detail ?? '-'}
                        </TableCell>
                        <TableCell className="align-top py-2 text-xs text-muted-foreground truncate">{trade.strategyName ?? '-'}</TableCell>
                        <TableCell className="align-top py-2 text-xs text-muted-foreground min-w-0 border-l border-border/30 pl-3">
                          <div className="line-clamp-3 break-words" title={trade.reason ?? undefined}>{trade.reason ?? '-'}</div>
                        </TableCell>
                        <TableCell className="align-top py-2 text-center">
                          {canCancelTrade(trade) ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={cancelLoading}
                              onClick={() => handleCancelTrade(trade.id)}
                            >
                              취소
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
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
      ) : null}
    </Card>
  )
}

function MetricItem({
  label,
  value,
  valueClassName,
}: {
  label: string
  value: string
  valueClassName?: string
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={valueClassName}>{value}</div>
    </div>
  )
}
