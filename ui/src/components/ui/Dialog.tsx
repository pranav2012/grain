import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface DialogProps {
  label: string
  onClose(): void
  children: ReactNode
  className?: string
}

/** Modal panel over a dimmed page; closes on Escape or a click outside. */
export function Dialog({ label, onClose, children, className }: DialogProps) {
  return (
    <div className="fixed inset-0 z-10 flex items-start justify-center bg-[rgba(8,9,12,0.6)] pt-[12vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label={label}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        className={cn(
          'w-[min(560px,92vw)] rounded-xl border border-seam bg-slate shadow-[0_24px_80px_rgba(0,0,0,0.55)] motion-safe:animate-rise',
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}
