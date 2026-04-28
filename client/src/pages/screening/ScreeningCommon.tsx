import type { ReactNode } from 'react'
import { Tooltip } from '@/components/ui/tooltip'
import { Info } from 'lucide-react'
import { formatNumber } from '@/lib/utils'
import { INDICATOR_TOOLTIPS } from './screening-helpers'

// ── 스크리닝 페이지 공용 작은 UI 컴포넌트들 ──

export function ScoreBar({ icon, label, score, max, tooltip }: { icon: ReactNode; label: string; score: number; max: number; tooltip?: string }) {
  const pct = Math.min((score / max) * 100, 100)
  const color = pct >= 70 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-400'

  return (
    <div>
      <div className="flex items-center gap-1 mb-1">
        {icon}
        <span className="text-xs text-muted-foreground">{label}</span>
        {tooltip && (
          <Tooltip text={tooltip}>
            <Info className="h-3 w-3 text-muted-foreground/60 cursor-help" />
          </Tooltip>
        )}
        <span className="text-xs font-medium ml-auto">{score.toFixed(0)}/{max}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function MetricLabel({ label, tooltip }: { label: string; tooltip?: string }) {
  return (
    <span className="flex items-center gap-1 text-muted-foreground">
      <span className="text-sm">{label}</span>
      {tooltip && (
        <Tooltip text={tooltip}>
          <Info className="h-3 w-3 text-muted-foreground/60 cursor-help" />
        </Tooltip>
      )}
    </span>
  )
}

export function InfoCell({ label, value, danger, success, tooltip }: { label: string; value: string; danger?: boolean; success?: boolean; tooltip?: string }) {
  return (
    <div>
      <MetricLabel label={label} tooltip={tooltip} />
      <p className={`font-medium ${danger ? 'text-danger' : success ? 'text-success' : ''}`}>{value}</p>
    </div>
  )
}

export function DeepCard({ icon, title, lines, tooltip }: { icon: ReactNode; title: string; lines: string[]; tooltip?: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center gap-2 text-sm font-medium mb-2">
        {icon}
        <span>{title}</span>
        {tooltip && (
          <Tooltip text={tooltip}>
            <Info className="h-3 w-3 text-muted-foreground/60 cursor-help" />
          </Tooltip>
        )}
      </div>
      <div className="space-y-1 text-sm text-muted-foreground">
        {lines.map((line) => <p key={line}>{line}</p>)}
      </div>
    </div>
  )
}

export function DetailPanel({ title, rows, tooltip }: { title: string; rows: string[]; tooltip?: string }) {
  return (
    <div className="rounded-lg bg-muted/30 px-3 py-3">
      <div className="mb-2 text-xs font-medium">
        <MetricLabel label={title} tooltip={tooltip} />
      </div>
      <div className="space-y-1">
        {rows.map((row) => <p key={row}>{row}</p>)}
      </div>
    </div>
  )
}

export function renderIndicator(label: string, value: unknown, numberFormat = false, suffix = '') {
  if (value === undefined || value === null) return null
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) return null
  const display = numberFormat ? formatNumber(numericValue) : `${numericValue.toFixed(1)}${suffix}`
  return (
    <div key={label} className="rounded-lg bg-muted/50 px-3 py-1.5">
      <div className="text-xs font-medium">
        <MetricLabel label={label} tooltip={INDICATOR_TOOLTIPS[label]} />
      </div>
      <p className="font-medium">{display}</p>
    </div>
  )
}
