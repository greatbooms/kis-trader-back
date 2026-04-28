import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { X } from 'lucide-react'
import {
  useCreateSimulationMutation,
  GetSimulationSessionsDocument,
  type Market,
} from '@/graphql/generated'
import { getMutationErrorMessage } from '@/lib/apollo-utils'
import type { AddToSimulationModalProps } from './types'

// ── 추천 종목 → 시뮬레이션 추가 모달 ──

export function AddToSimulationModal({
  rec,
  strategyName,
  strategyDisplayName,
  onClose,
}: AddToSimulationModalProps) {
  const defaultName = `${rec.stockName} × ${strategyDisplayName}`
  const [name, setName] = useState(defaultName)
  const [investmentAmount, setInvestmentAmount] = useState('')
  const [error, setError] = useState('')

  const [createMutation, { loading }] = useCreateSimulationMutation({
    refetchQueries: [GetSimulationSessionsDocument],
  })

  const handleCreate = async () => {
    const missing: string[] = []
    if (!name.trim()) missing.push('이름')
    if (!investmentAmount || Number(investmentAmount) <= 0) missing.push('투자금')

    if (missing.length > 0) {
      setError(`${missing.join(', ')}을(를) 입력해주세요`)
      return
    }

    setError('')

    try {
      await createMutation({
        variables: {
          input: {
            name: name.trim(),
            market: rec.market as Market,
            exchangeCode: rec.exchangeCode,
            stockCode: rec.stockCode,
            stockName: rec.stockName,
            strategyName,
            quota: Number(investmentAmount),
          },
        },
      })
      onClose()
    } catch (e: unknown) {
      setError(getMutationErrorMessage(e, '생성 중 오류가 발생했습니다'))
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative bg-card border border-border rounded-xl shadow-lg w-full max-w-md mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-foreground">{rec.stockName} × {strategyDisplayName}</h3>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted text-muted-foreground cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">이름</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">투자금</label>
            <Input
              type="number"
              value={investmentAmount}
              onChange={(e) => setInvestmentAmount(e.target.value)}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            손절률 등 상세 설정은 시뮬레이션 페이지에서 변경할 수 있습니다.
          </p>

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>취소</Button>
            <Button onClick={handleCreate} disabled={loading}>
              {loading ? '생성중...' : '생성'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
