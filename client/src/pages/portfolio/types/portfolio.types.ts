import type {
  GetBrokerOrderRecoveryItemsQuery,
  GetCurrentBrokerContextPreviewQuery,
  GetPositionsQuery,
  InspectBrokerOrderCandidatesMutation,
  Market,
} from '@/graphql/generated'

// ── 포트폴리오 페이지 도메인 타입 ──

export type PortfolioPosition = GetPositionsQuery['positions'][number]

export interface PortfolioCardScopeProps {
  market: Market | null
  countryFilter: string | null
}

export interface AccountSummaryCardProps {
  countryFilter: string | null
}

export type BrokerOrderRecoveryItem =
  GetBrokerOrderRecoveryItemsQuery['brokerOrderRecoveryItems'][number]

export type BrokerOrderRecoveryCandidate =
  InspectBrokerOrderCandidatesMutation['inspectBrokerOrderCandidates']['candidates'][number]

export type BrokerContextPreview =
  GetCurrentBrokerContextPreviewQuery['currentBrokerContextPreview']

export type BrokerOrderRecoveryDialogMode =
  | 'ASSIGN_CONTEXT'
  | 'CANDIDATES'
  | 'LINK_CANDIDATE'
  | 'MATCH_EXISTING'
  | 'NOT_SUBMITTED'
  | 'CANCELLATION_RESULT'
  | 'CANCELLATION_NOT_ACCEPTED'

export interface BrokerOrderRecoveryDialogState {
  mode: BrokerOrderRecoveryDialogMode
  item: BrokerOrderRecoveryItem
  candidates?: BrokerOrderRecoveryCandidate[]
  candidate?: BrokerOrderRecoveryCandidate
  contextPreview?: BrokerContextPreview
}

export interface UnknownOrderReconciliationDialogProps {
  state: BrokerOrderRecoveryDialogState
  loading: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => Promise<void>
  onSelectCandidate: (candidate: BrokerOrderRecoveryCandidate) => void
  onRequestNotSubmitted: () => void
  onRequestCancellationNotAccepted: () => void
}
