import { useState, useRef, useCallback, type ReactNode } from 'react'

export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  const [style, setStyle] = useState<React.CSSProperties | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const show = useCallback(() => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const TOOLTIP_W = 224 // w-56 = 14rem = 224px
    const GAP = 6

    // vertical: prefer bottom, flip to top if not enough space
    const goUp = rect.bottom + GAP + 80 > window.innerHeight
    const top = goUp ? rect.top - GAP : rect.bottom + GAP

    // horizontal: center on trigger, clamp to viewport
    let left = rect.left + rect.width / 2 - TOOLTIP_W / 2
    left = Math.max(8, Math.min(left, window.innerWidth - TOOLTIP_W - 8))

    setStyle({ position: 'fixed', top, left, width: TOOLTIP_W, zIndex: 9999 })
  }, [])

  const hide = useCallback(() => setStyle(null), [])

  return (
    <div
      ref={ref}
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}
      {style && (
        <div
          style={style}
          className="rounded-lg bg-foreground text-background text-xs leading-relaxed p-2.5 shadow-lg pointer-events-none"
        >
          {text}
        </div>
      )}
    </div>
  )
}
