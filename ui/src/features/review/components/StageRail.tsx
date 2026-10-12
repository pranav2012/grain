import { Progress } from '@/components/ui/Progress'
import { SectionLabel } from '@/components/ui/SectionLabel'
import { cn } from '@/lib/cn'
import { stepState } from '../model/steps'
import type { BlockState, Stage } from '../model/types'

interface StageRailProps {
  stages: Stage[]
  current: Stage | null
  states: Record<number, BlockState>
  onOverview(): void
  onOpenStage(stage: Stage): void
}

/** Left rail: only the stages and how far along each is. */
export function StageRail({ stages, current, states, onOverview, onOpenStage }: StageRailProps) {
  const steps = stages.flatMap((s) => s.steps)
  const done = steps.filter((s) => stepState(s, states) === 'done').length
  const row =
    'flex w-full items-center gap-2 rounded-md border-l-2 border-transparent px-2.5 py-1.5 text-left text-fg-subtle hover:bg-surface hover:text-fg aria-[current=true]:border-accent aria-[current=true]:bg-raised aria-[current=true]:text-fg'
  return (
    <nav aria-label="Stages" className="flex min-h-0 flex-col gap-0.5 overflow-auto border-r border-line px-2 py-3 [grid-area:rail]">
      <button className={row} aria-current={current === null} onClick={onOverview}>
        Overview
      </button>
      <SectionLabel className="mt-3 mb-1 px-2.5">Stages</SectionLabel>
      {stages.map((stage) => {
        const ok = stage.steps.filter((s) => stepState(s, states) === 'done').length
        const complete = ok === stage.steps.length
        const change = stage.steps.some((s) => stepState(s, states) === 'change')
        return (
          <button key={stage.name} className={row} aria-current={current?.name === stage.name} onClick={() => onOpenStage(stage)}>
            <span className={cn('min-w-0 flex-1 truncate', complete && 'text-success', change && 'text-danger')}>
              {complete && '✓ '}
              {stage.name}
            </span>
            <span className="text-xs text-fg-faint tabular-nums">{ok && !complete ? `${ok}/${stage.steps.length}` : stage.steps.length}</span>
          </button>
        )
      })}
      <div className="mt-auto px-2.5 pt-4">
        <Progress ok={done / Math.max(steps.length, 1)} />
        <p className="mt-1.5 text-xs text-fg-faint">
          {done} of {steps.length} steps reviewed
        </p>
      </div>
    </nav>
  )
}
