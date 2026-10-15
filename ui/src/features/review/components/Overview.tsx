import { useState } from 'react'
import { LinkButton } from '@/components/ui/Button'
import { SectionLabel } from '@/components/ui/SectionLabel'
import { cn } from '@/lib/cn'
import type { FilePatch } from '../hooks/usePrDiff'
import { isTestPath } from '../model/describe'
import type { FileChapter } from '../model/files'
import type { Problem } from '../model/problems'
import type { Finding } from '@/types/generated/Finding'
import type { LoadedPr } from '../model/types'
import type { PrStatus } from '@/types/generated/PrStatus'
import type { ReviewThread } from '@/types/generated/ReviewThread'
import type { Freshness } from '../hooks/useChecks'
import { StateBadge, StatusChips } from './StatusChips'

interface OverviewProps {
  data: LoadedPr
  chapters: FileChapter[]
  patches: Map<string, FilePatch> | null
  problems: Problem[]
  /** The agent's findings scored 75 or more that the reviewer hasn't decided on. */
  findings: Finding[]
  status: PrStatus | null
  freshness: Freshness
  threads: ReviewThread[]
  onJump(file: string): void
  onProblem(id: string): void
  onFinding(f: Finding): void
  onThread(file: string, line: number): void
}

/** Top of the review page: what the PR is and the order to read it in. */
export function Overview({ data, chapters, patches, problems, findings, status, freshness, threads, onJump, onProblem, onFinding, onThread }: OverviewProps) {
  const pr = data.pr
  const files = chapters.flatMap((c) => [...c.sections.flatMap((s) => s.files), ...c.tests])
  const tests = files.filter(isTestPath).length
  const added = patches ? [...patches.values()].reduce((n, p) => n + p.added, 0) : (pr?.additions ?? 0)
  const errors = problems.filter((p) => p.severity === 'error')
  const removed = patches ? [...patches.values()].reduce((n, p) => n + p.removed, 0) : (pr?.deletions ?? 0)
  const description = status ? plain(status.body) : ''
  const order = (
    <div>
      <SectionLabel className="mb-1.5">Read in this order</SectionLabel>
      <ol className="list-decimal pl-5 text-sm text-fg-muted">
        {chapters.map((c) => {
          const n = c.sections.reduce((k, s) => k + s.files.length, 0) + c.tests.length
          return (
            <li key={c.chapter.key} className="py-0.5">
              <button onClick={() => onJump([...c.sections.flatMap((s) => s.files), ...c.tests][0])} className="hover:text-fg hover:underline">
                {c.chapter.title}
              </button>
              <span className="ml-2 text-xs text-fg-faint">
                {n} {n === 1 ? 'file' : 'files'}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
  const attention = (errors.length > 0 || findings.length > 0) && (
    <div>
      <SectionLabel className="mb-1.5">Needs your attention</SectionLabel>
      <ul className="flex flex-col">
        {errors.slice(0, 8).map((p) => (
          <li key={p.id}>
            <button onClick={() => onProblem(p.id)} className="grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-2 rounded-md px-2 py-1 text-left text-sm hover:bg-raised">
              <span className="text-danger">✕</span>
              <span className="truncate text-fg-muted">{p.message.split('\n')[0]}</span>
              <span className="col-start-2 font-mono text-xs text-fg-faint">
                {p.file.split('/').pop()}:{p.line} · {p.source}
              </span>
            </button>
          </li>
        ))}
        {findings.slice(0, 6).map((f) => (
          <li key={`${f.file}:${f.line}:${f.title}`}>
            <button onClick={() => onFinding(f)} className="grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-2 rounded-md px-2 py-1 text-left text-sm hover:bg-raised">
              <span className="text-2xs font-semibold text-accent">AI</span>
              <span className="truncate text-fg-muted">{f.title}</span>
              <span className="col-start-2 font-mono text-xs text-fg-faint">
                {f.file.split('/').pop()}:{f.line} · {f.category}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {errors.length > 8 && <p className="mt-1 px-2 text-xs text-fg-faint">{errors.length - 8} more; press e to go through them.</p>}
    </div>
  )
  return (
    <section aria-label="Overview" className="rounded-xl border border-line bg-surface px-5.5 py-4.5 max-sm:px-3.5 max-sm:py-3.5">
      <div className="flex items-center gap-2.5">
        {pr && !pr.local && <StateBadge status={status} />}
        <h1 className="min-w-0 text-lg font-semibold">{pr?.title ?? data.id}</h1>
      </div>
      {pr && !pr.local && (
        <p className="mt-1 text-sm text-fg-subtle">
          {data.id.split('/').slice(0, 2).join('/')} #{pr.number} · {pr.author.login} · <span className="font-mono text-xs">{pr.headRefName}</span> →{' '}
          <span className="font-mono text-xs">{pr.baseRefName}</span> · {files.length} files <span className="text-success">+{added.toLocaleString()}</span>{' '}
          <span className="text-danger">−{removed.toLocaleString()}</span>
          {tests > 0 && ` · ${tests} tests`}
        </p>
      )}
      {pr && !pr.local ? (
        <StatusChips status={status} freshness={freshness} threads={threads} onThread={onThread} />
      ) : (
        <p className="mt-0.5 text-sm text-fg-subtle">
          {files.length} files · <span className="text-success">+{added}</span> <span className="text-danger">−{removed}</span>
          {tests > 0 && ` · ${tests} of them tests`}
        </p>
      )}
      <div className={cn('mt-4 grid gap-7 max-[1000px]:grid-cols-1', description ? 'grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]' : 'grid-cols-2')}>
        {description ? (
          <>
            <Description text={description} />
            <div className="flex flex-col gap-5">
              {order}
              {attention}
            </div>
          </>
        ) : (
          <>
            {order}
            {attention}
          </>
        )}
      </div>
    </section>
  )
}

/** Markdown read as plain text: heading marks, emphasis and HTML comments dropped. */
const plain = (md: string) =>
  md
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .trim()

/** The PR description, a few lines at first. */
function Description({ text }: { text: string }) {
  const [full, setFull] = useState(false)
  const long = text.split('\n').length > 8 || text.length > 700
  return (
    <div className="min-w-0">
      <SectionLabel className="mb-1.5">Description</SectionLabel>
      <p className={cn('text-sm leading-relaxed break-words whitespace-pre-wrap text-fg-muted', !full && 'line-clamp-8')}>{text}</p>
      {long && (
        <LinkButton className="mt-1 text-xs" onClick={() => setFull((v) => !v)}>
          {full ? 'Show less' : 'Show more'}
        </LinkButton>
      )}
    </div>
  )
}
