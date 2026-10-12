import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'default' | 'primary' | 'danger' | 'ghost'

const variants: Record<Variant, string> = {
  default: 'border-seam bg-slate text-chalk hover:bg-slate-2',
  primary: 'border-chalk bg-chalk font-medium text-graphite hover:bg-white [&_kbd]:border-[#c9ccd2] [&_kbd]:bg-transparent [&_kbd]:text-dim',
  danger: 'border-seam bg-slate text-coral hover:bg-slate-2',
  ghost: 'border-transparent text-fog hover:bg-slate hover:text-chalk',
}

export function Button({ variant = 'default', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center gap-2 whitespace-nowrap rounded-md border px-[11px] py-[5px] disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        className,
      )}
    />
  )
}
