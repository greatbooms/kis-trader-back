import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Eye,
  BookOpen,
  Settings,
  TrendingUp,
  FlaskConical,
  Search,
  ChevronLeft,
  ChevronRight,
  CandlestickChart,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SidebarProps } from '@/components/types'
import { Logo } from '@/components/Logo'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: '대시보드' },
  { to: '/screening', icon: Search, label: '종목 추천' },
  { to: '/strategy-guide', icon: BookOpen, label: '전략 가이드' },
  { to: '/watchlist', icon: Eye, label: '관심종목' },
  { to: '/portfolio', icon: TrendingUp, label: '포트폴리오' },
  { to: '/quote', icon: CandlestickChart, label: '시세 조회' },
  { to: '/simulation', icon: FlaskConical, label: '시뮬레이션' },
  { to: '/settings', icon: Settings, label: '설정' },
]

export function Sidebar({ collapsed, mobileOpen, onToggle, onCloseMobile }: SidebarProps) {
  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-40 bg-foreground/40 backdrop-blur-xs transition-opacity md:hidden',
          mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
        onClick={onCloseMobile}
      />
      <aside
        className={cn(
          'fixed left-0 top-0 z-50 h-screen border-r border-sidebar-border bg-sidebar-bg transition-all duration-300',
          collapsed ? 'md:w-(--width-sidebar-collapsed)' : 'md:w-(--width-sidebar)',
          'w-[84vw] max-w-[320px] md:max-w-none',
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        )}
      >
        <div
          className={cn(
            'flex h-14 items-center border-b border-sidebar-border',
            collapsed ? 'md:justify-center md:px-0 px-4 justify-between' : 'justify-between px-4',
          )}
        >
          <div className={cn('flex items-center gap-2 min-w-0', collapsed && 'md:gap-0')}>
            <Logo size={28} className="shrink-0" />
            <span
              className={cn(
                'text-base font-bold text-primary-700 truncate',
                collapsed && 'md:hidden',
              )}
            >
              KIS Trader
            </span>
          </div>
          <div className={cn('flex items-center gap-1', collapsed && 'md:hidden')}>
            <button
              onClick={onToggle}
              className="hidden md:flex h-8 w-8 items-center justify-center rounded-md hover:bg-primary-100 text-muted-foreground cursor-pointer"
              aria-label="사이드바 접기"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={onCloseMobile}
              className="flex md:hidden h-8 w-8 items-center justify-center rounded-md hover:bg-primary-100 text-muted-foreground cursor-pointer"
              aria-label="메뉴 닫기"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        {/* collapsed 상태 전용: 로고 하단 펼침 버튼 */}
        {collapsed && (
          <button
            onClick={onToggle}
            className="hidden md:flex mx-auto mt-1 h-7 w-7 items-center justify-center rounded-md hover:bg-primary-100 text-muted-foreground cursor-pointer"
            aria-label="사이드바 펼치기"
          >
            <ChevronRight size={16} />
          </button>
        )}

        <nav className="flex flex-col gap-1 p-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onCloseMobile}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary-100 text-primary-700'
                    : 'text-sidebar-fg hover:bg-primary-50 hover:text-primary-600'
                )
              }
            >
              <item.icon size={20} />
              <span className={cn(collapsed && 'md:hidden')}>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  )
}
