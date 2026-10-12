import { useEffect, useRef } from 'react'
import { ThreadIcon } from '@/components/Icons'
import { Badge } from '@/components/ui/Badge'
import { SectionLabel } from '@/components/ui/SectionLabel'
import { cn } from '@/lib/cn'
import { blockTitle, layerTitle, riskOf } from '../model/describe'
import { sectionLabel } from '../model/sections'
import type { BlockState, LoadedPr, Section } from '../model/types'
import { RiskDot, StatusIcon } from './StatusIcon'

interface OutlineProps {
  data: LoadedPr
  sections: Section[]
  section: Section
  states: Record<number, BlockState>
  stale: Record<number, string>
  current: number | null
  onGo(id: number): void
  /** Opens a section at its first unreviewed block. */
  onOpenSection(s: Section): void
  /** Unresolved GitHub threads per block. */
  openThreads(id: number): number
  /** Blocks in files the reviewer owns (CODEOWNERS). */
  owned: Set<number>
}

type SectionState = 'done' | 'change' | 'started' | 'todo'

function sectionState(s: Section, states: Record<number, BlockState>): SectionState {
  const marked = s.blocks.filter((id) => states[id])
  if (s.blocks.some((id) => states[id] === 'change')) return 'change'
  if (marked.length === s.blocks.length) return 'done'
  return marked.length ? 'started' : 'todo'
}

const rowClass =
  'grid w-full items-center gap-2 border-l-2 border-transparent py-1 pr-3.5 pl-3 text-left text-fg-subtle hover:bg-surface hover:text-fg aria-[current=true]:border-accent aria-[current=true]:bg-raised aria-[current=true]:text-fg'

/** Left column: the current layer's blocks, then every layer as one row with its progress. */
export function Outline({ data, sections, section, states, stale, current, onGo, onOpenSection, openThreads, owned }: OutlineProps) {
  const currentRef = useRef<HTMLButtonElement>(null)
  const sectionRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest' })
  }, [current])
  useEffect(() => {
    sectionRef.current?.scrollIntoView({ block: 'nearest' })
  }, [section.key])
  const done = section.blocks.filter((id) => states[id]).length

  return (
    <nav aria-label="Layers and blocks" className="flex min-h-0 flex-col border-r border-line [grid-area:outline]">
      <div className="shrink-0 border-b border-line pt-3 pb-2">
        <div className="flex items-baseline gap-2 px-3.5 pb-1.5">
          <SectionLabel>{section.kind === 'layer' ? 'This layer' : section.title}</SectionLabel>
          <span className="ml-auto text-xs text-fg-subtle tabular-nums">
            {done}/{section.blocks.length} reviewed
          </span>
        </div>
        <div className="max-h-[42vh] overflow-auto">
          {section.blocks.map((id) => {
            const b = data.blocks.get(id)!
            const isCurrent = current === id
            return (
              <button
                key={id}
                ref={isCurrent ? currentRef : undefined}
                aria-current={isCurrent}
                onClick={() => onGo(id)}
                className={cn(rowClass, 'grid-cols-[16px_minmax(0,1fr)_auto]')}
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
        </div>
      </div>

      <div className="flex items-baseline px-3.5 pt-3 pb-1">
        <SectionLabel>All layers</SectionLabel>
        <span className="ml-auto text-xs text-fg-faint tabular-nums">
          {sections.filter((s) => sectionState(s, states) === 'done').length}/{sections.length} done
        </span>
      </div>
      <ol className="min-h-0 flex-1 overflow-auto pb-6">
        {sections.map((s) => {
          const st = sectionState(s, states)
          const isCurrent = s.key === section.key
          const lines = s.blocks.reduce((n, id) => n + (data.blocks.get(id)?.lines ?? 0), 0)
          return (
            <li key={s.key}>
              <button
                ref={isCurrent ? sectionRef : undefined}
                aria-current={isCurrent}
                onClick={() => onOpenSection(s)}
                title={s.layer ? `${s.layer.role}: ${layerTitle(data, s.layer)}` : s.title}
                className={cn(rowClass, 'grid-cols-[minmax(40px,auto)_minmax(0,1fr)_auto]')}
              >
                <span className={cn('inline-flex items-center gap-1.5 text-xs tabular-nums', st === 'done' && 'text-success', st === 'change' && 'text-danger')}>
                  <LayerPip state={st} />
                  {s.kind === 'layer' ? s.layer!.id : sectionLabel(s)}
                </span>
                <span className="truncate">{s.layer ? layerTitle(data, s.layer) : s.title}</span>
                <span className="inline-flex items-center gap-1.5 text-xs text-fg-faint tabular-nums">
                  {s.blocks.some((id) => riskOf(data, id) === 'high') && <RiskDot risk="high" />}
                  {lines}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

const pipLabel: Record<SectionState, string> = { done: 'Reviewed', change: 'Changes requested', started: 'In progress', todo: 'Not started' }

/** Small progress mark for a layer row: empty, half, full, or needs changes. */
function LayerPip({ state }: { state: SectionState }) {
  return (
    <span
      role="img"
      aria-label={pipLabel[state]}
      className={cn(
        'inline-block size-2 shrink-0 rounded-full border',
        state === 'done' && 'border-success bg-success',
        state === 'change' && 'border-danger bg-danger',
        state === 'started' && 'border-fg-subtle bg-[linear-gradient(90deg,var(--color-fg-subtle)_50%,transparent_50%)]',
        state === 'todo' && 'border-fg-faint',
      )}
    />
  )
}
