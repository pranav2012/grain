import { Kbd } from '@/components/ui/Kbd'

const hints: [string[], string][] = [
  [['j', 'k'], 'File'],
  [['⇧J', '⇧K'], 'Chapter'],
  [['v'], 'Viewed, next'],
  [['b'], 'Back'],
  [['s'], 'Split / unified'],
  [['⌘K'], 'Commands'],
  [['?'], 'All shortcuts'],
]

export function KeyHints({ note }: { note: string }) {
  return (
    <footer className="flex items-center gap-4.5 border-t border-line px-3.5 text-xs text-fg-subtle [grid-area:keys]">
      {hints.map(([keys, label]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          {keys.map((k) => (
            <Kbd key={k}>{k}</Kbd>
          ))}
          {label}
        </span>
      ))}
      <span className="ml-auto truncate text-fg-faint">{note}</span>
    </footer>
  )
}
