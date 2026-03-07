import { useState, useRef, useEffect, type ReactNode } from 'react'

export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  const [show, setShow] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<'bottom' | 'top'>('bottom')

  useEffect(() => {
    if (show && ref.current) {
      const rect = ref.current.getBoundingClientRect()
      setPos(rect.bottom + 80 > window.innerHeight ? 'top' : 'bottom')
    }
  }, [show])

  return (
    <div
      ref={ref}
      className="relative inline-flex"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <div
          className={`absolute z-50 left-1/2 -translate-x-1/2 w-56 rounded-lg bg-foreground text-background text-xs leading-relaxed p-2.5 shadow-lg pointer-events-none ${
            pos === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5'
          }`}
        >
          {text}
        </div>
      )}
    </div>
  )
}
