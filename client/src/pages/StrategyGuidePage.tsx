import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { BookOpen, ChevronDown, ChevronUp } from 'lucide-react'
import { useGetAvailableStrategiesQuery } from '@/graphql/generated'

export function StrategyGuidePage() {
  const { data, loading } = useGetAvailableStrategiesQuery()
  const strategies = data?.availableStrategies ?? []
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">전략 가이드</h2>
        <p className="text-sm text-muted-foreground mt-1">자동매매 전략별 동작 방식과 조건을 확인하세요</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary-500" />
            <CardTitle>사용 가능한 전략</CardTitle>
          </div>
          <CardDescription>관심종목에 설정 가능한 자동매매 전략 목록입니다. 각 전략을 클릭하면 상세 설명을 확인할 수 있습니다.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">로딩중...</p>
          ) : (
            <div className="space-y-2">
              {strategies.map((strategy, idx) => (
                <div key={strategy.name} className="rounded-lg border border-border/50">
                  <button
                    className="flex items-center justify-between w-full px-4 py-3 text-left hover:bg-accent/50 transition-colors"
                    onClick={() => setExpandedIndex(expandedIndex === idx ? null : idx)}
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-sm">{strategy.displayName}</span>
                      <Badge variant="outline" className="text-xs">{strategy.name}</Badge>
                    </div>
                    {expandedIndex === idx ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                  {expandedIndex === idx && (
                    <div className="px-4 pb-4 pt-1">
                      <pre className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed font-sans">
                        {strategy.description}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
