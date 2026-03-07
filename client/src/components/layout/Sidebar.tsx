import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Eye,
  BookOpen,
  Settings,
  TrendingUp,
  FlaskConical,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SidebarProps } from '@/components/types'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: '대시보드' },
  { to: '/watchlist', icon: Eye, label: '관심종목' },
  { to: '/portfolio', icon: TrendingUp, label: '포트폴리오' },
  { to: '/strategy-guide', icon: BookOpen, label: '전략 가이드' },
  { to: '/simulation', icon: FlaskConical, label: '시뮬레이션' },
  { to: '/settings', icon: Settings, label: '설정' },
]

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-40 h-screen border-r border-sidebar-border bg-sidebar-bg transition-all duration-300',
        collapsed ? 'w-(--width-sidebar-collapsed)' : 'w-(--width-sidebar)'
      )}
    >
      <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-4">
        {!collapsed && (
          <span className="text-lg font-bold text-primary-600">KIS Trader</span>
        )}
        <button
          onClick={onToggle}
          className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-primary-100 text-muted-foreground cursor-pointer"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      <nav className="flex flex-col gap-1 p-2">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary-100 text-primary-700'
                  : 'text-sidebar-fg hover:bg-primary-50 hover:text-primary-600'
              )
            }
          >
            <item.icon size={20} />
            {!collapsed && <span>{item.label}</span>}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
