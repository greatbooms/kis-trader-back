import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  useAssignCurrentBrokerContextMutation,
  useConfirmBrokerOrderMatchesExistingMutation,
  useConfirmBrokerOrderNotSubmittedMutation,
  useConfirmCancellationNotAcceptedMutation,
  useGetBrokerOrderRecoveryItemsQuery,
  useGetCurrentBrokerContextPreviewLazyQuery,
  useInspectBrokerOrderCandidatesMutation,
  useInspectUnknownCancellationMutation,
  useLinkBrokerOrderCandidateMutation,
} from '@/graphql/generated'
import { getMutationErrorMessage } from '@/lib/apollo-utils'
import { brokerLabel } from '@/lib/market-constants'
import { formatCurrency, formatDate, formatNumber } from '@/lib/utils'
import { UnknownOrderReconciliationDialog } from './UnknownOrderReconciliationDialog'
import type {
  BrokerOrderRecoveryCandidate,
  BrokerOrderRecoveryDialogState,
  BrokerOrderRecoveryItem,
} from './types'

const STATE_REFETCHES = [
  'GetBrokerOrderRecoveryItems',
  'GetTrades',
]

export function UnknownOrderReconciliationCard() {
  const [dialog, setDialog] = useState<BrokerOrderRecoveryDialogState | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const { data, loading, error } = useGetBrokerOrderRecoveryItemsQuery({
    pollInterval: 15_000,
    fetchPolicy: 'network-only',
  })
  const [getContextPreview, { loading: previewLoading }] =
    useGetCurrentBrokerContextPreviewLazyQuery({ fetchPolicy: 'network-only' })
  const [inspectCandidates, { loading: inspectLoading }] =
    useInspectBrokerOrderCandidatesMutation()
  const [assignContext, { loading: assignLoading }] =
    useAssignCurrentBrokerContextMutation()
  const [linkCandidate, { loading: linkLoading }] =
    useLinkBrokerOrderCandidateMutation()
  const [confirmNotSubmitted, { loading: notSubmittedLoading }] =
    useConfirmBrokerOrderNotSubmittedMutation()
  const [confirmMatchesExisting, { loading: matchExistingLoading }] =
    useConfirmBrokerOrderMatchesExistingMutation()
  const [inspectCancellation, { loading: cancellationInspectLoading }] =
    useInspectUnknownCancellationMutation()
  const [confirmCancellationNotAccepted, { loading: cancellationConfirmLoading }] =
    useConfirmCancellationNotAcceptedMutation()

  const items = data?.brokerOrderRecoveryItems ?? []
  const actionLoading = previewLoading
    || inspectLoading
    || assignLoading
    || linkLoading
    || notSubmittedLoading
    || matchExistingLoading
    || cancellationInspectLoading
    || cancellationConfirmLoading

  if (!dialog && !loading && !error && items.length === 0) return null

  const run = async (operation: () => Promise<void>, fallback: string) => {
    setActionError(null)
    try {
      await operation()
    } catch (operationError) {
      setActionError(getMutationErrorMessage(operationError, fallback))
    }
  }

  const openItem = async (item: BrokerOrderRecoveryItem) => {
    if (!item.brokerContextAssigned) {
      await run(async () => {
        const result = await getContextPreview({ variables: { broker: item.broker } })
        const contextPreview = result.data?.currentBrokerContextPreview
        if (!contextPreview) throw new Error(`현재 ${brokerLabel(item.broker)} 계좌 정보를 확인할 수 없습니다.`)
        setDialog({ mode: 'ASSIGN_CONTEXT', item, contextPreview })
      }, `현재 ${brokerLabel(item.broker)} 계좌 정보를 확인하지 못했습니다.`)
      return
    }

    if (item.lifecycle === 'CANCELLATION') {
      await run(async () => {
        const result = await inspectCancellation({
          variables: { input: { tradeRecordId: item.tradeRecordId } },
          refetchQueries: STATE_REFETCHES,
          awaitRefetchQueries: true,
        })
        const inspected = result.data?.inspectUnknownCancellation
        if (!inspected) throw new Error('취소 상태 조회 결과가 없습니다.')
        setDialog({ mode: 'CANCELLATION_RESULT', item: inspected })
      }, '취소 상태를 확인하지 못했습니다.')
      return
    }

    await run(async () => {
      const result = await inspectCandidates({
        variables: { input: { tradeRecordId: item.tradeRecordId } },
        refetchQueries: STATE_REFETCHES,
        awaitRefetchQueries: true,
      })
      const inspection = result.data?.inspectBrokerOrderCandidates
      if (!inspection) throw new Error(`${brokerLabel(item.broker)} 주문 후보 조회 결과가 없습니다.`)
      setDialog({
        mode: 'CANDIDATES',
        item: inspection.recoveryItem,
        candidates: inspection.candidates,
      })
    }, `${brokerLabel(item.broker)} 주문 후보를 확인하지 못했습니다.`)
  }

  const selectCandidate = (candidate: BrokerOrderRecoveryCandidate) => {
    if (!dialog) return
    setActionError(null)
    setDialog({
      mode: candidate.existingTradeRecordId ? 'MATCH_EXISTING' : 'LINK_CANDIDATE',
      item: dialog.item,
      candidate,
    })
  }

  const closeAfterStateChange = () => {
    setDialog(null)
    setActionError(null)
  }

  const confirmDialog = async () => {
    if (!dialog) return
    await run(async () => {
      switch (dialog.mode) {
        case 'ASSIGN_CONTEXT':
          if (!dialog.contextPreview) {
            throw new Error('확인한 증권사 계좌 정보가 없습니다.')
          }
          await assignContext({
            variables: {
              input: {
                tradeRecordId: dialog.item.tradeRecordId,
                contextToken: dialog.contextPreview.contextToken,
              },
            },
            refetchQueries: STATE_REFETCHES,
            awaitRefetchQueries: true,
          })
          closeAfterStateChange()
          return
        case 'LINK_CANDIDATE': {
          const candidate = requireCandidate(dialog.candidate)
          await linkCandidate({
            variables: {
              input: {
                tradeRecordId: dialog.item.tradeRecordId,
                brokerOrderDate: candidate.orderDate,
                exchangeCode: candidate.exchangeCode,
                orderNo: candidate.orderNo,
              },
            },
            refetchQueries: STATE_REFETCHES,
            awaitRefetchQueries: true,
          })
          closeAfterStateChange()
          return
        }
        case 'MATCH_EXISTING': {
          const candidate = requireCandidate(dialog.candidate)
          if (!candidate.existingTradeRecordId) {
            throw new Error('기존 TradeRecord 식별자가 없습니다.')
          }
          await confirmMatchesExisting({
            variables: {
              input: {
                tradeRecordId: dialog.item.tradeRecordId,
                brokerOrderDate: candidate.orderDate,
                exchangeCode: candidate.exchangeCode,
                orderNo: candidate.orderNo,
                existingTradeRecordId: candidate.existingTradeRecordId,
              },
            },
            refetchQueries: STATE_REFETCHES,
            awaitRefetchQueries: true,
          })
          closeAfterStateChange()
          return
        }
        case 'NOT_SUBMITTED':
          await confirmNotSubmitted({
            variables: { input: { tradeRecordId: dialog.item.tradeRecordId } },
            refetchQueries: STATE_REFETCHES,
            awaitRefetchQueries: true,
          })
          closeAfterStateChange()
          return
        case 'CANCELLATION_NOT_ACCEPTED':
          await confirmCancellationNotAccepted({
            variables: { input: { tradeRecordId: dialog.item.tradeRecordId } },
            refetchQueries: STATE_REFETCHES,
            awaitRefetchQueries: true,
          })
          closeAfterStateChange()
          return
        default:
          return
      }
    }, '복구 작업을 완료하지 못했습니다.')
  }

  return (
    <>
      <Card className="overflow-hidden border-amber-300 bg-amber-50/30">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <CardTitle>확인 필요 주문</CardTitle>
            {items.length > 0 ? <Badge variant="warning">{items.length}건</Badge> : null}
          </div>
          <p className="text-sm text-muted-foreground">
            증권사 응답이 불명확했던 주문입니다. 상태를 확인하기 전에는 같은 주문이나 취소를 다시 제출하지 마세요.
          </p>
        </CardHeader>
        <CardContent>
          {loading && items.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">목록 확인중...</p>
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              확인 필요 주문 목록을 불러오지 못했습니다: {error.message}
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => {
                const startedAt = item.lifecycle === 'CANCELLATION'
                  ? item.cancellationStartedAt
                  : item.submissionStartedAt
                return (
                  <div
                    key={item.tradeRecordId}
                    className="flex flex-col justify-between gap-4 rounded-lg border border-amber-200 bg-card p-4 lg:flex-row lg:items-center"
                  >
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="danger">
                          {item.lifecycle === 'CANCELLATION' ? '취소 결과 불명' : '주문 제출 결과 불명'}
                        </Badge>
                        <Badge variant="outline">{brokerLabel(item.broker)}</Badge>
                        <span className="font-medium">{item.stockName}</span>
                        <span className="text-xs text-muted-foreground">{item.stockCode} · {item.exchangeCode}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        <span>{item.side} {formatNumber(item.quantity)}주</span>
                        <span>{formatCurrency(item.price, item.market, item.exchangeCode)}</span>
                        <span>{startedAt ? formatDate(startedAt) : '시각 없음'}</span>
                        <span className="break-all">ID {item.tradeRecordId}</span>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={actionLoading}
                      onClick={() => void openItem(item)}
                    >
                      {!item.brokerContextAssigned
                        ? '현재 계좌 연결'
                        : item.lifecycle === 'CANCELLATION'
                          ? '취소 상태 조회'
                          : `${brokerLabel(item.broker)} 주문 조회`}
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
          {!dialog && actionError ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {actionError}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {dialog ? (
        <UnknownOrderReconciliationDialog
          key={`${dialog.item.tradeRecordId}:${dialog.mode}:${dialog.candidate?.orderNo ?? ''}`}
          state={dialog}
          loading={actionLoading}
          error={actionError}
          onClose={() => {
            if (!actionLoading) closeAfterStateChange()
          }}
          onConfirm={confirmDialog}
          onSelectCandidate={selectCandidate}
          onRequestNotSubmitted={() => {
            setActionError(null)
            setDialog({ mode: 'NOT_SUBMITTED', item: dialog.item })
          }}
          onRequestCancellationNotAccepted={() => {
            setActionError(null)
            setDialog({ mode: 'CANCELLATION_NOT_ACCEPTED', item: dialog.item })
          }}
        />
      ) : null}
    </>
  )
}

function requireCandidate(
  candidate?: BrokerOrderRecoveryCandidate,
): BrokerOrderRecoveryCandidate {
  if (!candidate) throw new Error('선택한 증권사 주문 후보가 없습니다.')
  return candidate
}
