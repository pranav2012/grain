import { useEffect, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface DrawerProps {
  side: 'left' | 'right'
  label: string
  onClose(): void
  children: ReactNode
}

/** A panel sliding over the page from one edge on small screens; closes on Escape or a click outside. */
export function Drawer({ side, label, onClose, children }: DrawerProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 bg-scrim" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label={label}
        onMouseDown={(e) => e.stopPropagation()}
        className={cn(
          'absolute inset-y-0 flex w-[min(340px,88vw)] flex-col bg-canvas shadow-overlay [&>*]:min-h-0 [&>*]:flex-1',
          side === 'left' ? 'left-0 border-r border-line' : 'right-0 border-l border-line',
        )}
      >
        {children}
      </div>
    </div>
  )
}
