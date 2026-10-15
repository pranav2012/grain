import { LinkButton } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import type { NavigateResponse } from '@/types/generated/NavigateResponse'

export interface Peek {
  itemId: string
  line: number
  side: 'additions' | 'deletions'
  name: string
  references: boolean
  result?: NavigateResponse
  error?: string
}

interface CodePeekProps {
  peek: Peek
  /** Scrolls to a file changed in this PR. */
  onJump(file: string): void
  onClose(): void
}

/** Inline box under a line: where a name is defined, or every place that uses it. */
export function CodePeek({ peek, onJump, onClose }: CodePeekProps) {
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
        <LinkButton className="ml-auto" onClick={onClose}>
          Close
        </LinkButton>
      </div>
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
                  <span className="truncate font-mono text-fg-muted" title={loc.file}>
                    {loc.file}:{loc.line}
                  </span>
                  {loc.block != null ? (
                    <LinkButton className="ml-auto shrink-0 text-accent" onClick={() => onJump(loc.file)}>
                      in this review →
                    </LinkButton>
                  ) : (
                    <span className="ml-auto shrink-0 text-fg-faint">not changed in this PR</span>
                  )}
                </div>
                <pre className="overflow-x-auto px-3 pt-0.5 pb-1.5 font-mono text-xs leading-relaxed">
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
