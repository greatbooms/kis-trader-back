import type { TechnicalRatingsView } from '@/types'

export interface TechnicalRatingsPanelProps {
  ratings?: TechnicalRatingsView | null
  title?: string
  compact?: boolean
}
