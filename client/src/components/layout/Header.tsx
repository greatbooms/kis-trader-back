import { Bell, LogOut, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'
import type { HeaderProps } from '@/components/types'

export function Header({ sidebarCollapsed }: HeaderProps) {
  const { logout } = useAuth()

  return (
    <header
      className={cn(
        'fixed top-0 right-0 z-30 flex h-14 items-center justify-between border-b border-border bg-card/80 backdrop-blur-sm px-6 transition-all duration-300',
        sidebarCollapsed
          ? 'left-(--width-sidebar-collapsed)'
          : 'left-(--width-sidebar)'
      )}
    >
      <div className="flex items-center gap-2">
        <h1 className="text-base font-semibold text-foreground">
          KIS Auto Trader
        </h1>
      </div>

      <div className="flex items-center gap-3">
        <button className="relative flex h-9 w-9 items-center justify-center rounded-lg hover:bg-primary-50 text-muted-foreground transition-colors cursor-pointer">
          <Bell size={18} />
        </button>
        <button className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-100 text-primary-600 hover:bg-primary-200 transition-colors cursor-pointer">
          <User size={18} />
        </button>
        <button
          onClick={logout}
          className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-red-50 text-muted-foreground hover:text-danger transition-colors cursor-pointer"
          title="로그아웃"
        >
          <LogOut size={18} />
        </button>
      </div>
    </header>
  )
}
