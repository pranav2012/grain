import { cn } from '@/lib/cn'

/** Thin stacked bar: reviewed (success) then needs changes (danger), as fractions of 1. */
export function Progress({ ok, change = 0, className }: { ok: number; change?: number; className?: string }) {
  const pct = (n: number) => `${Math.min(100, Math.max(0, n * 100))}%`
  return (
    <div className={cn('flex h-[3px] overflow-hidden rounded-xs bg-line', className)} aria-hidden>
      <span className="h-full bg-success" style={{ width: pct(ok) }} />
      <span className="h-full bg-danger" style={{ width: pct(change) }} />
    </div>
  )
}
