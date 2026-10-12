import { useMemo, useState } from 'react'
import { Dialog } from './ui/Dialog'

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
      <input
        autoFocus
        value={q}
        placeholder="Jump to a block or run a command"
        className="w-full border-b border-seam bg-transparent px-4 py-3.5 text-[15px] outline-none"
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
          <li
            key={c.id}
            role="option"
            aria-selected={i === sel}
            onMouseEnter={() => setSel(i)}
            onClick={() => run(c)}
            className="flex cursor-pointer items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-fog aria-selected:bg-slate-2 aria-selected:text-chalk"
          >
            {c.label}
            {c.hint && <span className="ml-auto text-xs text-dim">{c.hint}</span>}
          </li>
        ))}
        {shown.length === 0 && <li className="px-2.5 py-2 text-fog">No matches. Try a file, symbol or chapter name.</li>}
      </ul>
    </Dialog>
  )
}
