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
    <footer className="flex items-center gap-4.5 overflow-hidden whitespace-nowrap max-lg:gap-3 border-t border-line px-3.5 text-xs text-fg-subtle [grid-area:keys] max-md:hidden">
      {hints.map(([keys, label]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          {keys.map((k) => (
            <Kbd key={k}>{k}</Kbd>
          ))}
          {label}
        </span>
      ))}
      <span className="ml-auto min-w-0 truncate text-fg-faint max-lg:hidden">{note}</span>
    </footer>
  )
}
