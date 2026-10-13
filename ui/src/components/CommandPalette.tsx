import { useMemo, useState } from 'react'
import { Dialog } from './ui/Dialog'
import { SearchInput } from './ui/Field'
import { ListMessage, ListOption } from './ui/ListOption'

export interface Command {
  id: string
  label: string
  hint?: string
  run(): void
}

/** Fuzzy-ish (all words must match) launcher for commands and navigation targets. */
export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose(): void }) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return commands.filter((c) => words.every((w) => `${c.label} ${c.hint ?? ''}`.toLowerCase().includes(w))).slice(0, 60)
  }, [q, commands])
  const run = (c?: Command) => {
    if (!c) return
    onClose()
    c.run()
  }
  return (
    <Dialog label="Commands" onClose={onClose} className="w-[min(620px,92vw)] overflow-hidden">
      <SearchInput
        autoFocus
        value={q}
        placeholder="Jump to a block or layer, or run a command"
        onChange={(e) => {
          setQ(e.target.value)
          setSel(0)
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') onClose()
          if (e.key === 'ArrowDown') setSel((s) => Math.min(shown.length - 1, s + 1))
          if (e.key === 'ArrowUp') setSel((s) => Math.max(0, s - 1))
          if (e.key === 'Enter') run(shown[sel])
        }}
      />
      <ul role="listbox" className="max-h-[50vh] overflow-auto p-1.5">
        {shown.map((c, i) => (
          <ListOption key={c.id} selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => run(c)} className="flex items-center gap-2.5">
            {c.label}
            {c.hint && <span className="ml-auto text-xs text-fg-faint">{c.hint}</span>}
          </ListOption>
        ))}
        {shown.length === 0 && <ListMessage>No matches. Try a file, symbol or layer name.</ListMessage>}
      </ul>
    </Dialog>
  )
}
