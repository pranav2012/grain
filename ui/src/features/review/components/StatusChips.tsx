import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import type { CheckRun } from '@/types/generated/CheckRun'
import type { PrStatus } from '@/types/generated/PrStatus'
import type { ReviewThread } from '@/types/generated/ReviewThread'

interface StatusStripProps {
  status: PrStatus | null
  files: number
  tests: number
  added: number
  removed: number
  threads: ReviewThread[]
}

const reviewState: Record<string, [string, string, string]> = {
  APPROVED: ['✓', 'text-success', 'Approved'],
  CHANGES_REQUESTED: ['✕', 'text-danger', 'Requested changes'],
  COMMENTED: ['●', 'text-fg-subtle', 'Commented'],
  DISMISSED: ['○', 'text-fg-faint', 'Review dismissed'],
  REQUESTED: ['◐', 'text-warning', 'Review requested'],
}

type Tone = 'failed' | 'running' | 'passed' | 'skipped'

function checkTone(c: CheckRun): Tone {
  if (c.status !== 'completed') return 'running'
  if (['failure', 'timed_out', 'action_required', 'cancelled'].includes(c.conclusion ?? '')) return 'failed'
  return c.conclusion === 'success' ? 'passed' : 'skipped'
}

const checkIcon: Record<Tone, [string, string]> = { failed: ['✕', 'text-danger'], running: ['◌', 'text-warning'], passed: ['✓', 'text-success'], skipped: ['–', 'text-fg-faint'] }

function mergeLine(s: PrStatus): [string, string] {
  if (s.state === 'MERGED') return ['Merged', 'text-accent']
  if (s.state === 'CLOSED') return ['Closed without merging', 'text-fg-subtle']
  if (s.isDraft) return ['Draft', 'text-fg-subtle']
  if (s.mergeable === 'CONFLICTING' || s.mergeState === 'DIRTY') return ['Has conflicts', 'text-danger']
  switch (s.mergeState) {
    case 'CLEAN':
    case 'HAS_HOOKS':
      return ['Can merge', 'text-success']
    case 'BLOCKED':
      return ['Blocked: needs approvals or checks', 'text-warning']
    case 'BEHIND':
      return ['Behind the base branch', 'text-warning']
    case 'UNSTABLE':
      return ['Can merge, some checks failed', 'text-warning']
    default:
      return ['Checking mergeability…', 'text-fg-subtle']
  }
}

/** One item of the strip; with `details`, a click opens them below the strip. */
function Item({ label, children, details, open, onToggle }: { label: string; children: ReactNode; details?: ReactNode; open?: boolean; onToggle?(): void }) {
  const body = (
    <>
      <span className="text-2xs font-semibold tracking-wide text-fg-faint uppercase">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5">{children}</span>
    </>
  )
  return details ? (
    <button aria-expanded={open} onClick={onToggle} className="flex min-w-0 flex-col items-start gap-0.5 rounded-md px-2.5 py-1 text-left hover:bg-raised aria-expanded:bg-raised">
      {body}
    </button>
  ) : (
    <div className="flex min-w-0 flex-col gap-0.5 px-2.5 py-1">{body}</div>
  )
}

/** One row under the PR title: size, reviewers, discussion, CI and merge state; reviewers and checks expand. */
export function StatusStrip({ status, files, tests, added, removed, threads }: StatusStripProps) {
  const [open, setOpen] = useState<'reviewers' | 'checks' | null>(null)
  const toggle = (k: 'reviewers' | 'checks') => setOpen((o) => (o === k ? null : k))
  const unresolved = threads.filter((t) => !t.resolved).length
  const checks = (status?.checks ?? []).map((c) => ({ c, tone: checkTone(c) }))
  const count = (t: Tone) => checks.filter((x) => x.tone === t).length
  const [merge, mergeTone] = status ? mergeLine(status) : ['Loading…', 'text-fg-faint']

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-stretch gap-x-1 gap-y-1 rounded-lg border border-line bg-canvas/40 p-1 text-sm [&>*+*]:border-l [&>*+*]:border-line">
        <Item label="Changes">
          {files} {files === 1 ? 'file' : 'files'} <span className="text-success">+{added}</span> <span className="text-danger">−{removed}</span>
          {tests > 0 && <span className="text-fg-faint">· {tests} tests</span>}
        </Item>
        {status && (
          <>
            <Item label="Reviewers" details={status.reviewers.length > 0} open={open === 'reviewers'} onToggle={() => toggle('reviewers')}>
              {status.reviewers.length === 0 && <span className="text-fg-faint">None yet</span>}
              {status.reviewers.slice(0, 3).map((r) => {
                const [icon, tone, label] = reviewState[r.state] ?? ['●', 'text-fg-subtle', r.state]
                return (
                  <span key={r.name} title={`${r.name}: ${label}`} className="flex min-w-0 items-center gap-1">
                    <span className={tone}>{icon}</span>
                    <span className="max-w-[14ch] truncate">{r.name}</span>
                  </span>
                )
              })}
              {status.reviewers.length > 3 && <span className="text-fg-faint">+{status.reviewers.length - 3}</span>}
            </Item>
            <Item label="Discussion">
              {status.comments ? `${status.comments} ${status.comments === 1 ? 'comment' : 'comments'}` : 'No comments'}
              {unresolved > 0 && <span className="text-warning">· {unresolved} unresolved</span>}
            </Item>
            <Item label="Checks" details={checks.length > 0} open={open === 'checks'} onToggle={() => toggle('checks')}>
              {checks.length === 0 && <span className="text-fg-faint">None reported</span>}
              {count('failed') > 0 && <span className="text-danger">✕ {count('failed')} failed</span>}
              {count('running') > 0 && <span className="text-warning">◌ {count('running')} running</span>}
              {checks.length > 0 && (
                <span className="text-fg-muted">
                  ✓ {count('passed')}/{checks.length - count('skipped')}
                </span>
              )}
            </Item>
            <Item label="Merge">
              <span className={mergeTone}>{merge}</span>
            </Item>
          </>
        )}
      </div>
      {open === 'reviewers' && status && (
        <ul className="mt-1.5 grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-4 rounded-lg border border-line bg-canvas/40 px-3 py-2 text-sm">
          {status.reviewers.map((r) => {
            const [icon, tone, label] = reviewState[r.state] ?? ['●', 'text-fg-subtle', r.state]
            return (
              <li key={r.name} className="flex items-center gap-2 py-0.5">
                <span className={cn('w-4 text-center', tone)}>{icon}</span>
                <span className="truncate">{r.name}</span>
                <span className="ml-auto shrink-0 text-xs text-fg-faint">{label}</span>
              </li>
            )
          })}
        </ul>
      )}
      {open === 'checks' && (
        <ul className="mt-1.5 grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-4 rounded-lg border border-line bg-canvas/40 px-3 py-2 text-sm">
          {[...checks].sort((a, b) => ['failed', 'running', 'passed', 'skipped'].indexOf(a.tone) - ['failed', 'running', 'passed', 'skipped'].indexOf(b.tone)).map(({ c, tone }) => (
            <li key={c.name + c.url}>
              <a href={c.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-sm py-0.5 hover:text-fg">
                <span className={cn('w-4 text-center', checkIcon[tone][1])}>{checkIcon[tone][0]}</span>
                <span className="truncate">{c.name}</span>
                {c.annotations.length > 0 && <span className="ml-auto shrink-0 text-xs text-fg-faint">{c.annotations.length} notes</span>}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
