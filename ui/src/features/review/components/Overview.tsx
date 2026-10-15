import { SectionLabel } from '@/components/ui/SectionLabel'
import type { FilePatch } from '../hooks/usePrDiff'
import { isTestPath } from '../model/describe'
import type { FileChapter } from '../model/files'
import type { LoadedPr } from '../model/types'

interface OverviewProps {
  data: LoadedPr
  chapters: FileChapter[]
  patches: Map<string, FilePatch> | null
  onJump(file: string): void
}

/** Top of the review page: what the PR is and the order to read it in. */
export function Overview({ data, chapters, patches, onJump }: OverviewProps) {
  const pr = data.pr
  const files = chapters.flatMap((c) => [...c.sections.flatMap((s) => s.files), ...c.tests])
  const tests = files.filter(isTestPath).length
  const added = patches ? [...patches.values()].reduce((n, p) => n + p.added, 0) : (pr?.additions ?? 0)
  const removed = patches ? [...patches.values()].reduce((n, p) => n + p.removed, 0) : (pr?.deletions ?? 0)
  return (
    <section aria-label="Overview" className="rounded-xl border border-line bg-surface px-5.5 py-4.5">
      {pr && !pr.local && (
        <p className="text-xs text-fg-faint">
          {data.id.split('/').slice(0, 2).join('/')} #{pr.number} · by {pr.author.login} · <span className="font-mono">{pr.headRefName}</span> into{' '}
          <span className="font-mono">{pr.baseRefName}</span>
        </p>
      )}
      <h1 className="mt-1 text-lg font-semibold">{pr?.title ?? data.id}</h1>
      <p className="mt-0.5 text-sm text-fg-subtle">
        {files.length} files · <span className="text-success">+{added}</span> <span className="text-danger">−{removed}</span>
        {tests > 0 && ` · ${tests} of them tests`}
      </p>
      <SectionLabel className="mt-4 mb-1.5">Read in this order</SectionLabel>
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
    </section>
  )
}
