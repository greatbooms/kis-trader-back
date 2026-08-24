import { useState } from 'react'
import { X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatCurrency, formatDate, formatNumber } from '@/lib/utils'
import { brokerLabel } from '@/lib/market-constants'
import type {
  BrokerOrderRecoveryCandidate,
  BrokerOrderRecoveryDialogMode,
  UnknownOrderReconciliationDialogProps,
} from './types'

const TITLES: Record<BrokerOrderRecoveryDialogMode, string> = {
  ASSIGN_CONTEXT: '현재 증권사 계좌 연결',
  CANDIDATES: '증권사 주문 후보 확인',
  LINK_CANDIDATE: '이 주문 연결',
  MATCH_EXISTING: '기존 기록과 동일 주문으로 확정',
  NOT_SUBMITTED: '미주문 확정',
  CANCELLATION_RESULT: '취소 상태 확인 결과',
  CANCELLATION_NOT_ACCEPTED: '취소 미접수 확정',
}

const CONFIRM_LABELS: Partial<Record<BrokerOrderRecoveryDialogMode, string>> = {
  ASSIGN_CONTEXT: '이 계좌 정보 연결',
  LINK_CANDIDATE: '주문 연결',
  MATCH_EXISTING: '기존 기록과 동일로 확정',
  NOT_SUBMITTED: '미주문으로 확정',
  CANCELLATION_NOT_ACCEPTED: '취소 미접수로 확정',
}

export function UnknownOrderReconciliationDialog({
  state,
  loading,
  error,
  onClose,
  onConfirm,
  onSelectCandidate,
  onRequestNotSubmitted,
  onRequestCancellationNotAccepted,
}: UnknownOrderReconciliationDialogProps) {
  const [acknowledged, setAcknowledged] = useState(false)
  const { item, mode, candidate } = state
  const confirmationLabel = CONFIRM_LABELS[mode]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={loading ? undefined : onClose}
      />
      <div className="relative mx-4 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-4 shadow-lg sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-foreground">{TITLES[mode]}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              TradeRecord {item.tradeRecordId}
            </p>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={onClose}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="닫기"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4">
          <RecoveryIntent item={item} />

          {mode === 'ASSIGN_CONTEXT' ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-medium">이 기록에는 주문 당시 broker 계좌 정보가 없습니다.</p>
              <p className="mt-2">
                증권사: <strong>{state.contextPreview?.broker ? brokerLabel(state.contextPreview.broker) : '-'}</strong>
                {' · '}현재 환경: <strong>{state.contextPreview?.environment ?? '-'}</strong>
                {' · '}계좌: <strong>{state.contextPreview?.maskedAccount ?? '-'}</strong>
              </p>
              <p className="mt-2 text-xs">
                주문 당시 사용한 계좌와 동일한지 확인한 뒤 연결하세요. 계좌 hash나 원문 계좌번호는 저장 화면에 노출되지 않습니다.
              </p>
            </div>
          ) : null}

          {mode === 'CANDIDATES' ? (
            <CandidateList
              candidates={state.candidates ?? []}
              onSelect={onSelectCandidate}
              onRequestNotSubmitted={onRequestNotSubmitted}
            />
          ) : null}

          {mode === 'LINK_CANDIDATE' && candidate ? (
            <CandidateIdentity candidate={candidate}>
              이 증권사 주문을 현재 불명 주문 기록에 연결합니다. 연결 후 일반 주문 동기화가 체결 상태를 확정합니다.
            </CandidateIdentity>
          ) : null}

          {mode === 'MATCH_EXISTING' && candidate ? (
            <CandidateIdentity candidate={candidate}>
              이 증권사 주문은 기존 TradeRecord <strong>{candidate.existingTradeRecordId}</strong>와
              동일한 주문으로 표시됩니다. 현재 불명 기록에는 주문번호를 연결하지 않고 FAILED로 종료합니다.
            </CandidateIdentity>
          ) : null}

          {mode === 'NOT_SUBMITTED' ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
              완전한 증권사 주문 이력을 다시 조회해 후보가 0건일 때만 처리됩니다. 후보가 새로 발견되면 서버가 확정을 거부합니다.
            </div>
          ) : null}

          {mode === 'CANCELLATION_RESULT' ? (
            <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm">
              {item.cancellationStatus === 'UNKNOWN' ? (
                <>
                  <p className="font-medium text-amber-700">원주문이 아직 미체결 목록에 있습니다.</p>
                  <p className="mt-2 text-muted-foreground">
                    취소 요청이 접수되지 않았다고 확정하려면 증권사 앱의 미체결 주문을 다시 확인하세요.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-4"
                    onClick={onRequestCancellationNotAccepted}
                  >
                    취소 미접수 확정
                  </Button>
                </>
              ) : (
                <>
                  <p className="font-medium text-emerald-700">취소 불명 상태가 해소되었습니다.</p>
                  <p className="mt-2 text-muted-foreground">
                    주문 상태 {item.status} · 취소 상태 {item.cancellationStatus ?? '-'}
                  </p>
                </>
              )}
            </div>
          ) : null}

          {mode === 'CANCELLATION_NOT_ACCEPTED' ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
              서버가 체결 이력과 미체결 목록을 다시 완전 조회합니다. 원주문이 여전히 열려 있을 때만 취소 미접수로 확정합니다.
            </div>
          ) : null}

          {confirmationLabel ? (
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                증권사 주문/미체결 이력과 표시된 TradeRecord 정보를 확인했으며, 이 작업이 주문을 다시 제출하지 않는 복구 처리임을 이해했습니다.
              </span>
            </label>
          ) : null}

          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={loading} onClick={onClose}>
            닫기
          </Button>
          {confirmationLabel ? (
            <Button
              type="button"
              disabled={loading || !acknowledged}
              onClick={() => void onConfirm()}
            >
              {loading ? '처리중...' : confirmationLabel}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function RecoveryIntent({ item }: { item: UnknownOrderReconciliationDialogProps['state']['item'] }) {
  const startedAt = item.lifecycle === 'CANCELLATION'
    ? item.cancellationStartedAt
    : item.submissionStartedAt
  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg border border-border p-4 text-sm sm:grid-cols-4">
      <div>
        <div className="text-xs text-muted-foreground">종목</div>
        <div className="font-medium">{item.stockName} ({item.stockCode})</div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">의도</div>
        <div className="font-medium">{item.side} {formatNumber(item.quantity)}주</div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">주문 가격</div>
        <div className="font-medium">{formatCurrency(item.price, item.market, item.exchangeCode)}</div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">시작 시각</div>
        <div className="font-medium">{startedAt ? formatDate(startedAt) : '-'}</div>
      </div>
      <div className="col-span-2 sm:col-span-4">
        <Badge variant="danger">주문 또는 취소를 다시 제출하지 마세요</Badge>
      </div>
    </div>
  )
}

function CandidateList({
  candidates,
  onSelect,
  onRequestNotSubmitted,
}: {
  candidates: BrokerOrderRecoveryCandidate[]
  onSelect: (candidate: BrokerOrderRecoveryCandidate) => void
  onRequestNotSubmitted: () => void
}) {
  if (candidates.length === 0) {
    return (
      <div className="rounded-lg border border-border p-4 text-sm">
        <p className="font-medium">일치하는 증권사 주문 후보가 없습니다.</p>
        <p className="mt-1 text-muted-foreground">확정 시점에 서버가 전체 이력을 다시 조회합니다.</p>
        <Button type="button" variant="outline" className="mt-4" onClick={onRequestNotSubmitted}>
          미주문 확정으로 이동
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {candidates.map((candidate) => (
        <div
          key={`${candidate.orderDate}:${candidate.exchangeCode}:${candidate.orderNo}`}
          className="rounded-lg border border-border p-4"
        >
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div className="text-sm">
              <div className="font-medium">
                {candidate.orderDate} · {candidate.exchangeCode} · #{candidate.orderNo}
              </div>
              <div className="mt-1 text-muted-foreground">
                {candidate.orderTime} · {candidate.side} {formatNumber(candidate.orderQuantity)}주 · 체결 {formatNumber(candidate.filledQuantity)}주
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant={candidate.rejectionState === 'REJECTED' ? 'danger' : 'outline'}>
                  거절 상태 {candidate.rejectionState}
                </Badge>
                {candidate.existingTradeRecordId ? (
                  <Badge variant="warning">기존 기록 {candidate.existingTradeRecordId}</Badge>
                ) : null}
              </div>
            </div>
            <Button type="button" variant="outline" onClick={() => onSelect(candidate)}>
              {candidate.existingTradeRecordId ? '기존 기록과 동일' : '이 주문 연결'}
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}

function CandidateIdentity({
  candidate,
  children,
}: {
  candidate: BrokerOrderRecoveryCandidate
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-border p-4 text-sm">
      <p className="font-medium">
        {candidate.orderDate} · {candidate.exchangeCode} · #{candidate.orderNo}
      </p>
      <p className="mt-2 text-muted-foreground">{children}</p>
    </div>
  )
}
