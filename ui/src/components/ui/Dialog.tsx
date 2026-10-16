import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** Dimmed full-page backdrop; closes on a click outside its content. */
export function Scrim({ onClose, children }: { onClose?(): void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-scrim pt-[12vh] max-sm:pt-3" onMouseDown={onClose}>
      {children}
    </div>
  )
}

interface DialogProps {
  label: string
  onClose(): void
  children: ReactNode
  className?: string
}

/** Modal panel over a dimmed page; closes on Escape or a click outside. */
export function Dialog({ label, onClose, children, className }: DialogProps) {
  return (
    <Scrim onClose={onClose}>
      <div
        role="dialog"
        aria-label={label}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        className={cn('max-h-[calc(88dvh-1.5rem)] w-[min(560px,92vw)] max-sm:max-h-[calc(100dvh-1.5rem)] overflow-auto rounded-xl border border-line bg-surface shadow-overlay motion-safe:animate-rise', className)}
      >
        {children}
      </div>
    </Scrim>
  )
}

export function DialogTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-1 text-lg font-semibold text-fg">{children}</h2>
}

export function DialogActions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mt-4 flex justify-end gap-2', className)}>{children}</div>
}
