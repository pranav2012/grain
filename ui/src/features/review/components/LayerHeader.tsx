import { Badge } from '@/components/ui/Badge'
import { Button, LinkButton } from '@/components/ui/Button'
import { InlineCode } from '@/components/ui/InlineCode'
import { Kbd } from '@/components/ui/Kbd'
import { cn } from '@/lib/cn'
import { formatMinutes, minutesFor } from '@/lib/format'
import type { Layer } from '@/types/generated/Layer'
import { layerSummaryOf, layerTitle } from '../model/describe'
import { sectionLabel } from '../model/sections'
import type { BlockState, LoadedPr, Section } from '../model/types'

interface LayerHeaderProps {
  data: LoadedPr
  section: Section
  /** Position of this section in reading order, from 1, and how many there are. */
  step: number
  steps: number
  current: number
  states: Record<number, BlockState>
  onStep(d: number): void
  onGo(id: number): void
  onOpenLayer(id: number): void
  agentName: string | null
  summaryPending: boolean
  onSummarize(): void
}

const blurb: Record<'mine' | 'skim', string> = {
  mine: 'Blocks in files you own, from every layer.',
  skim: 'Low-attention changes: lockfiles, generated files, moves and repeated edits. Skim and confirm.',
}

/** Main-column header: which layer this is, how it connects to others, and stepping between layers. */
export function LayerHeader(p: LayerHeaderProps) {
  const { data, section } = p
  const layer = section.layer
  const lines = section.blocks.reduce((n, id) => n + (data.blocks.get(id)?.lines ?? 0), 0)
  const summary = layer && layerSummaryOf(data, layer)
  const usedBy = layer ? data.review.layers.filter((l) => l.uses.includes(layer.id)).map((l) => l.id) : []

  return (
    <section aria-label="Current layer" className="border-b border-line bg-surface/40 px-6 py-2.5 [grid-area:layer]">
      <div className="flex items-center gap-2.5">
        <Badge tone="accent">{sectionLabel(section)}</Badge>
        {layer && <span className="text-xs text-fg-subtle">{layer.role}</span>}
        <span className="min-w-0 truncate font-medium text-fg" title={layer ? layerTitle(data, layer) : section.title}>
          {layer ? layerTitle(data, layer) : blurb[section.kind as 'mine' | 'skim']}
        </span>
        <span className="text-xs whitespace-nowrap text-fg-faint">
          {lines} lines, about {formatMinutes(minutesFor(lines))}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <BlockPips section={section} current={p.current} states={p.states} onGo={p.onGo} />
          <span className="text-xs whitespace-nowrap text-fg-subtle tabular-nums">
            {p.step} of {p.steps}
          </span>
          <Button size="sm" variant="ghost" onClick={() => p.onStep(-1)} disabled={p.step === 1} title="Previous layer (Shift K)">
            ← <Kbd>⇧K</Kbd>
          </Button>
          <Button size="sm" onClick={() => p.onStep(1)} disabled={p.step === p.steps} title="Next layer (Shift J)">
            Next layer <Kbd>⇧J</Kbd>
          </Button>
        </div>
      </div>

      {layer && (layer.uses.length > 0 || usedBy.length > 0 || p.agentName || summary) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-subtle">
          <LayerLinks label="Builds on" ids={layer.uses} layers={data.review.layers} data={data} onOpen={p.onOpenLayer} />
          <LayerLinks label="Used by" ids={usedBy} layers={data.review.layers} data={data} onOpen={p.onOpenLayer} />
          {p.agentName && !summary && (
            <LinkButton onClick={p.onSummarize} disabled={p.summaryPending} className="ml-auto">
              {p.summaryPending ? `Explaining with ${p.agentName}…` : `Explain this layer with ${p.agentName}`} <Kbd>⇧A</Kbd>
            </LinkButton>
          )}
        </div>
      )}

      {summary && (
        <div className="mt-2 max-w-[90ch] text-sm leading-relaxed text-fg-muted">
          <p>
            <InlineCode text={summary.intent} />
          </p>
          {summary.walkthrough.length > 0 && (
            <ol className="mt-1 list-inside list-decimal text-fg-subtle marker:text-fg-faint">
              {summary.walkthrough.map((s) => (
                <li key={s}>
                  <InlineCode text={s} />
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  )
}

function LayerLinks({ label, ids, layers, data, onOpen }: { label: string; ids: number[]; layers: Layer[]; data: LoadedPr; onOpen(id: number): void }) {
  if (!ids.length) return null
  const shown = ids.slice(0, 4)
  return (
    <span className="inline-flex items-center gap-1.5">
      {label}
      {shown.map((id) => {
        const l = layers.find((x) => x.id === id)
        return (
          <LinkButton key={id} onClick={() => onOpen(id)} title={l ? layerTitle(data, l) : undefined}>
            Layer {id}
          </LinkButton>
        )
      })}
      {ids.length > shown.length && <span className="text-fg-faint">+{ids.length - shown.length}</span>}
    </span>
  )
}

/** One dot per block in the section: reviewed, needs changes, current or open. */
function BlockPips({ section, current, states, onGo }: { section: Section; current: number; states: Record<number, BlockState>; onGo(id: number): void }) {
  if (section.blocks.length > 12) return null
  return (
    <span className="flex items-center gap-1" aria-hidden>
      {section.blocks.map((id) => (
        <button
          key={id}
          tabIndex={-1}
          onClick={() => onGo(id)}
          className={cn(
            'h-1.5 w-3 rounded-xs',
            states[id] === 'ok' ? 'bg-success' : states[id] === 'change' ? 'bg-danger' : 'bg-line-strong',
            id === current && 'outline-1 outline-offset-1 outline-accent',
          )}
        />
      ))}
    </span>
  )
}
