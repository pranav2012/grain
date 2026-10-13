import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface ChoiceProps {
  checked: boolean
  label: ReactNode
  help?: ReactNode
  disabled?: boolean
  onSelect(): void
}

/** One option of a radio group shown as a card with a short explanation. */
export function Choice({ checked, label, help, disabled, onSelect }: ChoiceProps) {
  return (
    <button
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className="grid grid-cols-[14px_1fr] gap-2.5 rounded-lg border border-line px-3 py-2.5 text-left hover:bg-surface aria-checked:border-fg-subtle aria-checked:bg-raised disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        aria-hidden
        className={cn('mt-[3px] size-3.5 rounded-full border-[1.5px]', checked ? 'border-fg bg-[radial-gradient(var(--color-fg)_35%,transparent_40%)]' : 'border-fg-faint')}
      />
      <span>
        {label}
        {help && <small className="mt-0.5 block text-sm text-fg-subtle">{help}</small>}
      </span>
    </button>
  )
}

export function ChoiceGroup({ label, children, className }: { label?: string; children: ReactNode; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('flex flex-col gap-1.5', className)}>
      {children}
    </div>
  )
}
