import { LinkButton } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import type { NavigateResponse } from '@/types/generated/NavigateResponse'

export interface Peek {
  itemId: string
  line: number
  side: 'additions' | 'deletions'
  name: string
  references: boolean
  /** Column of the name, to look it up again (definition ⇄ references). */
  character: number
  result?: NavigateResponse
  error?: string
}

interface CodePeekProps {
  peek: Peek
  /** Scrolls to a line of a file changed in this PR. */
  onJump(file: string, line: number): void
  /** Looks the same name up the other way. */
  onSwitch(references: boolean): void
  /** Opens the whole file at that line. */
  onOpen(file: string, line: number): void
  /** The line on GitHub, for places outside this PR (none for local reviews). */
  githubUrl?: (file: string, line: number) => string
  onClose(): void
}

/** Inline box under a line: where a name is defined, or every place that uses it. */
export function CodePeek({ peek, onJump, onSwitch, onOpen, githubUrl, onClose }: CodePeekProps) {
  const r = peek.result
  const what = peek.references ? 'References to' : 'Definition of'
  return (
    <div className="my-1 overflow-hidden rounded-lg border border-accent bg-surface font-sans shadow-float">
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-xs text-fg-subtle">
        <span>
          {what} <b className="font-mono text-fg">{peek.name}</b>
          {r && ` · ${r.results.length}${r.truncated ? '+' : ''} ${r.results.length === 1 ? 'place' : 'places'}`}
        </span>
        {r && !r.precise && (
          <span className="text-warning" title="Found by searching for the name; this language has no precise lookup here">
            approximate
          </span>
        )}
        <span className="ml-auto flex items-center gap-2.5">
          <LinkButton aria-pressed={!peek.references} className="aria-pressed:text-fg" onClick={() => peek.references && onSwitch(false)}>
            Definition
          </LinkButton>
          <LinkButton aria-pressed={peek.references} className="aria-pressed:text-fg" title="⇧⌘ click a name" onClick={() => !peek.references && onSwitch(true)}>
            References
          </LinkButton>
          <LinkButton onClick={onClose}>Close</LinkButton>
        </span>
      </div>
      {r?.removed && <p className="px-3 pt-2 text-sm text-warning">{peek.name} no longer exists in this file after the PR; these places still mention it.</p>}
      {!r && !peek.error && <p className="px-3 py-2 text-sm text-fg-subtle">Looking it up…</p>}
      {peek.error && <p className="px-3 py-2 text-sm text-danger">{peek.error}</p>}
      {r && r.results.length === 0 && <p className="px-3 py-2 text-sm text-fg-subtle">Nothing found in this repository.</p>}
      {r && r.results.length > 0 && (
        <ul className="max-h-80 overflow-auto">
          {r.results.map((loc) => {
            const lines = peek.references ? [loc.snippet[loc.line - loc.snippetStart] ?? ''] : loc.snippet
            const first = peek.references ? loc.line : loc.snippetStart
            return (
              <li key={`${loc.file}:${loc.line}`} className="border-b border-line last:border-0">
                <div className="flex items-center gap-2 px-3 pt-1.5 text-xs">
                  <button onClick={() => onOpen(loc.file, loc.line)} className="truncate font-mono text-fg-muted hover:text-fg hover:underline" title={`Open ${loc.file} in full`}>
                    {loc.file}:{loc.line}
                  </button>
                  {loc.block != null ? (
                    <LinkButton className="ml-auto shrink-0 text-accent" onClick={() => onJump(loc.file, loc.line)}>
                      in this review →
                    </LinkButton>
                  ) : githubUrl ? (
                    <a href={githubUrl(loc.file, loc.line)} target="_blank" rel="noreferrer" className="ml-auto shrink-0 text-fg-faint hover:text-fg">
                      not changed in this PR · GitHub ↗
                    </a>
                  ) : (
                    <span className="ml-auto shrink-0 text-fg-faint">not changed in this PR</span>
                  )}
                </div>
                <pre onClick={() => onOpen(loc.file, loc.line)} className="cursor-pointer overflow-x-auto px-3 pt-0.5 pb-1.5 font-mono text-xs leading-relaxed hover:bg-raised">
                  {lines.map((text, i) => (
                    <div key={i} className={cn('grid grid-cols-[3rem_1fr]', first + i === loc.line && !peek.references && 'bg-accent/10')}>
                      <span className="pr-3 text-right text-fg-faint select-none">{first + i}</span>
                      <span className="text-fg-muted">{text}</span>
                    </div>
                  ))}
                </pre>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
