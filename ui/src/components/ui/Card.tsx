import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

/** Bordered panel on the surface level; `float` lifts it above the page (toasts, popovers). */
export function Card({ float, className, ...props }: HTMLAttributes<HTMLDivElement> & { float?: boolean }) {
  return <div {...props} className={cn('rounded-lg border border-line bg-surface', float && 'shadow-float', className)} />
}
