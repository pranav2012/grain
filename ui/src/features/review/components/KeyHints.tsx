import { Kbd } from '@/components/ui/Kbd'
import type { ModeCopy } from '../model/modes'
import type { DiffStyle } from '../model/types'

export function KeyHints({ copy, diffStyle, note }: { copy: ModeCopy; diffStyle: DiffStyle; note: string }) {
  const hints: [string[], string][] = [
    [['j', 'k'], 'Move'],
    [['space'], copy.primary],
    [['x'], copy.secondary],
    [['c'], 'Note'],
    [['⌘K'], 'Commands'],
    [['?'], 'All shortcuts'],
    [['s'], diffStyle === 'split' ? 'Unified' : 'Side by side'],
  ]
  return (
    <footer className="flex items-center gap-[18px] border-t border-seam px-3.5 text-xs text-fog [grid-area:keys]">
      {hints.map(([keys, label]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          {keys.map((k) => (
            <Kbd key={k}>{k}</Kbd>
          ))}
          {label}
        </span>
      ))}
      <span className="ml-auto truncate text-dim">{note}</span>
    </footer>
  )
}
