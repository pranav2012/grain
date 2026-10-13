import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

type Tone = 'neutral' | 'accent' | 'success' | 'danger' | 'warning'

const tones: Record<Tone, string> = {
  neutral: 'text-fg-subtle',
  accent: 'text-accent',
  success: 'text-success',
  danger: 'text-danger',
  warning: 'text-warning',
}

/** Small outlined label for states and tags ("Draft", "yours", "Layer 3"). */
export function Badge({ tone = 'neutral', title, children, className }: { tone?: Tone; title?: string; children: ReactNode; className?: string }) {
  return (
    <span title={title} className={cn('inline-flex items-center gap-1 rounded-sm border border-line px-1.5 text-2xs leading-4 font-medium', tones[tone], className)}>
      {children}
    </span>
  )
}
