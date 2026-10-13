import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'default' | 'primary' | 'danger' | 'ghost'
type Size = 'sm' | 'md' | 'icon'

const variants: Record<Variant, string> = {
  default: 'border-line bg-surface text-fg hover:bg-raised',
  primary: 'border-strong bg-strong font-medium text-fg-on-strong hover:bg-strong-hover [&_kbd]:border-fg-subtle/40 [&_kbd]:bg-transparent [&_kbd]:text-fg-faint',
  danger: 'border-line bg-surface text-danger hover:bg-raised',
  ghost: 'border-transparent text-fg-subtle hover:bg-surface hover:text-fg',
}

const sizes: Record<Size, string> = {
  sm: 'gap-1.5 px-2 py-0.5 text-sm',
  md: 'gap-2 px-3 py-1',
  icon: 'p-1.5',
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }

export function Button({ variant = 'default', size = 'md', className, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-md border disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
    />
  )
}

/** Quiet inline action (Delete, Reply, Resolve): underlined text, no chrome. */
export function LinkButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        'text-xs text-fg-subtle underline decoration-line underline-offset-[3px] hover:text-fg disabled:opacity-50',
        className,
      )}
    />
  )
}
