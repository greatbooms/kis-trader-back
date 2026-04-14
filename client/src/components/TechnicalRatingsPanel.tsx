import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tooltip } from '@/components/ui/tooltip'
import { Info } from 'lucide-react'
import {
  technicalActionClass,
  technicalActionLabel,
  TECHNICAL_INDICATOR_TOOLTIPS,
  technicalRecommendationLabel,
  technicalRecommendationVariant,
} from '@/lib/technical-ratings'
import type { TechnicalRatingsPanelProps } from '@/components/types'

function formatIndicatorValue(value?: number | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '-'
  return value.toFixed(2)
}

export function TechnicalRatingsPanel({
  ratings,
  title = '기술 요약',
  compact = false,
}: TechnicalRatingsPanelProps) {
  if (!ratings) return null

  const containerClass = compact
    ? 'rounded-xl border border-border bg-muted/20 p-4 space-y-4'
    : ''

  const content = (
    <div className={containerClass}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground mt-1">
            1일봉 기준 TradingView 스타일 기술 평점입니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SummaryBadge label="종합" summary={ratings.overallSummary} />
          <SummaryBadge label="오실레이터" summary={ratings.oscillatorSummary} />
          <SummaryBadge label="무빙 애버리지" summary={ratings.movingAverageSummary} />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <IndicatorTable title="오실레이터" items={ratings.oscillators} />
        <IndicatorTable title="무빙 애버리지" items={ratings.movingAverages} />
      </div>
    </div>
  )

  if (compact) return content

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  )
}

function SummaryBadge({
  label,
  summary,
}: {
  label: string
  summary: NonNullable<TechnicalRatingsPanelProps['ratings']>['overallSummary']
}) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2 min-w-[120px]">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <Badge variant={technicalRecommendationVariant(summary.recommendation)} className="text-[10px]">
          {technicalRecommendationLabel(summary.recommendation)}
        </Badge>
        <span className="text-sm font-semibold">{summary.score.toFixed(2)}</span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        매수 {summary.buyCount} · 중립 {summary.neutralCount} · 매도 {summary.sellCount}
      </p>
    </div>
  )
}

function IndicatorTable({
  title,
  items,
}: {
  title: string
  items: NonNullable<TechnicalRatingsPanelProps['ratings']>['oscillators']
}) {
  return (
    <div className="rounded-xl border border-border bg-background overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <p className="text-sm font-medium">{title}</p>
      </div>
      <div className="divide-y divide-border">
        {items.map((item) => (
          <div key={item.key} className="grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-3 text-sm items-center">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="truncate">{item.label}</span>
              <Tooltip text={TECHNICAL_INDICATOR_TOOLTIPS[item.key] ?? '기술적 분석에 쓰이는 보조지표입니다.'}>
                <Info className="h-3 w-3 text-muted-foreground/60 cursor-help shrink-0" />
              </Tooltip>
            </div>
            <span className="font-medium tabular-nums">{formatIndicatorValue(item.value)}</span>
            <span className={`text-xs font-medium ${technicalActionClass(item.action)}`}>
              {technicalActionLabel(item.action)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
