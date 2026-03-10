import { Github } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Footer({ sidebarCollapsed }: { sidebarCollapsed: boolean }) {
  return (
    <footer
      className={cn(
        'border-t border-border py-4 px-6 transition-all duration-300 text-xs text-muted-foreground',
        sidebarCollapsed
          ? 'ml-(--width-sidebar-collapsed)'
          : 'ml-(--width-sidebar)'
      )}
    >
      <div className="flex flex-col sm:flex-row items-center justify-between gap-2">
        <p>
          실시간 시세 및 계좌 정보는 한국투자증권 Open API를 통해 제공됩니다. 시뮬레이션은 자체 가상 매매 데이터입니다.
        </p>
        <div className="flex items-center gap-3">
          <span>Developed by Eric</span>
          <a
            href="https://github.com/greatbooms/kis-trader-back"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
          >
            <Github size={14} />
            <span>GitHub</span>
          </a>
        </div>
      </div>
    </footer>
  )
}
