import { useEffect, useRef, useState } from 'react'
import { Progress } from '@/components/ui/Progress'
import { SectionLabel } from '@/components/ui/SectionLabel'
import { cn } from '@/lib/cn'
import type { FilePatch } from '../hooks/usePrDiff'
import type { FileChapter } from '../model/files'

interface OutlineProps {
  chapters: FileChapter[]
  patches: Map<string, FilePatch> | null
  current: string | null
  isViewed(file: string): boolean
  /** Files with errors or warnings on changed lines. */
  marks: Map<string, 'error' | 'warning'>
  onJump(file: string): void
  onOverview(): void
}

const fileName = (p: string) => p.split('/').pop()!

/** Left column: the whole PR in reading order, always expanded, following the scroll. */
export function Outline({ chapters, patches, current, isViewed, marks, onJump, onOverview }: OutlineProps) {
  const currentRef = useRef<HTMLButtonElement>(null)
  const [openTests, setOpenTests] = useState<Set<string>>(new Set())
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest' })
  }, [current])
  const all = chapters.flatMap((c) => [...c.sections.flatMap((s) => s.files), ...c.tests])
  const done = all.filter(isViewed).length

  const row = (f: string, test = false) => {
    const p = patches?.get(f)
    return (
      <button
        key={f}
        ref={f === current ? currentRef : undefined}
        aria-current={f === current}
        title={f}
        onClick={() => onJump(f)}
        className={cn(
          'ml-2 flex w-[calc(100%-0.5rem)] items-center gap-2 border-l border-line py-0.5 pr-2 pl-3 text-left text-sm text-fg-subtle hover:text-fg',
          'aria-[current=true]:border-accent aria-[current=true]:bg-accent/10 aria-[current=true]:text-fg',
        )}
      >
        <span className={cn('size-3 shrink-0 rounded-full border-[1.5px]', isViewed(f) ? 'border-success bg-success' : 'border-line-strong')} />
        <span className={cn('min-w-0 flex-1 truncate', test && 'italic', isViewed(f) && 'text-fg-faint')}>{fileName(f)}</span>
        {marks.has(f) && <span title={marks.get(f) === 'error' ? 'Has errors' : 'Has warnings'} className={cn('size-1.5 shrink-0 rounded-full', marks.get(f) === 'error' ? 'bg-danger' : 'bg-warning')} />}
        {p && <span className="shrink-0 text-2xs text-fg-faint tabular-nums">{p.added + p.removed}</span>}
      </button>
    )
  }

  return (
    <nav aria-label="Files in reading order" className="flex min-h-0 flex-col border-r border-line [grid-area:toc]">
      <div className="min-h-0 flex-1 overflow-auto px-2 py-3">
        <button onClick={onOverview} className="w-full rounded-md px-2.5 py-1 text-left text-sm text-fg-subtle hover:bg-surface hover:text-fg">
          Overview
        </button>
        <SectionLabel className="mt-3 mb-1 px-2.5">Read in this order</SectionLabel>
        {chapters.map((c) => {
          const files = [...c.sections.flatMap((s) => s.files), ...c.tests]
          const open = openTests.has(c.chapter.key) || c.tests.includes(current ?? '')
          return (
            <div key={c.chapter.key} className="mb-2">
              <button
                onClick={() => onJump(files[0])}
                title={c.chapter.entry ?? c.chapter.about}
                className={cn('flex w-full items-baseline gap-1.5 rounded-md px-2.5 py-1 text-left text-sm font-medium text-fg-muted hover:bg-surface hover:text-fg', files.includes(current ?? '') && 'bg-surface text-fg')}
              >
                {c.chapter.kind === 'flow' && <span className="text-2xs font-semibold tracking-wide text-accent uppercase">flow</span>}
                <span className="min-w-0 flex-1">{c.chapter.title}</span>
                <span className="shrink-0 text-2xs font-normal text-fg-faint tabular-nums">
                  {files.filter(isViewed).length}/{files.length}
                </span>
              </button>
              {c.sections.map((s) => (
                <div key={s.title || 'all'}>
                  {s.title && <p className="ml-2 truncate border-l border-line pt-1.5 pb-0.5 pl-6 text-2xs tracking-wide text-fg-faint uppercase">{s.title}</p>}
                  {s.files.map((f) => row(f))}
                </div>
              ))}
              {c.tests.length > 0 && (
                <>
                  <button
                    onClick={() => setOpenTests((o) => new Set(open ? [...o].filter((k) => k !== c.chapter.key) : [...o, c.chapter.key]))}
                    className="ml-2 flex w-[calc(100%-0.5rem)] items-center gap-2 border-l border-line py-0.5 pr-2 pl-3 text-left text-sm text-fg-faint italic hover:text-fg"
                  >
                    <span className={cn('size-3 shrink-0 rounded-full border-[1.5px]', c.tests.every(isViewed) ? 'border-success bg-success' : 'border-line-strong')} />
                    <span className="flex-1">
                      {c.tests.length} test {c.tests.length === 1 ? 'file' : 'files'}
                    </span>
                    <span aria-hidden>{open ? '▾' : '▸'}</span>
                  </button>
                  {open && c.tests.map((f) => row(f, true))}
                </>
              )}
            </div>
          )
        })}
      </div>
      <div className="border-t border-line px-4.5 py-3">
        <Progress ok={done / Math.max(all.length, 1)} />
        <p className="mt-1.5 text-xs text-fg-faint">
          {done} of {all.length} files viewed
        </p>
      </div>
    </nav>
  )
}
