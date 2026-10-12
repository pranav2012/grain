import { useEffect, useRef } from 'react'
import type { LoadedPr, Section } from '../data'
import { blockTitle, riskOf } from '../data'
import type { BlockState } from '../types'
import { RiskDot, StatusIcon } from './Icons'

interface Props {
  data: LoadedPr
  sections: Section[]
  states: Record<number, BlockState>
  current: number | null
  onGo(id: number): void
}

export function Outline({ data, sections, states, current, onGo }: Props) {
  const currentRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest' })
  }, [current])

  return (
    <nav className="outline" aria-label="Chapters and blocks">
      {sections.map((s) => {
        const done = s.blocks.filter((id) => states[id]).length
        return (
          <section key={s.key}>
            <div className="chapter-head">
              <span>{s.title}</span>
              <span className="count">
                {done}/{s.blocks.length}
              </span>
            </div>
            {s.blocks.map((id) => {
              const b = data.blocks.get(id)!
              const isCurrent = current === id
              return (
                <button key={id} ref={isCurrent ? currentRef : undefined} className="row" aria-current={isCurrent} onClick={() => onGo(id)}>
                  <StatusIcon state={states[id]} current={isCurrent} />
                  <span className="title">{blockTitle(data, b)}</span>
                  <span className="lines">
                    <RiskDot risk={riskOf(data, id)} /> {b.lines}
                  </span>
                </button>
              )
            })}
          </section>
        )
      })}
    </nav>
  )
}
