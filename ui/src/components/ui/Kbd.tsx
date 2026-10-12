import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-block min-w-[18px] rounded-sm border border-b-2 border-line bg-raised px-1 py-0.5 text-center font-mono text-2xs leading-none text-fg-subtle',
        className,
      )}
    >
      {children}
    </kbd>
  )
}
