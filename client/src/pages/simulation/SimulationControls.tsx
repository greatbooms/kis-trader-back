import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Pause, Play, Square, RotateCcw, Trash2 } from 'lucide-react'
import {
  useUpdateSimulationStatusMutation,
  useResetSimulationMutation,
  useDeleteSimulationMutation,
} from '@/graphql/generated'
import type { SimulationControlsProps } from '@/pages/simulation/types'

const statusConfig: Record<string, { label: string; variant: 'success' | 'warning' | 'info' | 'outline' }> = {
  RUNNING: { label: '실행중', variant: 'success' },
  PAUSED: { label: '일시정지', variant: 'warning' },
  COMPLETED: { label: '완료', variant: 'info' },
  CREATED: { label: '생성됨', variant: 'outline' },
}

const EXCHANGE_LABELS: Record<string, string> = {
  KRX: '한국',
  NASD: '미국(나스닥)', NYSE: '미국(뉴욕)', AMEX: '미국(아멕스)',
  SEHK: '홍콩', SHAA: '중국(상해)', SZAA: '중국(심천)',
  TKSE: '일본', HASE: '베트남(하노이)', VNSE: '베트남(호치민)',
}

export function SimulationControls({ sessionId, status, sessionName, strategyDisplayName, market, exchangeCodes, onBack, onStatusChange }: SimulationControlsProps) {
  const [updateStatus] = useUpdateSimulationStatusMutation()
  const [resetSimulation] = useResetSimulationMutation()
  const [deleteSimulation] = useDeleteSimulationMutation()

  const handleUpdateStatus = async (newStatus: string) => {
    await updateStatus({ variables: { id: sessionId, status: newStatus as never } })
    onStatusChange()
  }

  const handleReset = async () => {
    if (!confirm('시뮬레이션을 초기화하시겠습니까? 모든 거래 기록이 삭제됩니다.')) return
    await resetSimulation({ variables: { id: sessionId } })
    onStatusChange()
  }

  const handleDelete = async () => {
    if (!confirm('시뮬레이션을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return
    await deleteSimulation({ variables: { id: sessionId } })
    onBack()
  }

  const statusInfo = statusConfig[status] ?? { label: status, variant: 'outline' as const }

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft size={16} /> 목록으로
        </Button>
        <span className="text-lg font-semibold text-foreground">{sessionName}</span>
        <Badge variant={statusInfo.variant} className="text-sm px-3 py-1">
          {statusInfo.label}
        </Badge>
        <Badge className="text-sm px-3 py-1">{strategyDisplayName}</Badge>
        {exchangeCodes.length > 0 ? (
          exchangeCodes.map((code) => (
            <Badge key={code} variant="info" className="text-sm px-3 py-1">
              {EXCHANGE_LABELS[code] ?? code}
            </Badge>
          ))
        ) : (
          <Badge variant={market === 'DOMESTIC' ? 'default' : 'info'} className="text-sm px-3 py-1">
            {market === 'DOMESTIC' ? '국내' : '해외'}
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-2">
        {(status === 'CREATED' || status === 'PAUSED') && (
          <Button size="sm" onClick={() => handleUpdateStatus('RUNNING')}>
            <Play size={14} /> {status === 'CREATED' ? '시작' : '재개'}
          </Button>
        )}
        {status === 'RUNNING' && (
          <Button size="sm" variant="outline" onClick={() => handleUpdateStatus('PAUSED')}>
            <Pause size={14} /> 일시정지
          </Button>
        )}
        {(status === 'RUNNING' || status === 'PAUSED') && (
          <Button size="sm" variant="outline" onClick={() => handleUpdateStatus('COMPLETED')}>
            <Square size={14} /> 종료
          </Button>
        )}
        {status === 'COMPLETED' && (
          <Button size="sm" variant="outline" onClick={handleReset}>
            <RotateCcw size={14} /> 리셋
          </Button>
        )}
        <Button size="sm" variant="danger" onClick={handleDelete}>
          <Trash2 size={14} /> 삭제
        </Button>
      </div>
    </div>
  )
}
