import { useMemo, useState } from 'react'

export interface Command {
  id: string
  label: string
  hint?: string
  run(): void
}

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
    <div className="scrim" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-label="Commands" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={q}
          placeholder="Jump to a block or run a command"
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
        <ul role="listbox">
          {shown.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => run(c)}>
              {c.label}
              {c.hint && <span className="hint">{c.hint}</span>}
            </li>
          ))}
          {shown.length === 0 && <li>No matches. Try a file, symbol or chapter name.</li>}
        </ul>
      </div>
    </div>
  )
}
