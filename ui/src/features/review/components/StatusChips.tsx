import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { ago } from '@/lib/format'
import type { CheckRun } from '@/types/generated/CheckRun'
import type { PrStatus } from '@/types/generated/PrStatus'
import type { ReviewThread } from '@/types/generated/ReviewThread'
import type { Freshness } from '../hooks/useChecks'

const updated = (at: number | null) => {
  if (at === null) return ''
  const s = Date.now() / 1000 - at
  return s < 60 ? 'updated just now' : `updated ${ago(new Date(at * 1000).toISOString())}`
}

type Tone = 'danger' | 'warning' | 'success' | 'neutral'
type CheckState = 'failed' | 'running' | 'passed' | 'skipped'

const toneClass: Record<Tone, string> = {
  danger: 'border-danger/45 text-danger',
  warning: 'border-warning/45 text-warning',
  success: 'border-success/40 text-success',
  neutral: 'border-line-strong text-fg-muted',
}

function checkState(c: CheckRun): CheckState {
  if (c.status !== 'completed') return 'running'
  if (['failure', 'timed_out', 'action_required', 'cancelled'].includes(c.conclusion ?? '')) return 'failed'
  return c.conclusion === 'success' ? 'passed' : 'skipped'
}

const checkIcon: Record<CheckState, [string, string]> = { failed: ['✕', 'text-danger'], running: ['◌', 'text-warning'], passed: ['✓', 'text-success'], skipped: ['–', 'text-fg-faint'] }

export function StateBadge({ status }: { status: PrStatus | null }) {
  if (!status) return null
  const [label, tone]: [string, Tone] =
    status.state === 'MERGED' ? ['Merged', 'success'] : status.state === 'CLOSED' ? ['Closed', 'danger'] : status.isDraft ? ['Draft', 'neutral'] : ['Open', 'success']
  return <span className={cn('shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium', toneClass[tone])}>{label}</span>
}

function Chip({ tone, children, open, onClick, title }: { tone: Tone; children: ReactNode; open?: boolean; onClick?(): void; title?: string }) {
  const cls = cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs whitespace-nowrap', toneClass[tone], onClick && 'hover:bg-raised')
  return onClick ? (
    <button aria-expanded={open} onClick={onClick} title={title} className={cls}>
      {children}
      {open !== undefined && <span aria-hidden>{open ? '▴' : '▾'}</span>}
    </button>
  ) : (
    <span title={title} className={cls}>
      {children}
    </span>
  )
}

interface StatusChipsProps {
  status: PrStatus | null
  freshness: Freshness
  threads: ReviewThread[]
  onThread(file: string, line: number): void
}

/**
 * What needs attention on GitHub, as chips: failing and running checks, unresolved threads, requested
 * changes or reviews, merge problems. Everything that's fine stays in one quiet line on the right.
 */
export function StatusChips({ status, freshness, threads, onThread }: StatusChipsProps) {
  const [open, setOpen] = useState<'checks' | null>(null)
  if (!status) return <p className="mt-3 text-xs text-fg-faint">Loading the PR's status from GitHub…</p>
  const checks = status.checks.map((c) => ({ c, state: checkState(c) }))
  const count = (s: CheckState) => checks.filter((x) => x.state === s).length
  const counted = checks.length - count('skipped')
  const unresolved = threads.filter((t) => !t.resolved)
  const firstUnresolved = unresolved.find((t) => t.line && !t.outdated)
  const by = (state: string) => status.reviewers.filter((r) => r.state === state).map((r) => r.name)
  const changes = by('CHANGES_REQUESTED')
  const approved = by('APPROVED')
  const requested = by('REQUESTED')
  const commented = by('COMMENTED')
  const list = (names: string[]) => names.join(', ')
  const merge: [string, Tone] | null =
    status.state !== 'OPEN'
      ? null
      : status.mergeable === 'CONFLICTING' || status.mergeState === 'DIRTY'
        ? ['Has conflicts', 'danger']
        : status.mergeState === 'BEHIND'
          ? ['Behind the base branch', 'warning']
          : status.mergeState === 'BLOCKED' && !status.isDraft
            ? ['Merge blocked', 'warning']
            : null

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {count('failed') > 0 && (
          <Chip tone="danger" open={open === 'checks'} onClick={() => setOpen((o) => (o ? null : 'checks'))}>
            ✕ {count('failed')} {count('failed') === 1 ? 'check' : 'checks'} failed
          </Chip>
        )}
        {count('running') > 0 && (
          <Chip tone="warning" open={count('failed') ? undefined : open === 'checks'} onClick={count('failed') ? undefined : () => setOpen((o) => (o ? null : 'checks'))}>
            ◌ {count('running')} running
          </Chip>
        )}
        {changes.length > 0 && <Chip tone="danger">✕ changes requested: {list(changes)}</Chip>}
        {merge && <Chip tone={merge[1]}>{merge[0]}</Chip>}
        {unresolved.length > 0 && (
          <Chip tone="warning" onClick={firstUnresolved ? () => onThread(firstUnresolved.path, firstUnresolved.line!) : undefined} title={firstUnresolved ? 'Go to the first one' : undefined}>
            ● {unresolved.length} unresolved {unresolved.length === 1 ? 'thread' : 'threads'}
          </Chip>
        )}
        {requested.length > 0 && <Chip tone="neutral">◐ review requested: {list(requested)}</Chip>}
        {commented.length > 0 && <Chip tone="neutral">● {list(commented)} commented</Chip>}
        {approved.length > 0 && <Chip tone="success">✓ approved by {list(approved)}</Chip>}
        <span className="ml-auto flex items-center gap-2 text-xs text-fg-faint">
          {counted > 0 && (
            <button onClick={() => setOpen((o) => (o ? null : 'checks'))} className="hover:text-fg">
              ✓ {count('passed')} of {counted} checks passed
            </button>
          )}
          {counted === 0 && 'No checks reported'}
          <span>
            · {status.comments} {status.comments === 1 ? 'comment' : 'comments'}
          </span>
          <span title="From GitHub">· {freshness.checking ? 'checking for updates…' : updated(freshness.at)}</span>
        </span>
      </div>
      {open === 'checks' && (
        <ul className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-x-4 rounded-lg border border-line bg-canvas/40 px-3 py-2 text-sm">
          {[...checks]
            .sort((a, b) => ['failed', 'running', 'passed', 'skipped'].indexOf(a.state) - ['failed', 'running', 'passed', 'skipped'].indexOf(b.state))
            .map(({ c, state }) => (
              <li key={c.name + c.url}>
                <a href={c.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-sm py-0.5 hover:text-fg">
                  <span className={cn('w-4 text-center', checkIcon[state][1])}>{checkIcon[state][0]}</span>
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
