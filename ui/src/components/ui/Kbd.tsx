import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-block min-w-[18px] rounded border border-b-2 border-seam bg-slate-2 px-[5px] py-0.5 text-center font-mono text-[11px] leading-none text-fog',
        className,
      )}
    >
      {children}
    </kbd>
  )
}
