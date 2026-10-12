import type { ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Kbd } from '@/components/ui/Kbd'
import { Progress } from '@/components/ui/Progress'
import { SectionLabel } from '@/components/ui/SectionLabel'
import { cn } from '@/lib/cn'
import { formatMinutes, joinList, minutesFor } from '@/lib/format'
import { stageHelp, stepLines, stepState, stepTitle } from '../model/steps'
import type { BlockState, LoadedPr, Stage, Step } from '../model/types'

interface OverviewProps {
  data: LoadedPr
  stages: Stage[]
  states: Record<number, BlockState>
  /** The step to continue from: the first one not reviewed yet. */
  resume?: Step
  /** What the PR does, written by the reviewer's agent; only when AI is on. */
  summary?: ReactNode
  onOpenStage(stage: Stage): void
  onOpenStep(step: Step): void
}

/** What the whole PR changes, from the code alone: where the lines are and in which areas. */
function factsSummary(data: LoadedPr, stages: Stage[]): string {
  const total = stages.reduce((n, s) => n + s.steps.reduce((m, st) => m + stepLines(data, st), 0), 0) || 1
  const shares = stages
    .filter((s) => s.name !== 'Skim')
    .map((s) => [s.name, Math.round((100 * s.steps.reduce((m, st) => m + stepLines(data, st), 0)) / total)] as const)
    .filter(([, pct]) => pct >= 10)
    .sort((a, b) => b[1] - a[1])
    .map(([name, pct]) => `${name.toLowerCase()} (${pct}%)`)
  const areas = new Map<string, number>()
  for (const b of data.blocks.values()) {
    if (b.skim) continue
    const area = b.dir.split('/').filter((s) => !/^(src|lib|app|packages?|features?|modules?|components?)$/.test(s)).slice(0, 1)[0]
    if (area) areas.set(area, (areas.get(area) ?? 0) + b.lines)
  }
  const top = [...areas].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a]) => a)
  const skim = stages.find((s) => s.name === 'Skim')?.steps.reduce((n, s) => n + s.blocks.length, 0) ?? 0
  return [
    shares.length && `Mostly ${joinList(shares)}`,
    top.length && `${shares.length ? 'in' : 'Changes in'} ${joinList(top)}`,
  ]
    .filter(Boolean)
    .join(', ')
    .concat('.', skim ? ` ${skim} low-attention changes go to Skim.` : '')
}

/** First screen of a review: what the PR does and the stages to read it in. */
export function Overview({ data, stages, states, resume, summary, onOpenStage, onOpenStep }: OverviewProps) {
  const steps = stages.flatMap((s) => s.steps)
  const done = steps.filter((s) => stepState(s, states) === 'done').length
  const left = steps.filter((s) => stepState(s, states) !== 'done').reduce((n, s) => n + stepLines(data, s), 0)

  return (
    <main className="min-h-0 overflow-auto px-8 py-7 [grid-area:main]">
      <div className="mx-auto max-w-[920px]">
        <SectionLabel>{data.pr?.title ?? data.id}</SectionLabel>
        <h1 className="mt-1 mb-2 text-xl font-semibold tracking-[-0.015em]">What this pull request does</h1>
        <div className="max-w-[75ch] leading-relaxed text-fg-muted">{summary ?? <p>{factsSummary(data, stages)}</p>}</div>
        <p className="mt-2 text-xs text-fg-subtle">
          {steps.length} steps in {stages.length} stages. Each stage only builds on the stages before it.
          {done > 0 && ` ${done} reviewed, about ${formatMinutes(minutesFor(left))} left.`}
        </p>

        <ol className="my-5 grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2.5">
          {stages.map((stage, i) => {
            const ok = stage.steps.filter((s) => stepState(s, states) === 'done').length
            const change = stage.steps.some((s) => stepState(s, states) === 'change')
            const complete = ok === stage.steps.length
            return (
              <li key={stage.name}>
                <Card className="h-full cursor-pointer p-3.5 hover:bg-raised" onClick={() => onOpenStage(stage)}>
                  <div className="flex items-baseline gap-2">
                    <span
                      className={cn(
                        'inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-line text-2xs text-fg-subtle',
                        complete && 'border-success bg-success text-fg-on-strong',
                        change && 'border-danger text-danger',
                      )}
                    >
                      {complete ? '✓' : i + 1}
                    </span>
                    <span className="font-medium text-fg">{stage.name}</span>
                    <span className="ml-auto text-xs text-fg-faint tabular-nums">
                      {ok ? `${ok}/` : ''}
                      {stage.steps.length} {stage.steps.length === 1 ? 'step' : 'steps'}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-fg-subtle">{stageHelp[stage.name] ?? stage.name}</p>
                  <p className="mt-0.5 truncate font-mono text-xs text-fg-faint" title={stage.about}>
                    {stage.about}
                  </p>
                  <Progress className="mt-3" ok={ok / stage.steps.length} />
                </Card>
              </li>
            )
          })}
        </ol>

        {resume ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={() => onOpenStep(resume)}>
              {done ? 'Continue' : 'Start reviewing'}: {stepTitle(data, resume)} → <Kbd>space</Kbd>
            </Button>
            <span className="text-xs text-fg-faint">Or pick any stage to jump there.</span>
          </div>
        ) : (
          <p className="text-success">Every step is reviewed. Finish the review when you're ready.</p>
        )}
      </div>
    </main>
  )
}
