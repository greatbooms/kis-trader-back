import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { Footer } from './Footer'
import { cn } from '@/lib/utils'

export function Layout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <Header sidebarCollapsed={sidebarCollapsed} />
      <main
        className={cn(
          'pt-14 flex-1 transition-all duration-300',
          sidebarCollapsed
            ? 'ml-(--width-sidebar-collapsed)'
            : 'ml-(--width-sidebar)'
        )}
      >
        <div className="p-page">
          <Outlet />
        </div>
      </main>
      <Footer sidebarCollapsed={sidebarCollapsed} />
    </div>
  )
}
