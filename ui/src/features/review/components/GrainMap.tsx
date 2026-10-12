import type { CSSProperties } from 'react'
import { cn } from '@/lib/cn'
import { blockTitle, riskOf } from '../model/describe'
import type { BlockState, LoadedPr, Section } from '../model/types'

interface GrainMapProps {
  data: LoadedPr
  sections: Section[]
  states: Record<number, BlockState>
  current: number | null
  onGo(id: number): void
}

const grain: Record<string, string> = {
  ok: 'var(--color-sage)',
  change: 'var(--color-coral)',
  skim: '#343842',
  todo: '#3a3f4a',
}

/** The whole PR as wood grain: one band per block, height by size, filled in as it's reviewed. */
export function GrainMap({ data, sections, states, current, onGo }: GrainMapProps) {
  return (
    <nav aria-label="PR map" className="flex min-h-0 flex-col gap-[9px] border-r border-seam px-[7px] py-2.5 [grid-area:map]">
      {sections.map((s) => {
        const lines = s.blocks.reduce((n, id) => n + (data.blocks.get(id)?.lines ?? 0), 0)
        return (
          <div key={s.key} className="flex min-h-0 flex-col gap-0.5" style={{ flex: `${Math.max(lines, 1)} 1 0` }}>
            {s.blocks.map((id) => {
              const b = data.blocks.get(id)!
              const title = blockTitle(data, b)
              const style = { flex: `${Math.max(b.lines, 1)} 1 0`, '--grain': grain[states[id] ?? (b.skim ? 'skim' : 'todo')] } as CSSProperties
              return (
                <button
                  key={id}
                  title={`${title} (${b.lines} lines)`}
                  aria-label={title}
                  onClick={() => onGo(id)}
                  style={style}
                  className={cn(
                    'relative min-h-[3px] w-full rounded-[1px] opacity-90 hover:opacity-100',
                    b.skim && !states[id] ? 'grain-hatch' : 'grain-stripes',
                    riskOf(data, id) === 'high' && 'after:absolute after:inset-y-0 after:-right-[5px] after:w-0.5 after:rounded-[1px] after:bg-coral',
                    current === id && 'opacity-100 outline-[1.5px] outline-offset-2 outline-periwinkle',
                  )}
                />
              )
            })}
          </div>
        )
      })}
    </nav>
  )
}
