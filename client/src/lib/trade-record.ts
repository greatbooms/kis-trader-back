import type { OrderStatus } from '@/graphql/generated'

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'outline' | 'default'

export interface TradeRecordDisplayInfo {
  label: string
  detail?: string
  variant: BadgeVariant
}

export interface TradeRecordLike {
  id?: string
  status: OrderStatus
  quantity: number
  executedQty?: number | null
  orderNo?: string | null
  reason?: string | null
}

export function canCancelTrade(trade: TradeRecordLike): boolean {
  return trade.status === 'PENDING' && !!trade.orderNo
}

export function getTradeRecordDisplayInfo(trade: TradeRecordLike): TradeRecordDisplayInfo {
  const executedQty = trade.executedQty ?? 0
  const remainingQty = Math.max(0, trade.quantity - executedQty)
  const reason = trade.reason ?? ''
  const cancelledRemainder = trade.status === 'PARTIAL'
    && !trade.orderNo
    && (reason.includes('잔량') || reason.includes('미체결 종료'))

  switch (trade.status) {
    case 'FILLED':
      return {
        label: '체결',
        detail: executedQty > 0 && executedQty < trade.quantity ? `${executedQty}/${trade.quantity}주` : undefined,
        variant: 'success',
      }
    case 'PARTIAL':
      return {
        label: cancelledRemainder ? '부분체결 완료' : '부분체결',
        detail: remainingQty > 0 && !cancelledRemainder
          ? `${executedQty}/${trade.quantity}주 체결, 잔량 ${remainingQty}주`
          : `${executedQty}/${trade.quantity}주 체결`,
        variant: 'warning',
      }
    case 'PENDING':
      return {
        label: '주문접수',
        detail: trade.orderNo ? `주문번호 ${trade.orderNo}` : undefined,
        variant: 'info',
      }
    case 'FAILED':
      return {
        label: reason.includes('브로커 거부') ? '브로커거부' : '실패',
        detail: undefined,
        variant: 'danger',
      }
    case 'CANCELLED':
      return {
        label: '취소',
        detail: executedQty > 0 ? `${executedQty}/${trade.quantity}주 체결 후 종료` : undefined,
        variant: 'outline',
      }
    case 'AWAITING_APPROVAL':
      return {
        label: '승인대기',
        variant: 'warning',
      }
    default:
      return {
        label: trade.status,
        variant: 'outline',
      }
  }
}
