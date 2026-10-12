import type { LiHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

/** Keyboard-selectable row in a listbox (command palette, PR picker). */
export function ListOption({ selected, className, ...props }: LiHTMLAttributes<HTMLLIElement> & { selected: boolean }) {
  return (
    <li
      {...props}
      role="option"
      aria-selected={selected}
      className={cn('cursor-pointer rounded-md px-2.5 py-2 text-fg-subtle aria-selected:bg-raised aria-selected:text-fg', className)}
    />
  )
}

/** Non-interactive message row in a listbox (loading, empty, error). */
export function ListMessage({ className, ...props }: LiHTMLAttributes<HTMLLIElement>) {
  return <li {...props} className={cn('px-2.5 py-2 text-fg-subtle', className)} />
}
