import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import {
  useGetWatchStocksQuery,
  useCreateWatchStockMutation,
  useUpdateWatchStockMutation,
  useDeleteWatchStockMutation,
  useGetAvailableStrategiesQuery,
  GetWatchStocksDocument,
} from '@/graphql/generated'
import { useCountryFilter } from '@/hooks/useCountryFilter'
import { WatchlistFilters } from '@/pages/watchlist/WatchlistFilters'
import { WatchlistTable } from '@/pages/watchlist/WatchlistTable'
import { AddWatchStockModal } from '@/pages/watchlist/AddWatchStockModal'

export function WatchlistPage() {
  const navigate = useNavigate()
  const { countryFilter, setCountryFilter, selectedCountry, marketFilter } = useCountryFilter()
  const [showAddModal, setShowAddModal] = useState(false)

  const { data, loading } = useGetWatchStocksQuery({
    variables: { input: marketFilter ? { market: marketFilter } : undefined },
  })
  const { data: strategiesData } = useGetAvailableStrategiesQuery()
  const strategies = strategiesData?.availableStrategies ?? []
  const allStocks = data?.watchStocks ?? []

  // 국가 필터 적용 (exchangeCode 기준)
  const watchStocks = countryFilter
    ? allStocks.filter((s) => selectedCountry?.exchanges.includes(s.exchangeCode ?? '') ?? false)
    : allStocks

  const refetchOptions = {
    refetchQueries: [{ query: GetWatchStocksDocument, variables: { input: marketFilter ? { market: marketFilter } : undefined } }],
  }

  const [createMutation] = useCreateWatchStockMutation(refetchOptions)
  const [updateMutation] = useUpdateWatchStockMutation(refetchOptions)
  const [deleteMutation] = useDeleteWatchStockMutation(refetchOptions)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">관심종목</h2>
          <p className="text-sm text-muted-foreground mt-1">관심종목을 관리하고 매매 전략을 설정하세요</p>
        </div>
        <Button onClick={() => setShowAddModal(true)}>
          <Plus size={16} /> 종목 추가
        </Button>
      </div>

      <WatchlistFilters
        countryFilter={countryFilter}
        allStocks={allStocks}
        onChange={setCountryFilter}
      />

      <WatchlistTable
        loading={loading}
        watchStocks={watchStocks}
        strategies={strategies}
        onOpenDetail={(stockId) => navigate(`/watchlist/${stockId}`)}
        onToggleActive={async (stock) => {
          await updateMutation({ variables: { id: stock.id, input: { isActive: !stock.isActive } } })
        }}
        onDelete={async (stock) => {
          if (confirm(`${stock.stockName}을(를) 삭제하시겠습니까?`)) {
            await deleteMutation({ variables: { id: stock.id } })
          }
        }}
      />

      {showAddModal && (
        <AddWatchStockModal
          strategies={strategies}
          onSave={async (input) => {
            await createMutation({ variables: { input } })
            setShowAddModal(false)
          }}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  )
}
