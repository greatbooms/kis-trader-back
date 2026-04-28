import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { ChevronDown, Info } from 'lucide-react'

// ── 포트폴리오 섹션 공용 작은 컴포넌트들 ──

export function SectionToggleButton({
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

export function SummaryMetricCard({
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

export function MetricItem({
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
