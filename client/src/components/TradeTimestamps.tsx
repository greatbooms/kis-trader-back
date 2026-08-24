import { formatDate } from '@/lib/utils'

/**
 * 주문 제출 시각과 체결 확인 시각을 함께 표기한다.
 * LOC/MOC 주문은 제출 후 장 마감에 체결되어 두 시각이 수 시간 벌어지므로 구분해서 보여준다.
 * 체결 시각은 브로커 체결 시각이 아니라 동기화가 체결을 관측한 시각(10~15초 오차)이다.
 */
export function TradeTimestamps({
  createdAt,
  executedAt,
}: {
  createdAt: string | Date
  executedAt?: string | Date | null
}) {
  return (
    <div className="space-y-0.5 text-xs whitespace-nowrap">
      <div className="text-muted-foreground">제출 {formatDate(createdAt)}</div>
      {executedAt ? (
        <div className="font-medium">체결 {formatDate(executedAt)}</div>
      ) : null}
    </div>
  )
}
