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
    <div role="group" aria-label={label} className={cn('flex rounded-md border border-line bg-surface p-0.5', className)}>
      {options.map(([v, text]) => (
        <button
          key={v}
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cn(
            'rounded-sm text-fg-subtle hover:text-fg aria-pressed:bg-raised aria-pressed:text-fg aria-pressed:shadow-[inset_0_0_0_1px_var(--color-line)]',
            size === 'sm' ? 'px-2 py-0.5 text-sm' : 'px-2.5 py-1',
          )}
        >
          {text}
        </button>
      ))}
    </div>
  )
}
