import type { CSSProperties } from 'react'
import { cn } from '@/lib/cn'
import { blockTitle, riskOf } from '../model/describe'
import type { BlockState, LoadedPr, Section } from '../model/types'

interface GrainMapProps {
  data: LoadedPr
  sections: Section[]
  section: Section
  states: Record<number, BlockState>
  stale: Record<number, string>
  current: number | null
  onGo(id: number): void
}

const grain: Record<string, string> = {
  ok: 'var(--color-success)',
  change: 'var(--color-danger)',
  skim: 'var(--color-line)',
  stale: 'var(--color-warning)',
  todo: 'var(--color-line-strong)',
}

/** The whole PR as wood grain: one band per block, height by size, filled in as it's reviewed. */
export function GrainMap({ data, sections, section, states, stale, current, onGo }: GrainMapProps) {
  // Big PRs have hundreds of layers: drop the gaps so every band still fits on screen.
  const dense = sections.length > 24 || data.blocks.size > 120
  return (
    <nav aria-label="PR map" className={cn('flex min-h-0 flex-col border-r border-line px-1.5 py-2.5 [grid-area:map]', dense ? 'gap-px' : 'gap-2')}>
      {sections.map((s) => {
        const lines = s.blocks.reduce((n, id) => n + (data.blocks.get(id)?.lines ?? 0), 0)
        return (
          <div
            key={s.key}
            className={cn('-mx-1 flex min-h-0 flex-col rounded-xs px-1', dense ? 'gap-0' : 'gap-0.5', s.key === section.key && 'bg-raised')}
            style={{ flex: `${Math.max(lines, 1)} 1 0` }}
          >
            {s.blocks.map((id) => {
              const b = data.blocks.get(id)!
              const title = blockTitle(data, b)
              const style = { flex: `${Math.max(b.lines, 1)} 1 0`, '--grain': grain[states[id] ?? (stale[id] ? 'stale' : b.skim ? 'skim' : 'todo')] } as CSSProperties
              return (
                <button
                  key={id}
                  title={`${title} (${b.lines} lines)`}
                  aria-label={title}
                  onClick={() => onGo(id)}
                  style={style}
                  className={cn(
                    'relative w-full rounded-xs opacity-90 hover:opacity-100',
                    dense ? 'min-h-px' : 'min-h-[3px]',
                    b.skim && !states[id] ? 'grain-hatch' : 'grain-stripes',
                    riskOf(data, id) === 'high' && 'after:absolute after:inset-y-0 after:-right-[5px] after:w-0.5 after:rounded-xs after:bg-danger',
                    current === id && 'opacity-100 outline-[1.5px] outline-offset-2 outline-accent',
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
