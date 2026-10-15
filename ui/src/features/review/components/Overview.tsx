import { SectionLabel } from '@/components/ui/SectionLabel'
import type { FilePatch } from '../hooks/usePrDiff'
import { isTestPath } from '../model/describe'
import type { FileChapter } from '../model/files'
import type { Problem } from '../model/problems'
import type { Finding } from '@/types/generated/Finding'
import type { LoadedPr } from '../model/types'
import type { PrStatus } from '@/types/generated/PrStatus'
import type { ReviewThread } from '@/types/generated/ReviewThread'
import { StatusPanel } from './StatusPanel'

interface OverviewProps {
  data: LoadedPr
  chapters: FileChapter[]
  patches: Map<string, FilePatch> | null
  problems: Problem[]
  /** The agent's findings scored 75 or more that the reviewer hasn't decided on. */
  findings: Finding[]
  status: PrStatus | null
  threads: ReviewThread[]
  onJump(file: string): void
  onProblem(id: string): void
  onFinding(f: Finding): void
}

/** Top of the review page: what the PR is and the order to read it in. */
export function Overview({ data, chapters, patches, problems, findings, status, threads, onJump, onProblem, onFinding }: OverviewProps) {
  const pr = data.pr
  const files = chapters.flatMap((c) => [...c.sections.flatMap((s) => s.files), ...c.tests])
  const tests = files.filter(isTestPath).length
  const added = patches ? [...patches.values()].reduce((n, p) => n + p.added, 0) : (pr?.additions ?? 0)
  const errors = problems.filter((p) => p.severity === 'error')
  const removed = patches ? [...patches.values()].reduce((n, p) => n + p.removed, 0) : (pr?.deletions ?? 0)
  return (
    <section aria-label="Overview" className="flex gap-7 rounded-xl border border-line bg-surface px-5.5 py-4.5 max-[1100px]:flex-col">
      <div className="min-w-0 flex-1">
        {pr && !pr.local && (
          <p className="text-xs text-fg-faint">
            {data.id.split('/').slice(0, 2).join('/')} #{pr.number} · by {pr.author.login} · <span className="font-mono">{pr.headRefName}</span> into{' '}
            <span className="font-mono">{pr.baseRefName}</span>
          </p>
        )}
        <h1 className="mt-1 text-lg font-semibold">{pr?.title ?? data.id}</h1>
        {(!pr || pr.local) && (
          <p className="mt-0.5 text-sm text-fg-subtle">
            {files.length} files · <span className="text-success">+{added}</span> <span className="text-danger">−{removed}</span>
            {tests > 0 && ` · ${tests} of them tests`}
          </p>
        )}
        <div className="mt-4 grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-7 max-[1000px]:grid-cols-1">
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
          {(errors.length > 0 || findings.length > 0) && (
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
              </ul>
              {errors.length > 8 && <p className="mt-1 px-2 text-xs text-fg-faint">{errors.length - 8} more; press e to go through them.</p>}
            <ul className="flex flex-col">
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
            </div>
          )}
        </div>
      </div>
      {pr && !pr.local && (
        <div className="w-72 shrink-0 border-l border-line pl-6 max-[1100px]:w-auto max-[1100px]:border-t max-[1100px]:border-l-0 max-[1100px]:pt-4 max-[1100px]:pl-0">
          <StatusPanel status={status} files={files.length} tests={tests} added={added} removed={removed} threads={threads} />
        </div>
      )}
    </section>
  )
}
