import { cn } from '@/lib/cn'
import { blockTitle } from '../model/describe'
import type { BlockState, LoadedPr } from '../model/types'

const PER_SIDE = 6
const NODE_H = 46
const GAP = 8
const WIDTH = 288
const COL = 88

interface BlockMapProps {
  data: LoadedPr
  current: number
  states: Record<number, BlockState>
  stale: Record<number, string>
  chapterOf(id: number): string | undefined
  onGo(id: number): void
}

/** Strongest links first, capped; the rest are counted. */
function neighbours(pairs: { id: number; weight: number }[]) {
  const sorted = [...pairs].sort((a, b) => b.weight - a.weight || a.id - b.id)
  return { shown: sorted.slice(0, PER_SIDE).map((p) => p.id), more: Math.max(0, sorted.length - PER_SIDE) }
}

/** The current block between the blocks that use its code (left) and those it uses (right). */
export function BlockMap({ data, current, states, stale, chapterOf, onGo }: BlockMapProps) {
  const users = neighbours(data.review.links.filter((l) => l.to === current).map((l) => ({ id: l.from, weight: l.weight })))
  const uses = neighbours(data.review.links.filter((l) => l.from === current).map((l) => ({ id: l.to, weight: l.weight })))
  const rows = Math.max(users.shown.length, uses.shown.length, 1)
  const height = rows * (NODE_H + GAP) - GAP
  const top = (i: number, n: number) => (height - (n * (NODE_H + GAP) - GAP)) / 2 + i * (NODE_H + GAP)
  const centerTop = (height - NODE_H) / 2
  const curve = (x1: number, y1: number, x2: number, y2: number) => `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`

  const node = (id: number, x: number, y: number, isCurrent = false) => {
    const b = data.blocks.get(id)
    if (!b) return null
    const state = states[id]
    return (
      <button
        key={`${id}-${x}`}
        onClick={() => onGo(id)}
        title={`${blockTitle(data, b)} (${chapterOf(id) ?? 'Skim'})`}
        style={{ left: x, top: y, width: COL, height: NODE_H }}
        className={cn(
          'absolute flex flex-col justify-center overflow-hidden rounded-md border bg-surface px-1.5 text-left text-2xs leading-tight hover:bg-raised',
          isCurrent ? 'border-accent text-fg' : 'border-line text-fg-muted',
          !isCurrent && state === 'ok' && 'border-success/70',
          !isCurrent && state === 'change' && 'border-danger/70',
          !isCurrent && stale[id] && 'border-warning/70',
        )}
      >
        <span className="line-clamp-2">{blockTitle(data, b)}</span>
        <span className="truncate text-2xs text-fg-faint">{chapterOf(id) ?? 'Skim'}</span>
      </button>
    )
  }

  const centerX = (WIDTH - COL) / 2
  const rightX = WIDTH - COL
  if (!users.shown.length && !uses.shown.length)
    return <p className="px-4 py-3 leading-normal text-fg-subtle">This block doesn&apos;t use, and isn&apos;t used by, other blocks in this PR.</p>

  return (
    <div className="px-4 pt-3 pb-2">
      <div className="mb-2 flex justify-between text-2xs text-fg-faint">
        <span style={{ width: COL }}>Used by</span>
        <span style={{ width: COL }} className="text-right">
          Uses
        </span>
      </div>
      <div className="relative" style={{ width: WIDTH, height }}>
        <svg width={WIDTH} height={height} className="absolute inset-0 text-line" aria-hidden>
          {users.shown.map((_, i) => (
            <path key={`u${i}`} d={curve(COL, top(i, users.shown.length) + NODE_H / 2, centerX, centerTop + NODE_H / 2)} fill="none" stroke="currentColor" strokeWidth="1.2" />
          ))}
          {uses.shown.map((_, i) => (
            <path key={`s${i}`} d={curve(centerX + COL, centerTop + NODE_H / 2, rightX, top(i, uses.shown.length) + NODE_H / 2)} fill="none" stroke="currentColor" strokeWidth="1.2" />
          ))}
        </svg>
        {users.shown.map((id, i) => node(id, 0, top(i, users.shown.length)))}
        {node(current, centerX, centerTop, true)}
        {uses.shown.map((id, i) => node(id, rightX, top(i, uses.shown.length)))}
      </div>
      {(users.more > 0 || uses.more > 0) && (
        <div className="mt-2 flex justify-between text-2xs text-fg-faint">
          <span>{users.more > 0 && `+${users.more} more`}</span>
          <span>{uses.more > 0 && `+${uses.more} more`}</span>
        </div>
      )}
      <p className="mt-3 text-2xs leading-normal text-fg-faint">Lines connect code changed in this PR. Border colour shows your review: green looks good, red needs changes, amber changed since you reviewed.</p>
    </div>
  )
}
