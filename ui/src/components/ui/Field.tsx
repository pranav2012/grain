import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

const field = 'rounded-lg border border-line bg-canvas text-fg outline-none placeholder:text-fg-faint focus:border-fg-subtle'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(field, 'px-3 py-1.5', className)} />
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(field, 'min-h-24 w-full resize-y p-2.5 leading-normal', className)} />
}

/** Borderless input that fills the top of a dialog or picker. */
export function SearchInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn('w-full border-b border-line bg-transparent px-4 py-3.5 text-md outline-none placeholder:text-fg-faint', className)} />
}
