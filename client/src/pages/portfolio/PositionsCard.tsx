import { useEffect, useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import {
  useGetPositionsQuery,
  useManualSellMutation,
} from '@/graphql/generated'
import { formatCurrency, formatPercent, formatNumber } from '@/lib/utils'
import { EXCHANGE_LABELS, filterByCountry } from '@/lib/market-constants'
import { useIsMobile } from './portfolio-helpers'
import { SectionToggleButton, MetricItem } from './PortfolioCommon'
import type { PortfolioCardScopeProps } from './types'

// ── 보유 포지션 테이블 + 매도 패널 ──

export function PositionsCard({ market, countryFilter }: PortfolioCardScopeProps) {
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
    } catch (e: unknown) {
      alert(`매도 실패: ${e instanceof Error ? e.message : String(e)}`)
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
