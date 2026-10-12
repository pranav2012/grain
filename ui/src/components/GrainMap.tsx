import type { LoadedPr, Section } from '../data'
import { blockTitle, riskOf } from '../data'
import type { BlockState } from '../types'

interface Props {
  data: LoadedPr
  sections: Section[]
  states: Record<number, BlockState>
  current: number | null
  onGo(id: number): void
}

/** The whole PR as wood grain: one band per block, height by size, filled in as it's reviewed. */
export function GrainMap({ data, sections, states, current, onGo }: Props) {
  return (
    <nav className="map" aria-label="PR map">
      {sections.map((s) => {
        const lines = s.blocks.reduce((n, id) => n + (data.blocks.get(id)?.lines ?? 0), 0)
        return (
          <div key={s.key} className="map-chapter" style={{ flex: `${Math.max(lines, 1)} 1 0` }}>
            {s.blocks.map((id) => {
              const b = data.blocks.get(id)!
              const cls = [
                'grain',
                states[id] ?? '',
                b.skim ? 'skim' : '',
                riskOf(data, id) === 'high' ? 'risk-high' : '',
                current === id ? 'current' : '',
              ].join(' ')
              return (
                <button
                  key={id}
                  className={cls}
                  style={{ flex: `${Math.max(b.lines, 1)} 1 0` }}
                  title={`${blockTitle(data, b)} (${b.lines} lines)`}
                  aria-label={blockTitle(data, b)}
                  onClick={() => onGo(id)}
                />
              )
            })}
          </div>
        )
      })}
    </nav>
  )
}
