import { useEffect, useRef } from 'react'
import { ThreadIcon } from '@/components/Icons'
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
}

export function Outline({ data, sections, states, stale, current, onGo, openThreads }: OutlineProps) {
  const currentRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest' })
  }, [current])

  return (
    <nav aria-label="Chapters and blocks" className="overflow-auto border-r border-seam pt-2 pb-6 [grid-area:outline]">
      {sections.map((s) => (
        <section key={s.key}>
          <div className="flex items-baseline gap-2 px-3.5 pt-3 pb-1 text-xs font-medium text-fog">
            <span className="truncate text-chalk">{s.title}</span>
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
                className="grid w-full grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 border-l-2 border-transparent py-[5px] pr-3.5 pl-3 text-left text-fog hover:bg-slate hover:text-chalk aria-[current=true]:border-periwinkle aria-[current=true]:bg-slate-2 aria-[current=true]:text-chalk"
              >
                <StatusIcon state={states[id]} current={isCurrent} stale={!!stale[id]} />
                <span className="truncate">{blockTitle(data, b)}</span>
                <span className="inline-flex items-center gap-1.5 text-[11.5px] text-dim tabular-nums">
                  {openThreads(id) > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-fog" title={`${openThreads(id)} open GitHub threads`}>
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
