import { useEffect, useRef } from 'react'
import { ThreadIcon } from '@/components/Icons'
import { Badge } from '@/components/ui/Badge'
import { blockTitle, riskOf } from '../model/describe'
import type { BlockState, LoadedPr, Section } from '../model/types'
import { RiskDot, StatusIcon } from './StatusIcon'

interface OutlineProps {
  data: LoadedPr
  sections: Section[]
  states: Record<number, BlockState>
  stale: Record<number, string>
  current: number | null
  onGo(id: number): void
  /** Unresolved GitHub threads per block. */
  openThreads(id: number): number
  /** Blocks in files the reviewer owns (CODEOWNERS). */
  owned: Set<number>
}

export function Outline({ data, sections, states, stale, current, onGo, openThreads, owned }: OutlineProps) {
  const currentRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest' })
  }, [current])

  return (
    <nav aria-label="Chapters and blocks" className="overflow-auto border-r border-line pt-2 pb-6 [grid-area:outline]">
      {sections.map((s) => (
        <section key={s.key}>
          <div className="flex items-baseline gap-2 px-3.5 pt-3 pb-1 text-xs font-medium text-fg-subtle">
            <span className="truncate text-fg">{s.title}</span>
            <span className="ml-auto tabular-nums">
              {s.blocks.filter((id) => states[id]).length}/{s.blocks.length}
            </span>
          </div>
          {s.blocks.map((id) => {
            const b = data.blocks.get(id)!
            const isCurrent = current === id
            return (
              <button
                key={id}
                ref={isCurrent ? currentRef : undefined}
                aria-current={isCurrent}
                onClick={() => onGo(id)}
                className="grid w-full grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 border-l-2 border-transparent py-1 pr-3.5 pl-3 text-left text-fg-subtle hover:bg-surface hover:text-fg aria-[current=true]:border-accent aria-[current=true]:bg-raised aria-[current=true]:text-fg"
              >
                <StatusIcon state={states[id]} current={isCurrent} stale={!!stale[id]} />
                <span className="truncate">{blockTitle(data, b)}</span>
                <span className="inline-flex items-center gap-1.5 text-xs text-fg-faint tabular-nums">
                  {owned.has(id) && (
                    <Badge tone="accent" title="You own these files (CODEOWNERS)">
                      yours
                    </Badge>
                  )}
                  {openThreads(id) > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-fg-subtle" title={`${openThreads(id)} open GitHub threads`}>
                      <ThreadIcon />
                      {openThreads(id)}
                    </span>
                  )}
                  <RiskDot risk={riskOf(data, id)} /> {b.lines}
                </span>
              </button>
            )
          })}
        </section>
      ))}
    </nav>
  )
}
