import { Button } from '@/components/ui/Button'
import { Kbd } from '@/components/ui/Kbd'
import { cn } from '@/lib/cn'
import type { Diagnostics } from '@/types/generated/Diagnostics'
import type { Problem } from '../model/problems'

interface ProblemsPillProps {
  problems: Problem[]
  report: Diagnostics | null
  diagnosing: boolean
  onNext(): void
  onChooseClone(): void
  /** No work folders set, so Grain can't find the reviewer's clones. */
  noWorkFolders: boolean
  onAddWorkFolder(): void
}

/** Top bar: how many errors and warnings the PR's changed lines have; click or `e` jumps to the next. */
export function ProblemsPill({ problems, report, diagnosing, onNext, onChooseClone, noWorkFolders, onAddWorkFolder }: ProblemsPillProps) {
  if (diagnosing && !problems.length) return <span className="text-xs whitespace-nowrap text-fg-faint">Checking for errors…</span>
  if (report?.unavailable && !problems.length && noWorkFolders)
    return (
      <Button size="sm" variant="ghost" title="Grain finds your local clones in your work folders and checks the PR with their TypeScript and lint setup" onClick={onAddWorkFolder} className="whitespace-nowrap text-warning">
        Errors: add a work folder
      </Button>
    )
  if (report?.unavailable && !problems.length)
    return (
      <Button size="sm" variant="ghost" title={report.unavailable} onClick={onChooseClone} className="text-warning">
        Errors: choose your clone
      </Button>
    )
  const errors = problems.filter((p) => p.severity === 'error').length
  const warnings = problems.length - errors
  const checked = report?.tools.filter((t) => t.ok).map((t) => t.name) ?? []
  const failed = report?.tools.filter((t) => !t.ok) ?? []
  const title = [checked.length ? `Checked with ${checked.join(', ')}` : '', ...failed.map((t) => `${t.name} didn't run: ${t.note ?? ''}`)].filter(Boolean).join('\n')
  if (!problems.length) return report ? <span title={title} className="text-xs whitespace-nowrap text-success">No errors</span> : null
  return (
    <button
      onClick={onNext}
      title={`${title}\nNext problem (e)`}
      className={cn('flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs whitespace-nowrap', errors ? 'border-danger/50 text-danger' : 'border-warning/50 text-warning')}
    >
      <span className={cn('size-1.5 rounded-full', errors ? 'bg-danger' : 'bg-warning')} />
      {errors > 0 && `${errors} ${errors === 1 ? 'error' : 'errors'}`}
      {errors > 0 && warnings > 0 && ' · '}
      {warnings > 0 && `${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`}
      <Kbd>e</Kbd>
    </button>
  )
}
