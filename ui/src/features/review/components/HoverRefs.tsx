import { LinkButton } from '@/components/ui/Button'
import type { NavigateResponse } from '@/types/generated/NavigateResponse'
import type { CodeLocation } from './CodeModal'

export interface HoverState {
  name: string
  token: { line: number; character: number; side: 'additions' | 'deletions' }
  left: number
  top: number
  definition?: NavigateResponse
  references?: NavigateResponse
  error?: string
}

interface HoverRefsProps {
  hover: HoverState
  /** Files changed in this PR, to count references in it. */
  inPr(file: string): boolean
  onOpen(loc: CodeLocation): void
  onAllReferences(): void
  onEnter(): void
  onLeave(): void
}

const fileName = (p: string) => p.split('/').pop()!

/** A card under a hovered name: where it's defined and where it's used; any place opens the whole file. */
export function HoverRefs({ hover, inPr, onOpen, onAllReferences, onEnter, onLeave }: HoverRefsProps) {
  const def = hover.definition?.results[0]
  const refs = hover.references?.results ?? []
  const inThisPr = refs.filter((r) => inPr(r.file)).length
  const removed = hover.definition?.removed || hover.references?.removed
  const row = 'grid w-full grid-cols-[minmax(0,13rem)_minmax(0,1fr)] gap-2 rounded-sm px-1.5 py-0.5 text-left font-mono text-xs hover:bg-raised'
  return (
    <div
      role="tooltip"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{ left: Math.min(hover.left, window.innerWidth - 470), top: hover.top }}
      className="fixed z-50 w-[460px] rounded-lg border border-line-strong bg-surface p-2 font-sans text-sm shadow-overlay"
    >
      <p className="flex items-baseline gap-2 px-1.5">
        <b className="font-mono text-fg">{hover.name}</b>
        {removed && <span className="text-xs text-warning">removed in this PR; still mentioned in:</span>}
        {!hover.references && !hover.error && <span className="text-xs text-fg-faint">Looking it up…</span>}
        {hover.references && !hover.references.precise && <span className="text-xs text-warning">approximate</span>}
      </p>
      {hover.error && <p className="px-1.5 text-xs text-danger">{hover.error}</p>}
      {def && !removed && (
        <button onClick={() => onOpen({ file: def.file, line: def.line })} className={row} title={def.file}>
          <span className="truncate text-fg-faint">defined in {fileName(def.file)}:{def.line}</span>
          <span className="truncate text-fg-subtle">{(def.snippet[def.line - def.snippetStart] ?? '').trim()}</span>
        </button>
      )}
      {hover.references && (
        <>
          <p className="mt-1 px-1.5 text-xs text-fg-subtle">
            {refs.length === 0
              ? 'No other uses found.'
              : `Used in ${refs.length}${hover.references.truncated ? '+' : ''} ${refs.length === 1 ? 'place' : 'places'}${inThisPr ? `, ${inThisPr} in this PR` : ''}`}
          </p>
          {refs.slice(0, 6).map((r) => (
            <button key={`${r.file}:${r.line}`} onClick={() => onOpen({ file: r.file, line: r.line })} className={row} title={r.file}>
              <span className="truncate text-fg-muted">
                {fileName(r.file)}:{r.line}
              </span>
              <span className="truncate text-fg-subtle">{(r.snippet[r.line - r.snippetStart] ?? '').trim()}</span>
            </button>
          ))}
          {refs.length > 6 && (
            <LinkButton className="mt-0.5 px-1.5 text-xs" onClick={onAllReferences}>
              All {refs.length} places
            </LinkButton>
          )}
        </>
      )}
    </div>
  )
}
