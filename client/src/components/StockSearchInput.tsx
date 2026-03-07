import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@apollo/client/react'
import { Input } from '@/components/ui/input'
import { SearchStocksDocument, type Market, type SearchStocksQuery, type SearchStocksQueryVariables, type StockSearchResult } from '@/graphql/generated'

interface StockSearchInputProps {
  market?: Market
  exchangeCode?: string
  placeholder?: string
  onSelect: (stock: StockSearchResult) => void
}

export function StockSearchInput({ market, exchangeCode, placeholder = '종목명 또는 코드 검색', onSelect }: StockSearchInputProps) {
  const [keyword, setKeyword] = useState('')
  const [debouncedKeyword, setDebouncedKeyword] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({})
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const shouldSkip = debouncedKeyword.length < 1
  const { data, loading } = useQuery<SearchStocksQuery, SearchStocksQueryVariables>(
    SearchStocksDocument,
    {
      variables: { keyword: debouncedKeyword || '', market: market ?? undefined, limit: 15, exchangeCode: exchangeCode ?? undefined },
      skip: shouldSkip,
    },
  )
  const results = (data?.searchStocks ?? []) as StockSearchResult[]

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setKeyword(value)

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedKeyword(value)
      if (value.length >= 1) {
        updateDropdownPosition()
        setIsOpen(true)
        setSelectedIndex(-1)
      } else {
        setIsOpen(false)
      }
    }, 300)
  }

  const handleSelect = (stock: StockSearchResult) => {
    setKeyword(`${stock.stockName} (${stock.stockCode})`)
    setIsOpen(false)
    setDebouncedKeyword('')
    onSelect(stock)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || results.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : prev))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev))
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      e.preventDefault()
      handleSelect(results[selectedIndex])
    } else if (e.key === 'Escape') {
      setIsOpen(false)
    }
  }

  const updateDropdownPosition = () => {
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect()
      setDropdownStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      })
    }
  }

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div ref={wrapperRef} className="relative">
      <Input
        ref={inputRef}
        value={keyword}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          updateDropdownPosition()
          if (debouncedKeyword.length >= 1 && results.length > 0) setIsOpen(true)
        }}
        placeholder={placeholder}
        autoComplete="off"
      />
      {isOpen && (
        <div style={dropdownStyle} className="z-[9999] max-h-60 overflow-auto rounded-md border bg-background shadow-lg">
          {loading && (
            <div className="px-3 py-2 text-sm text-muted-foreground">검색중...</div>
          )}
          {!loading && results.length === 0 && debouncedKeyword.length >= 1 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">결과 없음</div>
          )}
          {results.map((stock, idx) => (
            <div
              key={`${stock.exchangeCode}-${stock.stockCode}`}
              className={`flex items-center justify-between px-3 py-2 text-sm cursor-pointer hover:bg-accent ${
                idx === selectedIndex ? 'bg-accent' : ''
              }`}
              onMouseDown={() => handleSelect(stock)}
              onMouseEnter={() => setSelectedIndex(idx)}
            >
              <div className="flex flex-col">
                <span className="font-medium">{stock.stockName}</span>
                {stock.englishName && (
                  <span className="text-xs text-muted-foreground">{stock.englishName}</span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{stock.stockCode}</span>
                <span className="px-1 py-0.5 rounded bg-muted">{stock.exchangeCode}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
