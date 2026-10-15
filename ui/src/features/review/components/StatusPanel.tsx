import { useState } from 'react'
import { LinkButton } from '@/components/ui/Button'
import { SectionLabel } from '@/components/ui/SectionLabel'
import { cn } from '@/lib/cn'
import type { CheckRun } from '@/types/generated/CheckRun'
import type { PrStatus } from '@/types/generated/PrStatus'
import type { ReviewThread } from '@/types/generated/ReviewThread'

interface StatusPanelProps {
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

function checkTone(c: CheckRun): 'failed' | 'running' | 'passed' | 'skipped' {
  if (c.status !== 'completed') return 'running'
  if (['failure', 'timed_out', 'action_required', 'cancelled'].includes(c.conclusion ?? '')) return 'failed'
  return c.conclusion === 'success' ? 'passed' : 'skipped'
}

const checkIcon = { failed: ['✕', 'text-danger'], running: ['◌', 'text-warning'], passed: ['✓', 'text-success'], skipped: ['–', 'text-fg-faint'] } as const

/** Markdown read as plain text: heading marks, emphasis and HTML comments dropped. */
const plain = (md: string) =>
  md
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .trim()

function mergeLine(s: PrStatus): [string, string] {
  if (s.state === 'MERGED') return ['Merged', 'text-accent']
  if (s.state === 'CLOSED') return ['Closed without merging', 'text-fg-subtle']
  if (s.isDraft) return ['Draft, not ready to merge', 'text-fg-subtle']
  if (s.mergeable === 'CONFLICTING' || s.mergeState === 'DIRTY') return ['Has conflicts with the base branch', 'text-danger']
  switch (s.mergeState) {
    case 'CLEAN':
    case 'HAS_HOOKS':
      return ['Can merge without conflicts', 'text-success']
    case 'BLOCKED':
      return ['Blocked: needs approvals or passing checks', 'text-warning']
    case 'BEHIND':
      return ['Behind the base branch', 'text-warning']
    case 'UNSTABLE':
      return ['Can merge, but some checks failed', 'text-warning']
    default:
      return ['Checking whether it can merge…', 'text-fg-subtle']
  }
}

/** What GitHub says about the PR: who reviewed, the discussion, CI and whether it can merge. */
export function StatusPanel({ status, files, tests, added, removed, threads }: StatusPanelProps) {
  const [allChecks, setAllChecks] = useState(false)
  const [fullBody, setFullBody] = useState(false)
  const unresolved = threads.filter((t) => !t.resolved).length
  const row = 'flex items-center gap-2 text-sm'
  const block = 'border-t border-line py-2.5 first:border-t-0 first:pt-0'
  if (!status)
    return (
      <aside className="text-sm text-fg-faint">
        <p>Loading the PR's status from GitHub…</p>
      </aside>
    )
  const checks = status.checks.map((c) => ({ c, tone: checkTone(c) }))
  const count = (t: string) => checks.filter((x) => x.tone === t).length
  const shown = allChecks ? checks : checks.filter((x) => x.tone === 'failed' || x.tone === 'running')
  const [merge, mergeTone] = mergeLine(status)
  return (
    <aside aria-label="Pull request status" className="flex flex-col">
      <div className={block}>
        <SectionLabel className="mb-1">Changes</SectionLabel>
        <p className={row}>
          {files} {files === 1 ? 'file' : 'files'} <span className="text-success">+{added}</span> <span className="text-danger">−{removed}</span>
        </p>
        {tests > 0 && <p className="text-xs text-fg-faint">{tests} of them tests</p>}
      </div>
      <div className={block}>
        <SectionLabel className="mb-1">Reviewers</SectionLabel>
        {status.reviewers.length === 0 && <p className="text-sm text-fg-faint">No reviewers yet</p>}
        {status.reviewers.map((r) => {
          const [icon, tone, label] = reviewState[r.state] ?? ['●', 'text-fg-subtle', r.state]
          return (
            <p key={r.name} className={row} title={label}>
              <span className={cn('w-4 text-center', tone)}>{icon}</span>
              <span className="truncate">{r.name}</span>
              <span className="ml-auto shrink-0 text-xs text-fg-faint">{label}</span>
            </p>
          )
        })}
      </div>
      <div className={block}>
        <SectionLabel className="mb-1">Discussion</SectionLabel>
        <p className="text-sm text-fg-muted">
          {status.comments ? `${status.comments} ${status.comments === 1 ? 'comment' : 'comments'}` : 'No comments'}
          {threads.length > 0 && ` · ${threads.length} review ${threads.length === 1 ? 'thread' : 'threads'}`}
          {unresolved > 0 && <span className="text-warning">, {unresolved} unresolved</span>}
        </p>
      </div>
      <div className={block}>
        <SectionLabel className="mb-1">Checks</SectionLabel>
        {checks.length === 0 ? (
          <p className="text-sm text-fg-faint">No checks reported</p>
        ) : (
          <p className="text-sm text-fg-muted">
            {count('failed') > 0 && <span className="text-danger">{count('failed')} failed · </span>}
            {count('running') > 0 && <span className="text-warning">{count('running')} running · </span>}
            {count('passed')} passed
            {count('skipped') > 0 && ` · ${count('skipped')} skipped`}
          </p>
        )}
        {shown.map(({ c, tone }) => (
          <a key={c.name + c.url} href={c.url} target="_blank" rel="noreferrer" className={cn(row, 'rounded-sm hover:bg-raised')}>
            <span className={cn('w-4 text-center', checkIcon[tone][1])}>{checkIcon[tone][0]}</span>
            <span className="truncate">{c.name}</span>
            {c.annotations.length > 0 && <span className="ml-auto shrink-0 text-xs text-fg-faint">{c.annotations.length} notes</span>}
          </a>
        ))}
        {checks.length > shown.length && !allChecks && (
          <LinkButton className="mt-0.5 text-xs" onClick={() => setAllChecks(true)}>
            Show all {checks.length} checks
          </LinkButton>
        )}
      </div>
      <div className={block}>
        <SectionLabel className="mb-1">Merge status</SectionLabel>
        <p className={cn('text-sm', mergeTone)}>{merge}</p>
      </div>
      {status.body.trim() && (
        <div className={block}>
          <SectionLabel className="mb-1">Description</SectionLabel>
          <p className={cn('text-sm break-words whitespace-pre-wrap text-fg-muted', !fullBody && 'line-clamp-6')}>{plain(status.body)}</p>
          {status.body.split('\n').length > 6 && (
            <LinkButton className="mt-0.5 text-xs" onClick={() => setFullBody((v) => !v)}>
              {fullBody ? 'Show less' : 'Show more'}
            </LinkButton>
          )}
        </div>
      )}
    </aside>
  )
}
