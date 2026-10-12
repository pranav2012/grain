import { cn } from '@/lib/cn'

interface SegmentedProps<T extends string> {
  label: string
  value: T
  options: [T, string][]
  onChange(value: T): void
  size?: 'sm' | 'md'
  className?: string
}

export function Segmented<T extends string>({ label, value, options, onChange, size = 'md', className }: SegmentedProps<T>) {
  return (
    <div role="group" aria-label={label} className={cn('flex rounded-[7px] border border-seam bg-slate p-0.5', className)}>
      {options.map(([v, text]) => (
        <button
          key={v}
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cn(
            'rounded-[5px] text-fog aria-pressed:bg-slate-2 aria-pressed:text-chalk aria-pressed:shadow-[inset_0_0_0_1px_var(--color-seam)]',
            size === 'sm' ? 'px-[9px] py-[3px] text-xs' : 'px-2.5 py-1',
          )}
        >
          {text}
        </button>
      ))}
    </div>
  )
}
