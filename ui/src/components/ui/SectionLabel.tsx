import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** Small heading above a group of content in panels and lists. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <h3 className={cn('text-xs font-medium text-fg-subtle', className)}>{children}</h3>
}
